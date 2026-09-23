import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { politicaTexto } from "./dados.js";
import { chamarTool, TOOLS } from "./tools.js";

const PROTOCOLO = "2026-07-28";
const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
}

function enviarJson(res: ServerResponse, status: number, corpo: unknown): void {
  const dados = JSON.stringify(corpo);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(dados);
}

function respostaErro(id: unknown, codigo: number, mensagem: string, dados?: unknown) {
  const error: { code: number; message: string; data?: unknown } = { code: codigo, message: mensagem };
  if (dados !== undefined) error.data = dados;
  return { jsonrpc: "2.0", id: id ?? null, error };
}

function respostaResultado(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function lerCorpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let dados = "";
    req.on("data", (pedaco) => (dados += pedaco));
    req.on("end", () => resolve(dados));
    req.on("error", reject);
  });
}

function log(metodo: string, id: unknown, traceparent: unknown): void {
  const partes = [`method=${metodo}`, `id=${JSON.stringify(id)}`];
  if (traceparent) partes.push(`traceparent=${traceparent}`);
  process.stderr.write(`[servidor-mcp] ${partes.join(" ")}\n`);
}

async function tratarMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let corpo: JsonRpcRequest;
  try {
    corpo = JSON.parse(await lerCorpo(req));
  } catch {
    enviarJson(res, 400, respostaErro(null, -32700, "JSON invalido"));
    return;
  }

  const { id, method, params } = corpo;
  const meta = (params?._meta as Record<string, unknown> | undefined) ?? {};
  const traceparent = meta.traceparent;
  log(method ?? "", id, traceparent);

  if (!(META_PROTOCOL_VERSION in meta) || !(META_CLIENT_CAPABILITIES in meta)) {
    enviarJson(
      res,
      400,
      respostaErro(id, -32602, "_meta precisa trazer io.modelcontextprotocol/protocolVersion e io.modelcontextprotocol/clientCapabilities"),
    );
    return;
  }

  const headerMethod = req.headers["mcp-method"];
  if (headerMethod !== undefined && headerMethod !== method) {
    enviarJson(res, 400, respostaErro(id, -32020, "Header Mcp-Method nao bate com o metodo do corpo"));
    return;
  }

  switch (method) {
    case "tools/list": {
      enviarJson(res, 200, respostaResultado(id, { resultType: "complete", tools: TOOLS }));
      return;
    }
    case "tools/call": {
      const nome = String(params?.name ?? "");
      const headerNome = req.headers["mcp-name"];
      if (headerNome !== undefined && headerNome !== nome) {
        enviarJson(res, 400, respostaErro(id, -32020, "Header Mcp-Name nao bate com o name do corpo"));
        return;
      }
      const args = (params?.arguments as Record<string, unknown> | undefined) ?? {};
      const inputResponses = params?.inputResponses as
        | Record<string, { action?: string; content?: { sala?: string } }>
        | undefined;
      const requestState = params?.requestState as string | undefined;
      const clientCapabilities = meta[META_CLIENT_CAPABILITIES];

      const saida = chamarTool(nome, args, clientCapabilities, inputResponses, requestState);
      if (saida.tipo === "erro") {
        enviarJson(res, saida.httpStatus ?? 200, respostaErro(id, saida.codigo, saida.mensagem, saida.dados));
      } else {
        enviarJson(res, 200, respostaResultado(id, saida.corpo));
      }
      return;
    }
    case "resources/read": {
      const uri = String(params?.uri ?? "");
      const headerNome = req.headers["mcp-name"];
      if (headerNome !== undefined && headerNome !== uri) {
        enviarJson(res, 400, respostaErro(id, -32020, "Header Mcp-Name nao bate com a uri do corpo"));
        return;
      }
      if (uri !== "politica://uso") {
        enviarJson(res, 200, respostaErro(id, -32602, `Resource inexistente: ${uri}`));
        return;
      }
      enviarJson(
        res,
        200,
        respostaResultado(id, {
          resultType: "complete",
          contents: [{ uri, mimeType: "text/markdown", text: politicaTexto }],
        }),
      );
      return;
    }
    default: {
      enviarJson(res, 200, respostaErro(id, -32601, `Metodo desconhecido: ${method}`));
      return;
    }
  }
}

export function criarServidorMcp() {
  return createServer((req, res) => {
    if (req.method === "POST" && req.url === "/mcp") {
      tratarMcp(req, res).catch((erro) => {
        process.stderr.write(`[servidor-mcp] erro interno: ${String(erro)}\n`);
        enviarJson(res, 500, respostaErro(null, -32603, "Erro interno do servidor"));
      });
      return;
    }
    enviarJson(res, 404, respostaErro(null, -32601, "Rota nao encontrada"));
  });
}

export { PROTOCOLO };
