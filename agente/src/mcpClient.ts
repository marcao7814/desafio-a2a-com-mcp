import { randomUUID } from "node:crypto";

const PROTOCOLO = "2026-07-28";
const CLIENT_CAPABILITIES = { elicitation: { form: {} } };
const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:7301/mcp";

export interface RespostaMcp {
  jsonrpc: "2.0";
  id: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

async function chamarMcp(
  method: string,
  params: Record<string, unknown>,
  opts: { nome?: string; traceparent: string },
): Promise<RespostaMcp> {
  const meta: Record<string, unknown> = {
    "io.modelcontextprotocol/protocolVersion": PROTOCOLO,
    "io.modelcontextprotocol/clientCapabilities": CLIENT_CAPABILITIES,
    traceparent: opts.traceparent,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOLO,
    "Mcp-Method": method,
  };
  if (opts.nome) headers["Mcp-Name"] = opts.nome;

  const corpo = { jsonrpc: "2.0", id: randomUUID(), method, params: { ...params, _meta: meta } };

  const resposta = await fetch(MCP_SERVER_URL, { method: "POST", headers, body: JSON.stringify(corpo) });
  return (await resposta.json()) as RespostaMcp;
}

export function toolsList(traceparent: string): Promise<RespostaMcp> {
  return chamarMcp("tools/list", {}, { traceparent });
}

export function resourcesRead(uri: string, traceparent: string): Promise<RespostaMcp> {
  return chamarMcp("resources/read", { uri }, { nome: uri, traceparent });
}

export function toolsCall(
  nome: string,
  args: Record<string, unknown>,
  extra: { inputResponses?: Record<string, unknown>; requestState?: string } | undefined,
  traceparent: string,
): Promise<RespostaMcp> {
  const params: Record<string, unknown> = { name: nome, arguments: args };
  if (extra?.inputResponses) params.inputResponses = extra.inputResponses;
  if (extra?.requestState) params.requestState = extra.requestState;
  return chamarMcp("tools/call", params, { nome, traceparent });
}
