# Stack Tecnológica

**Documento:** 06-stack.md
**Depende de:** [04-specs.md](./04-specs.md), [05-contract.md](./05-contract.md)
**Decisão registrada em:** [03-adr.md ADR-0001](./03-adr.md#adr-0001--stack-de-implementação-nodejs-20-typescript)

Node.js 20+ / TypeScript para os dois processos (`servidor-mcp/` e `agente/`). A escolha não influencia a nota do desafio; registrada aqui para manter os dois projetos consistentes.

## 1. Runtime e linguagem
- Node.js ≥ 20.x (LTS), módulos ESM (`"type": "module"` em cada `package.json`).
- TypeScript ^5.x, compilado com `tsc` (build) e executado em runtime Node puro (sem transpile-on-the-fly em produção; `tsx` aceitável apenas em scripts de dev).

## 2. SDK MCP
- Pacote oficial do MCP para Node.js, v2, alinhado à revisão de spec 2026-07-28 (o enunciado o nomeia como `@modelcontextprotocol/server`; **confirmar o nome exato publicado no npm no momento da implementação**, pode ter mudado para `@modelcontextprotocol/sdk` ou correlato — travar a versão exata em `package.json`/`package-lock.json` assim que confirmado).
- Usar o transporte Streamable HTTP embutido do SDK.
- Usar o mecanismo nativo de `input_required`/MRTR do SDK — não o callback síncrono de elicitation (ver [03-adr.md ADR-0004](./03-adr.md#adr-0004--mrtr-nativo-do-sdk-nunca-callback-síncrono-de-elicitation)).

## 3. Camada A2A
- Não há SDK oficial exigido para A2A v1.0 — é JSON-RPC 2.0 puro sobre HTTP.
- Implementação própria: um handler HTTP simples (Fastify, ver [03-adr.md ADR-0006](./03-adr.md#adr-0006--camada-a2a-implementada-diretamente-sobre-json-rpc-sem-sdk-dedicado)) expondo `/a2a` (JSON-RPC) e `/.well-known/agent-card.json` (JSON estático/dinâmico).
- Express é alternativa aceitável a Fastify — decisão não crítica, desde que suporte JSON body parsing e roteamento simples.

## 4. Cliente MCP (dentro do agente)
- Mesmo pacote do SDK MCP (papel de client), usado para `tools/list`, `resources/read`, `tools/call` contra `servidor-mcp` via HTTP real — nunca import direto de função.
- Manter uma instância de client viva entre chamadas é permitido (não é "sessão de protocolo").

## 5. Integridade do `requestState`
- `node:crypto` nativo (`createHmac('sha256', secret)`) para assinatura HMAC — sem dependência externa.
- Alternativa aceitável: `jose` (JWE/JWS) se for preferível cifrar além de assinar (cifra é opcional, assinatura é obrigatória).
- Expiração embutida no payload assinado (timestamp + TTL 5–30 min), verificada antes de aceitar o retry.
- Segredo: variável de ambiente `REQUEST_STATE_SECRET`, ≥32 bytes de aleatoriedade — nunca no código-fonte ou versionado.

## 6. Logging
- `console.error` (stderr) ou `pino` configurado para stderr — nunca a API de logging depreciada do SDK MCP.
- Campos mínimos por request: método, id, `traceparent` (quando presente).

## 7. Testes e validação
- `python3 validador/validar.py` (Python 3.10+, zero dependência externa) — fonte de verdade da conformidade, não substituível por testes próprios.
- Testes unitários opcionais com `node:test` (built-in, sem dependência extra) para lógica de política/regras antes de rodar o validador.

## 8. Empacotamento
- Dois projetos Node independentes: `servidor-mcp/package.json` e `agente/package.json`, cada um com suas próprias dependências e `package-lock.json` — **versões travadas**, sem `^`/`~` soltos nas dependências centrais (SDK MCP, framework HTTP).
- Scripts npm sugeridos: `build`, `start`, `dev`.

## 9. Variáveis de ambiente

| Variável | Processo | Obrigatória | Descrição |
|---|---|---|---|
| `REQUEST_STATE_SECRET` | servidor-mcp | Sim | Chave HMAC/AEAD, ≥32 bytes hex |
| `MCP_PORT` | servidor-mcp | Não (default 7301) | Porta do transporte Streamable HTTP |
| `A2A_PORT` | agente | Não (default 7300) | Porta do endpoint A2A |
| `MCP_SERVER_URL` | agente | Não (default `http://localhost:7301/mcp`) | URL do servidor MCP consumido pelo agente |

## 10. Fora do escopo da stack
Sem ORM, sem banco de dados, sem LLM SDK, sem OpenTelemetry, sem container/orquestração (ver restrições em [04-specs.md §10-11](./04-specs.md#10-restrições-não-negociáveis)).
