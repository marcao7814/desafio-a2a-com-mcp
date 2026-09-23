import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { montarAgentCard } from "./agentCard.js";
import { parsearEscolha, parsearPedido } from "./parser.js";
import { processarContinuacao, processarPedidoNovo } from "./bridge.js";
import { eTerminal, novaMensagem, taskStore, type Task } from "./task.js";
import { propagarTraceparent } from "./trace.js";

interface Mensagem {
  messageId: string;
  role: string;
  parts: { text: string }[];
  taskId?: string;
}

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

function respostaErro(id: unknown, codigo: number, mensagem: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: codigo, message: mensagem } };
}

function respostaResultado(id: unknown, task: Task) {
  return { jsonrpc: "2.0", id: id ?? null, result: { task: serializarTask(task) } };
}

function serializarTask(task: Task) {
  return {
    id: task.id,
    contextId: task.contextId,
    status: task.status,
    history: task.history,
    artifacts: task.artifacts,
  };
}

function lerCorpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let dados = "";
    req.on("data", (pedaco) => (dados += pedaco));
    req.on("end", () => resolve(dados));
    req.on("error", reject);
  });
}

async function tratarSendMessage(id: unknown, params: Record<string, unknown>, headerTraceparent?: string) {
  const mensagem = params.message as Mensagem;
  const texto = mensagem.parts[0]?.text ?? "";

  if (mensagem.taskId) {
    const task = taskStore.obter(mensagem.taskId);
    if (!task) return respostaErro(id, -32001, `Task nao encontrada: ${mensagem.taskId}`);
    if (eTerminal(task.status.state)) {
      return respostaErro(id, -32002, `Task ${task.id} ja esta em estado terminal (${task.status.state})`);
    }

    task.history.push(novaMensagem("ROLE_USER", texto, { taskId: task.id, contextId: task.contextId }));
    const traceparent = propagarTraceparent(headerTraceparent ?? task.traceIdOriginal);
    const escolha = parsearEscolha(texto) ?? "";
    await processarContinuacao(task, escolha, traceparent);
    return respostaResultado(id, task);
  }

  const traceparentCompleto = propagarTraceparent(headerTraceparent);
  const traceId = traceparentCompleto.split("-")[1];
  const task = taskStore.criar(traceId);
  task.history.push(novaMensagem("ROLE_USER", texto));

  const pedido = parsearPedido(texto);
  if (!pedido) {
    const msg = novaMensagem("ROLE_AGENT", "Pedido invalido: formato esperado e 'reservar sala=<id> inicio=<iso8601> fim=<iso8601> responsavel=<nome>'", {
      taskId: task.id,
      contextId: task.contextId,
    });
    task.status = { state: "TASK_STATE_FAILED", message: msg };
    task.history.push(msg);
    return respostaResultado(id, task);
  }

  await processarPedidoNovo(task, pedido, traceparentCompleto);
  return respostaResultado(id, task);
}

function tratarGetTask(id: unknown, params: Record<string, unknown>) {
  const taskId = String(params.id ?? "");
  const task = taskStore.obter(taskId);
  if (!task) return respostaErro(id, -32001, `Task nao encontrada: ${taskId}`);
  return respostaResultado(id, task);
}

async function tratarA2a(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let corpo: JsonRpcRequest;
  try {
    corpo = JSON.parse(await lerCorpo(req));
  } catch {
    enviarJson(res, 400, respostaErro(null, -32700, "JSON invalido"));
    return;
  }
  const { id, method, params } = corpo;
  const headerTraceparent = req.headers["traceparent"] as string | undefined;

  try {
    if (method === "SendMessage") {
      const resultado = await tratarSendMessage(id, params ?? {}, headerTraceparent);
      enviarJson(res, 200, resultado);
      return;
    }
    if (method === "GetTask") {
      enviarJson(res, 200, tratarGetTask(id, params ?? {}));
      return;
    }
    enviarJson(res, 200, respostaErro(id, -32601, `Metodo desconhecido: ${method}`));
  } catch (erro) {
    process.stderr.write(`[agente] erro ao tratar ${method}: ${String(erro)}\n`);
    enviarJson(res, 500, respostaErro(id, -32603, "Erro interno do agente"));
  }
}

export function criarServidorA2a(portaA2A: number) {
  const card = montarAgentCard(portaA2A);
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/.well-known/agent-card.json") {
      enviarJson(res, 200, card);
      return;
    }
    if (req.method === "POST" && req.url === "/a2a") {
      tratarA2a(req, res);
      return;
    }
    enviarJson(res, 404, respostaErro(null, -32601, "Rota nao encontrada"));
  });
}
