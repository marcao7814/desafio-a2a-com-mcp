import { toolsCall } from "./mcpClient.js";
import { novaMensagem, type Task } from "./task.js";
import type { PedidoReserva } from "./parser.js";

interface ResultadoToolComplete {
  resultType: "complete";
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structuredContent?: {
    reserva: string | null;
    reservado: boolean;
    sala: string | null;
    inicio: string | null;
    fim: string | null;
    responsavel: string | null;
    politica: string | null;
    motivo: string | null;
  };
}

interface ResultadoToolInputRequired {
  resultType: "input_required";
  inputRequests: Record<
    string,
    { method: string; params: { requestedSchema: { properties: { sala: { enum?: string[]; const?: string } } } } }
  >;
  requestState: string;
}

type ResultadoTool = ResultadoToolComplete | ResultadoToolInputRequired;

function textoDoResultado(resultado: ResultadoToolComplete): string {
  return resultado.content.map((c) => c.text).join(" ");
}

function aplicarResultado(task: Task, pedidoOriginal: PedidoReserva, resultado: ResultadoTool): void {
  if (resultado.resultType === "input_required") {
    const chave = Object.keys(resultado.inputRequests)[0];
    const schema = resultado.inputRequests[chave].params.requestedSchema.properties.sala;
    const alternativas = schema.enum ?? (schema.const ? [schema.const] : []);
    task.pendente = { chave, requestState: resultado.requestState, alternativas, pedidoOriginal };
    const texto = `alternativas: ${alternativas.join(", ")}`;
    const msg = novaMensagem("ROLE_AGENT", texto, { taskId: task.id, contextId: task.contextId });
    task.status = { state: "TASK_STATE_INPUT_REQUIRED", message: msg };
    task.history.push(msg);
    return;
  }

  task.pendente = undefined;

  if (resultado.isError) {
    const texto = textoDoResultado(resultado);
    const msg = novaMensagem("ROLE_AGENT", texto, { taskId: task.id, contextId: task.contextId });
    task.status = { state: "TASK_STATE_FAILED", message: msg };
    task.history.push(msg);
    return;
  }

  const dados = resultado.structuredContent!;
  if (dados.reservado === false) {
    const msg = novaMensagem("ROLE_AGENT", "Reserva cancelada.", { taskId: task.id, contextId: task.contextId });
    task.status = { state: "TASK_STATE_CANCELED", message: msg };
    task.history.push(msg);
    return;
  }

  const artifactJson = {
    reserva: dados.reserva,
    sala: dados.sala,
    inicio: dados.inicio,
    fim: dados.fim,
    responsavel: dados.responsavel,
    politica: dados.politica,
  };
  task.artifacts.push({
    artifactId: `art-${dados.reserva}`,
    name: "reserva",
    parts: [{ text: JSON.stringify(artifactJson) }],
  });
  const msg = novaMensagem("ROLE_AGENT", `Reserva ${dados.reserva} confirmada na ${dados.sala}.`, {
    taskId: task.id,
    contextId: task.contextId,
  });
  task.status = { state: "TASK_STATE_COMPLETED", message: msg };
  task.history.push(msg);
}

export async function processarPedidoNovo(task: Task, pedido: PedidoReserva, traceparent: string): Promise<void> {
  task.status = { state: "TASK_STATE_WORKING" };
  const resposta = await toolsCall("reservar_sala", { ...pedido }, undefined, traceparent);
  if (resposta.error) {
    const msg = novaMensagem("ROLE_AGENT", resposta.error.message, { taskId: task.id, contextId: task.contextId });
    task.status = { state: "TASK_STATE_FAILED", message: msg };
    task.history.push(msg);
    return;
  }
  aplicarResultado(task, pedido, resposta.result as unknown as ResultadoTool);
}

/** Escolha fora do enum: mantem a Task pausada e repete as alternativas, sem chamar o MCP. */
function repetirAlternativas(task: Task): void {
  const alternativas = task.pendente!.alternativas;
  const msg = novaMensagem("ROLE_AGENT", `alternativas: ${alternativas.join(", ")}`, {
    taskId: task.id,
    contextId: task.contextId,
  });
  task.status = { state: "TASK_STATE_INPUT_REQUIRED", message: msg };
  task.history.push(msg);
}

export async function processarContinuacao(task: Task, escolha: string, traceparent: string): Promise<void> {
  const pendente = task.pendente;
  if (!pendente) {
    repetirAlternativas(task);
    return;
  }

  let inputResponses: Record<string, unknown>;
  if (escolha === "recusar") {
    inputResponses = { [pendente.chave]: { action: "decline" } };
  } else if (pendente.alternativas.includes(escolha)) {
    inputResponses = { [pendente.chave]: { action: "accept", content: { sala: escolha } } };
  } else {
    repetirAlternativas(task);
    return;
  }

  task.status = { state: "TASK_STATE_WORKING" };
  const resposta = await toolsCall(
    "reservar_sala",
    { ...pendente.pedidoOriginal },
    { inputResponses, requestState: pendente.requestState },
    traceparent,
  );
  if (resposta.error) {
    const msg = novaMensagem("ROLE_AGENT", resposta.error.message, { taskId: task.id, contextId: task.contextId });
    task.status = { state: "TASK_STATE_FAILED", message: msg };
    task.history.push(msg);
    return;
  }
  aplicarResultado(task, pendente.pedidoOriginal, resposta.result as unknown as ResultadoTool);
}
