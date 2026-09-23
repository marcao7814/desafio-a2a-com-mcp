import { politicaVersao, salas } from "./dados.js";
import { reservaStore } from "./reservas.js";
import { calcularAlternativas, validarPedido, ERRO_SEM_ALTERNATIVA } from "./politica.js";
import { abrirEstado, selarEstado } from "./requestState.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "listar_salas",
    description: "Lista todas as salas com capacidade e recursos.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        salas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              nome: { type: "string" },
              capacidade: { type: "integer" },
              recursos: { type: "array", items: { type: "string" } },
            },
            required: ["id", "nome", "capacidade", "recursos"],
          },
        },
      },
      required: ["salas"],
    },
  },
  {
    name: "consultar_disponibilidade",
    description: "Diz se uma sala esta livre no intervalo, e quais reservas conflitam.",
    inputSchema: {
      type: "object",
      properties: {
        sala: { type: "string" },
        inicio: { type: "string" },
        fim: { type: "string" },
      },
      required: ["sala", "inicio", "fim"],
    },
    outputSchema: {
      type: "object",
      properties: {
        sala: { type: "string" },
        livre: { type: "boolean" },
        conflitos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              inicio: { type: "string" },
              fim: { type: "string" },
              responsavel: { type: "string" },
            },
            required: ["id", "inicio", "fim", "responsavel"],
          },
        },
      },
      required: ["sala", "livre", "conflitos"],
    },
  },
  {
    name: "reservar_sala",
    description: "Reserva uma sala. Se o intervalo estiver ocupado, pergunta qual alternativa usar.",
    inputSchema: {
      type: "object",
      properties: {
        sala: { type: "string" },
        inicio: { type: "string" },
        fim: { type: "string" },
        responsavel: { type: "string" },
      },
      required: ["sala", "inicio", "fim", "responsavel"],
    },
    outputSchema: {
      type: "object",
      properties: {
        reserva: { type: ["string", "null"] },
        reservado: { type: "boolean" },
        sala: { type: ["string", "null"] },
        inicio: { type: ["string", "null"] },
        fim: { type: ["string", "null"] },
        responsavel: { type: ["string", "null"] },
        politica: { type: ["string", "null"] },
        motivo: { type: ["string", "null"] },
      },
    },
  },
];

interface TextoBloco {
  type: "text";
  text: string;
}

