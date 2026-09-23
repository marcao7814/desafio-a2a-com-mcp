import { criarServidorMcp } from "./server.js";

if (!process.env.REQUEST_STATE_SECRET || process.env.REQUEST_STATE_SECRET.length < 32) {
  console.error(
    "REQUEST_STATE_SECRET ausente ou com menos de 32 caracteres.\n" +
      'Gere um valor com: python3 -c "import secrets; print(secrets.token_hex(32))"\n' +
      "e exporte antes de subir o servidor.",
  );
  process.exit(1);
}

const porta = Number(process.env.MCP_PORT ?? 7301);
const servidor = criarServidorMcp();
servidor.listen(porta, () => {
  console.error(`[servidor-mcp] ouvindo em http://localhost:${porta}/mcp`);
});
