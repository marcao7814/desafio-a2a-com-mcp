# A Ponte: um agente A2A com MCP por dentro

Implementação do desafio [devfullcycle/desafio-a2a-com-mcp](https://github.com/devfullcycle/desafio-a2a-com-mcp): um servidor MCP (Streamable HTTP) que expõe a reserva de salas da Hill Valley Tech, e um agente que consome esse servidor por dentro (host MCP) e se oferece como servidor A2A por fora.

Stack: Node.js 20+ / TypeScript nos dois processos (ver "Decisões técnicas" abaixo para o porquê de não usar o SDK oficial do MCP no transporte).

## Como rodar

Pré-requisitos: Node.js ≥ 20, Python ≥ 3.10 (apenas para o validador).

```bash
# 1. Gerar e exportar o segredo de integridade do requestState
export REQUEST_STATE_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# 2. Instalar dependências (a partir da raiz do repositório)
cd servidor-mcp && npm ci && cd ..
cd agente && npm ci && cd ..

# 3. Subir o servidor MCP (terminal 1) — porta 7301
cd servidor-mcp && REQUEST_STATE_SECRET=$REQUEST_STATE_SECRET npm start

# 4. Subir o agente (terminal 2) — porta 7300
cd agente && npm start

# 5. Rodar o validador (terminal 3, a partir da raiz)
python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301
```

> `REQUEST_STATE_SECRET` precisa estar exportado no terminal do `servidor-mcp` **antes** de subir o processo (o processo recusa subir sem ele — ver `servidor-mcp/src/index.ts`). Nunca versione o valor usado — apenas o comando para gerá-lo (o repositório é público).

## Onde a ponte acontece

Toda a lógica da ponte vive em [`agente/src/bridge.ts`](./agente/src/bridge.ts):

- **`input_required` (MCP) → `TASK_STATE_INPUT_REQUIRED` (A2A)**: função `aplicarResultado`, [`agente/src/bridge.ts:37-45`](./agente/src/bridge.ts#L37-L45). Quando o resultado do `tools/call` traz `resultType: "input_required"`, a chave e o `requestState` são guardados em `task.pendente` (associados àquela Task especificamente, nunca em uma variável global) e a Task é colocada em `TASK_STATE_INPUT_REQUIRED` com a mensagem `alternativas: <ids>`.
- **`requestState` reenviado no retry**: função `processarContinuacao`, [`agente/src/bridge.ts:128-133`](./agente/src/bridge.ts#L128-L133). Ao receber `escolha=<valor>`, o agente monta `inputResponses` a partir do valor escolhido e chama `toolsCall("reservar_sala", ..., { inputResponses, requestState: pendente.requestState }, traceparent)` — um `tools/call` novo, com id de JSON-RPC novo (gerado em [`agente/src/mcpClient.ts`](./agente/src/mcpClient.ts) via `randomUUID()`), levando o `requestState` ecoado sem modificação.
- O agente nunca abre nem interpreta o `requestState` — ele só existe como `string` opaca dentro de `PendenteMrtr` ([`agente/src/task.ts`](./agente/src/task.ts)).

No lado do servidor, a metade "que termina a resposta em vez de perguntar" está em [`servidor-mcp/src/tools.ts`](./servidor-mcp/src/tools.ts), função `abrirConflito` (gera `inputRequests` + `requestState`) e `retomarReserva` (reconstrói o pedido original a partir do `requestState`, ignorando os argumentos reenviados pelo cliente).

## Decisões técnicas

- **Proteção do `requestState`**: HMAC-SHA256 via `node:crypto` (`createHmac`/`timingSafeEqual`), chave de `REQUEST_STATE_SECRET` (≥32 bytes, validado no boot). Payload = JSON com tudo que o servidor precisa para reconstruir o pedido (sala, início, fim, responsável, alternativas seladas) + expiração, codificado em base64url e assinado — formato `v1.<payload>.<assinatura>`. Implementação em [`servidor-mcp/src/requestState.ts`](./servidor-mcp/src/requestState.ts). O servidor não guarda nada em memória entre o `input_required` e o retry — só o token importa, por isso um retry funciona mesmo após reiniciar o processo.
- **Expiração**: 15 minutos (constante `TTL_MS` em `requestState.ts`), dentro da janela de 5–30 minutos exigida.
- **Onde fica o estado das Tasks**: em memória, no processo do agente, em um `Map<taskId, Task>` ([`agente/src/task.ts`](./agente/src/task.ts)). Cada Task guarda seu próprio `pendente` (chave + requestState + alternativas), por isso duas Tasks pausadas ao mesmo tempo não trocam estado entre si.
- **Limitação real do SDK oficial do MCP**: avaliamos usar `@modelcontextprotocol/sdk` (v1.30.0, publicado em 2026-07-27 — alinhado à revisão de spec 2026-07-28 do enunciado), mas o mecanismo de "Tasks" nativo do SDK é incompatível com o dialeto MRTR exigido por este desafio. Evidência: `TaskSchema` em `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts` define uma Task como `{ taskId, status: "working"|"input_required"|"completed"|"failed"|"cancelled", ttl, createdAt, lastUpdatedAt, pollInterval? }`, consultada por polling via `tasks/get` — um padrão assíncrono genérico, sem os campos `inputRequests` (mapa de `elicitation/create`) e `requestState` (token opaco) que o validador deste desafio exige dentro do resultado síncrono de `tools/call`. Forçar esses campos customizados através da camada de alto nível do SDK (que valida resultados com schemas Zod) exigiria contornar o próprio SDK. Por isso implementamos o transporte Streamable HTTP e o dialeto MRTR diretamente em TypeScript sobre `node:http`, seguindo fielmente o enunciado, os `exemplos/wire/` e o `validador/validar.py` — não reescrevendo o protocolo, apenas implementando exatamente o que ele exige sem a abstração incompatível do SDK.
- **Sem framework HTTP externo**: tanto `servidor-mcp` quanto `agente` usam `node:http` puro (zero dependências de produção além de `tsx` para rodar TypeScript diretamente) — dado que cada processo expõe só 1–2 rotas, um framework como Express/Fastify não se pagava.

## Saída do validador

Execução com os dois processos recém-iniciados, a partir de um estado limpo:

```
trace-id desta execucao: f96c29548c172781db97b92e0dfbab03
procure esse valor no stderr do servidor MCP para conferir a propagacao do traceparent.

PASS 01 tools/list traz as tres tools
PASS 02 toda tool tem inputSchema de objeto
PASS 03 listar_salas devolve structuredContent e o mesmo JSON em texto
PASS 04 _meta sem protocolVersion devolve -32602 e HTTP 400
PASS 05 _meta sem clientCapabilities devolve -32602 e HTTP 400
PASS 06 tool inexistente e recusada, por -32602 ou por isError
PASS 07 resources/read de politica://uso devolve a politica
PASS 08 resources/read de URI inexistente devolve -32602
PASS 09 sala inexistente devolve isError com a mensagem exata
PASS 10 fora da janela devolve isError com a mensagem exata
PASS 11 duracao acima de 2h devolve isError com a mensagem exata
PASS 12 intervalo invertido devolve isError com a mensagem exata
PASS 13 conflito devolve input_required com inputRequests e requestState
PASS 14 a elicitation e form mode e oferece as alternativas na ordem certa
PASS 15 conflito sem a capability elicitation devolve -32021 e HTTP 400
PASS 16 retry com inputResponses e requestState conclui a reserva
PASS 17 requestState adulterado e rejeitado com -32602
PASS 18 argumentos adulterados no retry nao tomam efeito
PASS 19 recusa conclui sem reservar e sem isError
PASS 20 conflito sem alternativa possivel devolve isError com a mensagem exata

PASS 21 agent card responde 200 no well-known com JSON
PASS 22 o card declara a interface JSON-RPC com url e versao 1.0
PASS 23 o card declara a skill reservar-sala
PASS 24 SendMessage com sala livre conclui a Task
PASS 25 o artifact chama reserva e traz a versao da politica
PASS 26 GetTask devolve id, contextId e estado corrente
PASS 27 SendMessage com sala ocupada pausa a Task
PASS 28 a Task pausada lista as alternativas na ordem certa
PASS 29 escolha fora do enum mantem a Task pausada
PASS 30 a continuacao conclui a Task na sala escolhida
PASS 31 SendMessage em Task terminal e recusado
PASS 32 a recusa termina a Task em CANCELED
PASS 33 duas Tasks pausadas ao mesmo tempo concluem cada uma com a sua reserva
PASS 34 nenhuma resposta A2A carrega o requestState
PASS 35 sala inexistente termina a Task em FAILED com a mensagem da tool
PASS 36 o agente e deterministico: o mesmo pedido produz a mesma pausa

resumo: 36 passaram, 0 falharam, de 36 verificacoes
```

Código de saída: `0`.
