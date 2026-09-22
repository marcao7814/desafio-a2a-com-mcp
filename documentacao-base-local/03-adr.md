# Registro de Decisões de Arquitetura (ADR)

**Documento:** 03-adr.md
**Depende de:** [02-architecture.md](./02-architecture.md)
**Formato:** cada ADR segue Contexto → Decisão → Consequências, conforme [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

---

## ADR-0001 — Stack de implementação: Node.js 20+ / TypeScript

**Status:** Aceito

**Contexto:** O enunciado permite Node.js 20+ (`@modelcontextprotocol/server`, ESM) ou Python 3.10+ (`mcp`), sem influência na nota. É preciso fixar uma linguagem única para os dois processos (`servidor-mcp/` e `agente/`) para manter consistência de ferramentas, tipagem e build.

**Decisão:** Usar Node.js 20+ com TypeScript em ambos os processos.

**Consequências:**
- Tipagem estática ajuda a manter os contratos de wire (`_meta`, `structuredContent`, Task) fiéis à spec.
- O validador continua em Python (imposto pelo starter, não pode ser alterado) — o repositório terá duas linguagens, mas nenhuma delas conversa em nível de código; a fronteira é sempre HTTP.
- Precisa confirmar o nome exato do pacote npm oficial do MCP SDK v2 no momento da implementação (ver [06-stack.md §2](./06-stack.md#2-sdk-mcp)).

---

## ADR-0002 — Dois processos separados, comunicação exclusivamente por HTTP

**Status:** Aceito (imposto pelo enunciado como restrição não negociável)

**Contexto:** É tentador, num desafio pequeno, importar a função da tool direto no código do agente para "economizar" uma chamada HTTP. O enunciado proíbe isso explicitamente — descaracteriza a entrega, porque o desafio testa o protocolo, não o resultado funcional.

**Decisão:** `agente` e `servidor-mcp` são dois processos Node independentes, cada um com seu próprio `package.json`, subindo em portas distintas (7300 e 7301) e falando exclusivamente via Streamable HTTP (MCP) e JSON-RPC/HTTP (A2A).

**Consequências:**
- O agente precisa de um client MCP real (com transporte HTTP), não de um wrapper em memória.
- Habilita testar cada processo isoladamente (ex.: MCP Inspector direto no `servidor-mcp`).
- Adiciona latência de rede local irrelevante para o escopo do desafio.

---

## ADR-0003 — Proteção do `requestState` com HMAC-SHA256 stateless

**Status:** Aceito

**Contexto:** O `requestState` viaja pelas mãos do cliente (o agente) e volta no retry — é entrada controlada por atacante. A spec exige integridade verificável e expiração entre 5 e 30 minutos, e proíbe estado guardado em memória do servidor entre o `input_required` e o retry (precisa sobreviver a um restart do `servidor-mcp`).

**Decisão:** Serializar todo o contexto necessário para reconstruir o pedido (sala pedida original, intervalo, responsável, chave do `inputRequests`, timestamp de emissão, TTL) em um payload JSON, assinar com HMAC-SHA256 (`node:crypto`, chave de `REQUEST_STATE_SECRET`) e codificar em base64url. Cifra (AEAD) fica como opção futura, não obrigatória — a spec só exige detectar adulteração, não sigilo do conteúdo.

**Consequências:**
- O servidor MCP fica genuinamente stateless entre `input_required` e o retry — nenhum Map/cache de pendências.
- Um caractere alterado no token quebra a verificação HMAC → `-32602`, conforme exigido.
- Reiniciar o `servidor-mcp` não invalida tokens emitidos antes do restart (a chave vem de variável de ambiente, não de estado em memória).
- Se o `REQUEST_STATE_SECRET` mudar (rotação), todo `requestState` emitido com a chave antiga passa a falhar — comportamento aceito e documentado no runbook.

---

## ADR-0004 — MRTR nativo do SDK, nunca callback síncrono de elicitation

**Status:** Aceito

**Contexto:** É o erro mais caro do desafio (citado explicitamente no enunciado): tentar manter a chamada `tools/call` aberta esperando resposta do usuário, ou usar um callback de elicitation que o próprio SDK resolve sozinho no cliente. Os dois caminhos quebram a ponte — no primeiro caso o transporte rejeita porque não há canal de volta; no segundo a Task nunca pausa porque o client MCP "engole" a pergunta.

**Decisão:** No servidor, usar o mecanismo de primeira classe do SDK para `input_required` (a terminologia varia entre SDKs: `input_required` no lado Python, `inputRequired` no lado TypeScript) — a tool **termina** a resposta em vez de manter a conexão aberta. No agente, o client MCP precisa expor o `input_required` cru para a camada de aplicação, sem callback automático de elicitation.

**Consequências:**
- O agente implementa sua própria lógica de "o que fazer com um input_required" (o Tradutor da Ponte, ver [02-architecture.md §3.2](./02-architecture.md#32-componentes-do-agente)), em vez de delegar ao SDK.
- Fica explícito no código onde a Task pausa e onde ela retoma — exigido pelo README (seção "Onde a ponte acontece").

---

## ADR-0005 — Persistência em memória, sem banco de dados

**Status:** Aceito (imposto pelo enunciado)

**Contexto:** O domínio é deliberadamente simples. Reservas criadas em runtime precisam ser visíveis para consultas seguintes do mesmo processo, mas não precisam sobreviver a um restart. Introduzir um banco de dados ou ORM seria trabalhar no lugar errado.

**Decisão:** Reservas novas ficam em uma estrutura em memória (`Map`) dentro do processo `servidor-mcp`, inicializada a partir de `dados/reservas.json` no boot. Tasks e o `requestState` guardado por Task ficam em outra estrutura em memória, dentro do processo `agente`.

**Consequências:**
- Nenhuma dependência de infraestrutura externa.
- Reiniciar qualquer um dos dois processos limpa o respectivo estado em memória (exceto o `requestState`, que sobrevive porque não depende de estado do servidor — ver ADR-0003).
- Concorrência de escrita e corrida entre reservas no mesmo milissegundo estão fora de escopo (não implementar lock/transação).

---

## ADR-0006 — Camada A2A implementada diretamente sobre JSON-RPC, sem SDK dedicado

**Status:** Aceito

**Contexto:** O enunciado não exige um SDK A2A específico — apenas "A2A v1.0, binding JSON-RPC 2.0 sobre HTTP". Não há necessidade de framework pesado para dois métodos (`SendMessage`, `GetTask`) e um endpoint estático (Agent Card).

**Decisão:** Implementar a camada A2A como um handler HTTP fino (Fastify) que roteia `POST /a2a` para um dispatcher JSON-RPC 2.0 escrito à mão, e serve `GET /.well-known/agent-card.json` como JSON estático/gerado a partir de um objeto TypeScript tipado.

**Consequências:**
- Controle total sobre a forma exata dos payloads (crítico para bater com `exemplos/wire/07-a2a-agent-card.json` e `08-a2a-send-message.json`).
- Sem dependência de um SDK A2A de terceiros que possa divergir da v1.0 ou trazer funcionalidades fora de escopo (streaming, push notification).

---

## ADR-0007 — Logging mínimo em stderr, sem OpenTelemetry

**Status:** Aceito (imposto pelo enunciado)

**Contexto:** O enunciado exige apenas a propagação do `traceparent` e seu registro em log — explicitamente não exige spans ou atributos OpenTelemetry.

**Decisão:** Registrar em stderr, por request, no mínimo: método JSON-RPC, id e o valor de `traceparent` (quando presente em `_meta`). Sem biblioteca de tracing distribuído.

**Consequências:**
- O stderr do `servidor-mcp` (com o MCP Inspector aberto ao lado) é o instrumento primário de depuração, conforme runbook (ver [09-runbook.md](./09-runbook.md)).
- Simplicidade: nenhuma dependência de coletor/exportador OTel.
