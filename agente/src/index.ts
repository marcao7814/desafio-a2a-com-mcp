import { toolsList, resourcesRead } from "./mcpClient.js";
import { novoTraceId, novoSpanId } from "./trace.js";
import { criarServidorA2a } from "./a2aServer.js";

async function descobrirServidorMcp(): Promise<void> {
  const traceparent = `00-${novoTraceId()}-${novoSpanId()}-01`;
  const listaResposta = await toolsList(traceparent);
  const tools = (listaResposta.result?.tools as { name: string }[] | undefined) ?? [];
  console.error(`[agente] tools/list descobriu: ${tools.map((t) => t.name).join(", ")}`);

  const recursoResposta = await resourcesRead("politica://uso", traceparent);
  const contents = (recursoResposta.result?.contents as { text: string }[] | undefined) ?? [];
  const primeiraLinha = contents[0]?.text.split("\n", 1)[0] ?? "";
  console.error(`[agente] resource politica://uso: ${primeiraLinha}`);
}

async function main(): Promise<void> {
  await descobrirServidorMcp();

  const portaA2A = Number(process.env.A2A_PORT ?? 7300);
  const servidor = criarServidorA2a(portaA2A);
  servidor.listen(portaA2A, () => {
    console.error(`[agente] servidor A2A ouvindo em http://localhost:${portaA2A}/a2a`);
  });
}

main().catch((erro) => {
  console.error("[agente] falha ao iniciar:", erro);
  process.exit(1);
});