export interface ResultadoCompleto {
  resultType: "complete";
  content: TextoBloco[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface ResultadoInputRequired {
  resultType: "input_required";
  inputRequests: Record<
    string,
    {
      method: "elicitation/create";
      params: {
        mode: "form";
        message: string;
        requestedSchema: {
          type: "object";
          properties: { sala: { type: "string"; description: string; enum?: string[]; const?: string } };
          required: ["sala"];
        };
      };
    }
  >;
  requestState: string;
}

export type ResultadoTool = ResultadoCompleto | ResultadoInputRequired;

export type SaidaChamada =
  | { tipo: "resultado"; corpo: ResultadoTool }
  | { tipo: "erro"; codigo: number; mensagem: string; dados?: unknown; httpStatus?: number };

function textoJson(obj: unknown): TextoBloco[] {
  return [{ type: "text", text: JSON.stringify(obj, null, 2) }];
}

function erroExecucao(mensagem: string): SaidaChamada {
  return {
    tipo: "resultado",
    corpo: { resultType: "complete", content: [{ type: "text", text: mensagem }], isError: true },
  };
}

function listarSalas(): SaidaChamada {
  const estruturado = { salas };
  return {
    tipo: "resultado",
    corpo: { resultType: "complete", content: textoJson(estruturado), isError: false, structuredContent: estruturado },
  };
}

function consultarDisponibilidade(args: { sala?: unknown; inicio?: unknown; fim?: unknown }): SaidaChamada {
  const sala = String(args.sala ?? "");
  const inicio = String(args.inicio ?? "");
  const fim = String(args.fim ?? "");

  const erro = validarPedido(sala, inicio, fim);
  if (erro) return erroExecucao(erro);

  const conflitos = reservaStore.conflitos(sala, inicio, fim);
  const estruturado = {
    sala,
    livre: conflitos.length === 0,
    conflitos: conflitos.map((c) => ({ id: c.id, inicio: c.inicio, fim: c.fim, responsavel: c.responsavel })),
  };
  return {
    tipo: "resultado",
    corpo: { resultType: "complete", content: textoJson(estruturado), isError: false, structuredContent: estruturado },
  };
}

function reservaConcluidaResultado(reserva: {
  id: string | null;
  sala: string | null;
  inicio: string | null;
  fim: string | null;
  responsavel: string | null;
}): SaidaChamada {
  const estruturado = {
    reserva: reserva.id,
    reservado: reserva.id !== null,
    sala: reserva.sala,
    inicio: reserva.inicio,
    fim: reserva.fim,
    responsavel: reserva.responsavel,
    politica: reserva.id !== null ? politicaVersao : null,
    motivo: reserva.id !== null ? null : "recusado",
  };
  return {
    tipo: "resultado",
    corpo: { resultType: "complete", content: textoJson(estruturado), isError: false, structuredContent: estruturado },
  };
}

function clienteDeclaraElicitationForm(clientCapabilities: unknown): boolean {
  const cc = clientCapabilities as { elicitation?: { form?: unknown } } | undefined;
  return !!cc?.elicitation && typeof cc.elicitation === "object" && "form" in cc.elicitation;
}

const CHAVE_ELICITATION = "escolha_de_sala";

function abrirConflito(sala: string, inicio: string, fim: string, responsavel: string): SaidaChamada {
  const alternativas = calcularAlternativas(sala, inicio, fim);
  if (alternativas.length === 0) return erroExecucao(ERRO_SEM_ALTERNATIVA);

  const requestState = selarEstado({ chave: CHAVE_ELICITATION, sala, inicio, fim, responsavel, alternativas });
  const propriedadeSala: { type: "string"; description: string; enum?: string[]; const?: string } = {
    type: "string",
    description: "Sala alternativa escolhida",
  };
  if (alternativas.length === 1) propriedadeSala.const = alternativas[0];
  else propriedadeSala.enum = alternativas;

  return {
    tipo: "resultado",
    corpo: {
      resultType: "input_required",
      inputRequests: {
        [CHAVE_ELICITATION]: {
          method: "elicitation/create",
          params: {
            mode: "form",
            message: "A sala pedida esta ocupada nesse intervalo. Escolha uma alternativa.",
            requestedSchema: { type: "object", properties: { sala: propriedadeSala }, required: ["sala"] },
          },
        },
      },
      requestState,
    },
  };
}

function retomarReserva(
  inputResponses: Record<string, { action?: string; content?: { sala?: string } }>,
  requestState: string,
): SaidaChamada {
  const estado = abrirEstado(requestState);
  if (!estado) return { tipo: "erro", codigo: -32602, mensagem: "requestState invalido ou expirado" };

  const resposta = Object.values(inputResponses)[0];
  if (!resposta) return { tipo: "erro", codigo: -32602, mensagem: "inputResponses vazio" };

  if (resposta.action === "decline" || resposta.action === "cancel") {
    return reservaConcluidaResultado({ id: null, sala: null, inicio: null, fim: null, responsavel: null });
  }

  const salaEscolhida = resposta.content?.sala;
  if (!salaEscolhida || !estado.alternativas.includes(salaEscolhida)) {
    return { tipo: "erro", codigo: -32602, mensagem: "escolha fora das alternativas seladas" };
  }

  // Tudo vem do estado selado - argumentos reenviados pelo cliente sao ignorados.
  if (!reservaStore.livre(salaEscolhida, estado.inicio, estado.fim)) {
    return erroExecucao(ERRO_SEM_ALTERNATIVA);
  }
  const reserva = reservaStore.criar(salaEscolhida, estado.inicio, estado.fim, estado.responsavel);
  return reservaConcluidaResultado(reserva);
}

function reservarSala(
  args: { sala?: unknown; inicio?: unknown; fim?: unknown; responsavel?: unknown },
  clientCapabilities: unknown,
  inputResponses: Record<string, { action?: string; content?: { sala?: string } }> | undefined,
  requestState: string | undefined,
): SaidaChamada {
  if (inputResponses && requestState) {
    return retomarReserva(inputResponses, requestState);
  }

  const sala = String(args.sala ?? "");
  const inicio = String(args.inicio ?? "");
  const fim = String(args.fim ?? "");
  const responsavel = String(args.responsavel ?? "");

  const erro = validarPedido(sala, inicio, fim);
  if (erro) return erroExecucao(erro);

  if (reservaStore.livre(sala, inicio, fim)) {
    const reserva = reservaStore.criar(sala, inicio, fim, responsavel);
    return reservaConcluidaResultado(reserva);
  }

  if (!clienteDeclaraElicitationForm(clientCapabilities)) {
    return {
      tipo: "erro",
      codigo: -32021,
      mensagem: "Client did not declare the form elicitation capability required by resolver '__main__:escolha_de_sala'",
      dados: { requiredCapabilities: { elicitation: { form: {} } } },
      httpStatus: 400,
    };
  }

  return abrirConflito(sala, inicio, fim, responsavel);
}

export function chamarTool(
  nome: string,
  args: Record<string, unknown>,
  clientCapabilities: unknown,
  inputResponses: Record<string, { action?: string; content?: { sala?: string } }> | undefined,
  requestState: string | undefined,
): SaidaChamada {
  switch (nome) {
    case "listar_salas":
      return listarSalas();
    case "consultar_disponibilidade":
      return consultarDisponibilidade(args);
    case "reservar_sala":
      return reservarSala(args, clientCapabilities, inputResponses, requestState);
    default:
      return { tipo: "erro", codigo: -32602, mensagem: `Tool desconhecida: ${nome}` };
  }
}
