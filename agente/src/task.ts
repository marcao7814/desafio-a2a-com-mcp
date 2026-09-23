import { randomUUID } from "node:crypto";
import type { PedidoReserva } from "./parser.js";

export type TaskState =
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_FAILED";

export interface Mensagem {
  messageId: string;
  role: "ROLE_USER" | "ROLE_AGENT";
  parts: { text: string }[];
  taskId?: string;
  contextId?: string;
}

export interface Artifact {
  artifactId: string;
  name: string;
  parts: { text: string }[];
}

export interface PendenteMrtr {
  chave: string;
  requestState: string;
  alternativas: string[];
  pedidoOriginal: PedidoReserva;
}

export interface Task {
  id: string;
  contextId: string;
  status: { state: TaskState; message?: Mensagem };
  history: Mensagem[];
  artifacts: Artifact[];
  pendente?: PendenteMrtr;
  traceIdOriginal: string;
}

const TERMINAIS: TaskState[] = ["TASK_STATE_COMPLETED", "TASK_STATE_CANCELED", "TASK_STATE_FAILED"];

export function eTerminal(state: TaskState): boolean {
  return TERMINAIS.includes(state);
}

class TaskStore {
  private tasks = new Map<string, Task>();

  criar(traceIdOriginal: string): Task {
    const task: Task = {
      id: `task-${randomUUID()}`,
      contextId: `ctx-${randomUUID()}`,
      status: { state: "TASK_STATE_SUBMITTED" },
      history: [],
      artifacts: [],
      traceIdOriginal,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  obter(id: string): Task | undefined {
    return this.tasks.get(id);
  }
}

export const taskStore = new TaskStore();

export function novaMensagem(role: Mensagem["role"], texto: string, extra?: Partial<Mensagem>): Mensagem {
  return { messageId: `msg-${randomUUID()}`, role, parts: [{ text: texto }], ...extra };
}
