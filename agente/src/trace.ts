import { randomBytes } from "node:crypto";

export function novoTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function novoSpanId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Propaga o trace-id de um traceparent recebido (do cliente A2A), gerando um
 * span-id novo. Se nao houver traceparent de entrada, gera um trace-id novo.
 */
export function propagarTraceparent(entrada?: string | null): string {
  const traceId = entrada?.split("-")[1] || novoTraceId();
  return `00-${traceId}-${novoSpanId()}-01`;
}
