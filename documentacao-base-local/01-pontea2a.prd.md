# PRD — A Ponte: um agente A2A com MCP por dentro

**Documento:** 01-pontea2a.prd.md
**Fonte:** [solicitacao.md](./solicitacao.md)
**Status:** Aprovado para implementação
**Stack definida:** Node.js 20+ / TypeScript

**Verificação cruzada:** este PRD foi conferido contra os 10 documentos de `documentacao-base-local/` (02 a 11) e incorpora, inline, os elementos necessários para começar a implementar sem precisar abrir outro arquivo — portas, mensagens de erro exatas, payloads-chave, variáveis de ambiente e comandos de subida. Onde o assunto tem profundidade maior que cabe aqui (JSON Schema completo, os 37 casos de teste, o racional completo de cada ADR, o troubleshooting operacional), a seção correspondente linka o documento especializado, que é a fonte normativa daquele detalhe. Em qualquer divergência, vale a ordem: `solicitacao.md` → documento especializado → este PRD.

## 1. Contexto

A Hill Valley Tech tem cinco salas de reunião controladas hoje por planilha compartilhada. A decisão de arquitetura já foi tomada: expor as salas como capacidade de agente via dois protocolos — MCP (Model Context Protocol) por dentro e A2A (Agent2Agent) por fora. Este desafio é um exercício de protocolo e de gestão de estado sem sessão, não um exercício de modelagem de domínio.

## 2. Problema

Nenhum dos dois protocolos (MCP, A2A) tem sessão. Quando o servidor MCP precisa de mais informação do usuário (conflito de horário), não existe canal de volta síncrono: o servidor termina a resposta pedindo informação (MRTR / `input_required`), e é o cliente que volta com um novo request. Do lado de fora, o A2A resolve o mesmo problema com a Task, que tem identidade, estado e produto. O agente vive nessa fronteira e precisa costurar esses dois mecanismos de estado nomeado sem inventar um terceiro (sessão implícita, callback síncrono, etc.).

## 3. Objetivo do produto

Entregar um par de processos — um servidor MCP e um agente que é host MCP por dentro e servidor A2A por fora — que permita a qualquer agente da empresa reservar uma das cinco salas por meio de um fluxo determinístico, sem LLM, verificável por um validador de conformidade de 36 checagens.

## 4. Público / stakeholders

- **Avaliador do desafio**: roda `validador/validar.py` contra o fork e segue apenas o README do aluno, a partir de um clone limpo.
- **Outros agentes da empresa (consumidores do A2A)**: descobrem a skill `reservar-sala` pelo Agent Card e chamam via `SendMessage`/`GetTask`.
- **Desenvolvedor (você)**: implementa os dois processos dentro da estrutura imutável do starter.

## 5. Decisões de produto já fechadas (não estão em discussão)

| Decisão | Valor |
|---|---|
| Formato do pedido | `reservar sala=<id> inicio=<iso8601> fim=<iso8601> responsavel=<nome>` (texto fixo, não linguagem natural) |
| Formato da resposta à pausa | `escolha=<id da sala>` ou `escolha=recusar` |
| Alternativas oferecidas | Salas livres no intervalo, capacidade ≥ à pedida, no máximo 3, ordenadas por capacidade crescente e, em empate, por id alfabético |
| Dependência de data corrente | Nenhuma; reservar no passado é permitido |
| Persistência de reservas | Em memória, visível dentro do mesmo processo, não sobrevive a restart |
| Persistência do `requestState` | Precisa sobreviver a um restart do servidor MCP (o estado viaja no token, não no processo) |
| Uso de LLM | Proibido no caminho de execução do agente |
| Autenticação/Autorização | Fora de escopo em qualquer camada |

## 6. Arquitetura em um relance

```
Cliente A2A                Agente (host MCP + servidor A2A)             Servidor MCP
   |  GET /.well-known/agent-card.json  |                                     |
   |------------------------------------>|                                     |
   |  POST /a2a  SendMessage             |                                     |
   |------------------------------------->| tools/list (descoberta)            |
   |                                       |------------------------------------>|
   |                                       | resources/read politica://uso      |
   |                                       |------------------------------------>|
   |                                       | tools/call reservar_sala (id=n)    |
   |                                       |------------------------------------>|
   |                                       |<--- input_required + requestState --|
   |<--- Task INPUT_REQUIRED "alternativas: ..." |                              |
   |  POST /a2a  SendMessage "escolha=X"  |                                     |
   |-------------------------------------->| tools/call (id=n+1, inputResponses, requestState) |
   |                                       |------------------------------------>|
   |                                       |<---------- complete ----------------|
   |<--- Task COMPLETED + artifact reserva |                                     |
```

Dois processos independentes, comunicação exclusivamente por HTTP real (nunca chamada de função direta entre eles). Diagramas C4 completos (Contexto, Container, Componente) em [02-architecture.md](./02-architecture.md); racional de cada decisão estrutural em [03-adr.md](./03-adr.md).

## 7. Portas, endpoints e variáveis de ambiente

| Processo | Porta padrão | Endpoint | Protocolo |
|---|---|---|---|
| Agente | 7300 | `/a2a` (JSON-RPC), `/.well-known/agent-card.json` | A2A v1.0 sobre JSON-RPC 2.0/HTTP |
| Servidor MCP | 7301 | `/mcp` | MCP v2, Streamable HTTP, spec 2026-07-28 |

Portas parametrizáveis por variável de ambiente, com esses valores como default.

| Variável | Processo | Obrigatória | Descrição |
|---|---|---|---|
| `REQUEST_STATE_SECRET` | servidor-mcp | Sim | Chave HMAC/AEAD, ≥32 bytes de aleatoriedade. Gerar com `python3 -c "import secrets; print(secrets.token_hex(32))"`. Nunca hardcoded, nunca versionado. |
| `MCP_PORT` | servidor-mcp | Não (default 7301) | Porta do transporte Streamable HTTP |
| `A2A_PORT` | agente | Não (default 7300) | Porta do endpoint A2A |
| `MCP_SERVER_URL` | agente | Não (default `http://localhost:7301/mcp`) | URL do servidor MCP consumido pelo agente |

## 8. Fluxo de valor (jornada ponta a ponta)

1. Cliente A2A busca o Agent Card, descobre a skill `reservar-sala`, envia `SendMessage` com o pedido em texto.
2. Agente abre uma Task, chama `reservar_sala` no servidor MCP.
   - **Caminho livre**: Task conclui em `TASK_STATE_COMPLETED` com artifact `reserva`.
   - **Caminho de conflito**: servidor devolve `input_required` com elicitation de alternativas + `requestState` opaco. Agente pausa a Task em `TASK_STATE_INPUT_REQUIRED`, expõe a linha `alternativas: <ids>`.
3. Cliente responde com novo `SendMessage` na mesma Task (`escolha=<id>` ou `escolha=recusar`).
4. Agente repete o `tools/call` original (id JSON-RPC novo) com `inputResponses` + `requestState` ecoado.
5. Servidor conclui a reserva ou cancela; Task termina em `TASK_STATE_COMPLETED` ou `TASK_STATE_CANCELED`.

## 9. Especificação funcional — Servidor MCP

- Transporte Streamable HTTP, endpoint único `/mcp`, porta 7301.
- Toda request precisa trazer, em `_meta`: `io.modelcontextprotocol/protocolVersion` e `io.modelcontextprotocol/clientCapabilities`. Ausência de qualquer um → `-32602` + HTTP 400. Não inferir de request anterior.
- Capabilities declaradas: `tools`, `resources`.

| Tool | Parâmetros (`inputSchema`) | Retorno |
|---|---|---|
| `listar_salas` | nenhum | `structuredContent` conforme `outputSchema` (array de salas) **+** o mesmo JSON serializado em bloco de texto |
| `consultar_disponibilidade` | `sala`, `inicio`, `fim` (todos obrigatórios) | `{ livre: boolean, conflitos?: Reserva[] }`; mesmas validações e mensagens de erro de `reservar_sala` |
| `reservar_sala` | `sala`, `inicio`, `fim`, `responsavel` (todos obrigatórios) | reserva criada (`structuredContent`: `reserva`, `reservado`, `sala`, `inicio`, `fim`, `responsavel`, `politica`) ou `input_required` em caso de conflito |

Resource: URI `politica://uso`, `mimeType: text/markdown`, conteúdo = `dados/politica-de-uso.md` literal. `resources/read` de URI inexistente → `-32602` (nunca `contents` vazio).

Logging: cada request registrado em stderr com, no mínimo, método, id e `traceparent` (quando presente em `_meta`). Nunca usar API de logging depreciada do SDK.

Schemas JSON completos e exemplos de payload em [05-contract.md §2](./05-contract.md#2-contratos-mcp).

## 10. Regras de negócio e mensagens de erro exatas (fonte única de verdade)

**Erros de execução** (`isError: true`, dentro de resultado `complete`) — prefixos de SDK (ex.: `Error executing tool <nome>:`) são aceitos, o texto exato não pode variar:

| Condição | Mensagem exata |
|---|---|
| Sala não existe | `Sala inexistente: <id informado>` |
| Início ou fim fora de 08:00–20:00 (-03:00) | `Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00` |
| Duração > 2h | `Duracao acima do limite: a politica permite no maximo 2 horas` |
| `fim <= inicio` | `Intervalo invalido: fim deve ser posterior a inicio` |
| Conflito sem alternativa válida | `Sem alternativas disponiveis no intervalo` |

**Erros de protocolo** (JSON-RPC `error`):

| Condição | Código | HTTP |
|---|---|---|
| Tool inexistente | `-32602` (ou `isError: true`, ambos aceitos) | — |
| `_meta` sem `protocolVersion` ou `clientCapabilities` | `-32602` | 400 |
| Elicitation exigida sem capability `elicitation.form` declarada | `-32021`, com `data.requiredCapabilities` | 400 |
| `requestState` inválido/expirado | `-32602` | — |
| `resources/read` de URI inexistente | `-32602` | — |
| Header mismatch (`Mcp-Method`/`Mcp-Name` ≠ corpo) | `-32020` | — |

**Não é erro**: recusa (`decline`/`cancel`) na elicitation → resultado `complete`, `isError` ausente/`false`, `structuredContent.reservado = false` + motivo.

## 11. O ciclo de MRTR (a costura central)

1. Conflito detectado → `reservar_sala` responde `resultType: "input_required"`.
2. `inputRequests`: mapa de uma entrada só, chave gerada pelo servidor, valor = request `elicitation/create` em `mode: "form"`.
3. `requestedSchema`: objeto plano, propriedade `sala` (string), `enum` com as alternativas (ou `const` se houver só uma).
4. Sem alternativa → sem elicitation; `isError: true` com `Sem alternativas disponiveis no intervalo`.
5. `requestState`: protegido por HMAC ou AEAD (assinatura obrigatória, cifra opcional), expiração entre 5 e 30 minutos, contém tudo que o servidor precisa para reconstruir o pedido — **nenhum estado em memória do servidor entre `input_required` e o retry**. Precisa funcionar após restart do processo.
6. Chave de integridade: variável de ambiente `REQUEST_STATE_SECRET`, ≥32 bytes de aleatoriedade, nunca hardcoded.
7. `requestState` adulterado ou expirado → `-32602`.
8. No retry, argumentos reenviados pelo cliente não são confiáveis: divergência do que foi selado não pode ter efeito (rejeitar ou usar valores selados — ambos aceitos).
9. Cliente sem capability de elicitation form → `-32021` (nunca tenta enviar elicitation mesmo assim).
10. Retry: servidor lê `inputResponses` + `requestState` de dentro de `params`, reconstrói do próprio `requestState`, conclui.
11. `action: decline` ou `cancel` → conclui sem reservar (não é erro).

**Payload do conflito** (resumo — forma completa em `exemplos/wire/03-tools-call-conflito-input-required.json`):
```json
{
  "jsonrpc": "2.0", "id": 7,
  "result": {
    "resultType": "input_required",
    "inputRequests": {
      "<chave gerada pelo servidor>": {
        "method": "elicitation/create",
        "params": {
          "mode": "form",
          "message": "A sala pedida esta ocupada nesse intervalo. Escolha uma alternativa.",
          "requestedSchema": { "type": "object", "properties": { "sala": { "type": "string", "enum": ["sala-fusca", "sala-mirante"] } }, "required": ["sala"] }
        }
      }
    },
    "requestState": "<opaco, HMAC/AEAD, expira em 5-30min>"
  }
}
```

**Payload do retry** — `id` **diferente** do request inicial (obrigatório):
```json
{
  "jsonrpc": "2.0", "id": 8, "method": "tools/call",
  "params": {
    "name": "reservar_sala",
    "arguments": { "sala": "sala-garagem", "inicio": "2026-11-03T14:00:00-03:00", "fim": "2026-11-03T15:00:00-03:00", "responsavel": "Marty" },
    "inputResponses": { "<mesma chave de inputRequests>": { "action": "accept", "content": { "sala": "sala-fusca" } } },
    "requestState": "<mesmo valor opaco, ecoado sem modificação>",
    "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": { "elicitation": { "form": {} } }, "traceparent": "00-<trace-id>-<span-id>-01" }
  }
}
```

Contratos completos em [05-contract.md §2.5-2.6](./05-contract.md#25-reservar_sala--conflito-input_required).

## 12. Agente como host MCP

- Descobre tools via `tools/list` **antes** da primeira chamada — nunca lista fixa hardcoded.
- Lê o resource `politica://uso` e extrai a versão da primeira linha (`versao: <data>`).
- Todo request MCP carrega `_meta` obrigatório e declara `{"elicitation": {"form": {}}}`.
- Headers espelhados do corpo: `MCP-Protocol-Version`, `Mcp-Method`, e em `tools/call`/`resources/read`, `Mcp-Name`. Mismatch → `-32020`.
- Propaga o `traceparent` recebido do cliente A2A (mesmo trace-id; span-id pode ser novo) em todos os requests MCP daquela Task.
- Erro de execução da tool (`isError: true`) → Task `TASK_STATE_FAILED`, com a mensagem exata da tool visível no histórico.

## 13. Agente como servidor A2A

- `GET /.well-known/agent-card.json` → card v1.0 (interface JSON-RPC, URL do endpoint, versão de protocolo `1.0`, capabilities, skill `id: reservar-sala`). Forma fiel a `exemplos/wire/07-a2a-agent-card.json`.
- `/a2a` aceita `SendMessage` e `GetTask` (binding JSON-RPC).
- `SendMessage` sem `taskId` → nova Task (`id`, `contextId` próprios).
- Máquina de estados: `SUBMITTED` → `WORKING` → estado terminal (`COMPLETED`/`CANCELED`/`FAILED`). `GetTask` reflete o estado corrente a qualquer momento.
- Sucesso → artifact `name: "reserva"`, conteúdo = JSON da reserva, incluindo `politica` (versão lida do resource).
- Estado terminal é definitivo — `SendMessage` para Task terminal é recusado com erro.

**Artifact de sucesso:**
```json
{ "name": "reserva", "parts": [{ "text": "{\"reserva\":\"res-0003\",\"sala\":\"sala-fusca\",\"inicio\":\"2026-11-03T14:00:00-03:00\",\"fim\":\"2026-11-03T15:00:00-03:00\",\"responsavel\":\"Marty\",\"politica\":\"2026-11-01\"}" }] }
```

Contratos completos (`SendMessage`, `GetTask`, Agent Card) em [05-contract.md §3](./05-contract.md#3-contratos-a2a).

## 14. A ponte — mapeamento exato

- `input_required` (MCP) → `TASK_STATE_INPUT_REQUIRED` (A2A). Mensagem de texto da Task = **exatamente** `alternativas: <ids separados por virgula e espaco>`, na ordem do `enum`. Sem prefixo, sem saudação (comparação byte a byte pelo avaliador).
- `requestState` fica guardado no agente, associado à Task — nunca exposto em card, artifact ou mensagem A2A. **Opaco**: o agente nunca abre, interpreta ou reconstrói o conteúdo.
- Continuação: `SendMessage` com `taskId` + texto `escolha=<valor>`.
  - Fora do enum → mantém `TASK_STATE_INPUT_REQUIRED`, repete a lista de alternativas.
  - `escolha=recusar` → `action: decline` na elicitation → Task `TASK_STATE_CANCELED`.
  - `escolha=<id válido>` → `action: accept`, `content: {"sala": "<id>"}`.
- Retry ao MCP: **novo id de JSON-RPC**, `inputResponses` com a mesma chave recebida, `requestState` ecoado sem modificação.
- Estado pausado é por Task: duas Tasks pausadas simultaneamente não trocam `requestState` entre si.

## 15. Requisitos não funcionais

- **Determinismo**: mesmo pedido, mesmo resultado, sempre. Nenhuma dependência de SDK de LLM no `package.json`.
- **Sem sessão**: nenhum lado infere versão/capabilities/contexto de request anterior ou conexão aberta (manter um client MCP vivo entre chamadas é normal; o que é proibido é inferir estado de protocolo).
- **Sem persistência em disco** de reservas; `requestState` é a exceção (precisa sobreviver a restart do servidor MCP).
- **Sem autenticação/autorização** em nenhuma camada.
- Logging mínimo em stderr (método, id, `traceparent`) — sem OpenTelemetry.

## 16. Restrições não negociáveis

1. Dois processos separados, comunicação HTTP real (nunca import direto da tool no código do agente).
2. Agente não implementa regra de negócio de sala (conflito/política/alternativas são decisão exclusiva do servidor MCP).
3. Nada de sessão — ver seção 15.
4. `requestState` opaco para o agente.
5. Sem LLM no caminho de execução.
6. Limitação real de SDK → documentar no README com evidência, nunca contornar reescrevendo o protocolo.

## 17. Decisões de arquitetura (resumo dos ADRs)

| ADR | Decisão |
|---|---|
| [ADR-0001](./03-adr.md#adr-0001--stack-de-implementação-nodejs-20-typescript) | Node.js 20+ / TypeScript nos dois processos |
| [ADR-0002](./03-adr.md#adr-0002--dois-processos-separados-comunicação-exclusivamente-por-http) | Dois processos separados, comunicação exclusivamente por HTTP |
| [ADR-0003](./03-adr.md#adr-0003--proteção-do-requeststate-com-hmac-sha256-stateless) | `requestState` assinado com HMAC-SHA256, servidor genuinamente stateless entre `input_required` e o retry |
| [ADR-0004](./03-adr.md#adr-0004--mrtr-nativo-do-sdk-nunca-callback-síncrono-de-elicitation) | MRTR nativo do SDK (`input_required`/`inputRequired`), nunca callback síncrono de elicitation |
| [ADR-0005](./03-adr.md#adr-0005--persistência-em-memória-sem-banco-de-dados) | Persistência em memória (`Map`), sem banco de dados |
| [ADR-0006](./03-adr.md#adr-0006--camada-a2a-implementada-diretamente-sobre-json-rpc-sem-sdk-dedicado) | Camada A2A implementada direto sobre JSON-RPC 2.0 (Fastify), sem SDK A2A dedicado |
| [ADR-0007](./03-adr.md#adr-0007--logging-mínimo-em-stderr-sem-opentelemetry) | Logging mínimo em stderr, sem OpenTelemetry |

Contexto, decisão e consequências completos de cada ADR em [03-adr.md](./03-adr.md).

## 18. Stack tecnológica (resumo executável)

- **Runtime**: Node.js ≥ 20.x, ESM (`"type": "module"`), TypeScript ^5.x compilado com `tsc`.
- **SDK MCP**: pacote oficial v2, spec 2026-07-28 (enunciado nomeia `@modelcontextprotocol/server`; **confirmar o nome exato publicado no npm** antes de travar a versão em `package.json`).
- **Camada A2A**: sem SDK dedicado — handler HTTP fino (Fastify) com dispatcher JSON-RPC 2.0 escrito à mão para `/a2a`, e `GET /.well-known/agent-card.json` a partir de um objeto TypeScript tipado.
- **Integridade do `requestState`**: `node:crypto` (`createHmac('sha256', secret)`), sem dependência externa; `jose` é alternativa se quiser cifrar (opcional).
- **Logging**: `console.error`/`pino` para stderr — nunca a API depreciada do SDK.
- **Empacotamento**: dois `package.json` independentes (`servidor-mcp/`, `agente/`), `package-lock.json` com versões travadas nas dependências centrais.
- **Testes**: `python3 validador/validar.py` é a fonte de verdade da conformidade; `node:test` (built-in) opcional para lógica de política isolada.

Detalhamento completo em [06-stack.md](./06-stack.md).

## 19. Como rodar (comandos)

```bash
# 1. Gerar e exportar o segredo de integridade do requestState
export REQUEST_STATE_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# 2. Instalar dependências
cd servidor-mcp && npm ci && cd ..
cd agente && npm ci && cd ..

# 3. Subir o servidor MCP (terminal 1) — porta 7301
cd servidor-mcp && npm start

# 4. Subir o agente (terminal 2) — porta 7300
cd agente && npm start

# 5. Rodar o validador (terminal 3, a partir da raiz)
python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301
```

Runbook completo (verificações de saúde, restart, depuração por sintoma, rotação de segredo) em [09-runbook.md](./09-runbook.md).

## 20. As três fricções propositais (riscos de execução conhecidos)

1. **Sem canal de volta no transporte stateless** — tentar callback síncrono do servidor para o cliente falha com um erro explícito. Solução: usar o mecanismo de MRTR/`input_required` nativo do SDK, não um callback de elicitation síncrono ([ADR-0004](./03-adr.md#adr-0004--mrtr-nativo-do-sdk-nunca-callback-síncrono-de-elicitation)).
2. **Elicitation exige capability declarada** — cliente sem `io.modelcontextprotocol/clientCapabilities.elicitation.form` recebe `-32021`.
3. **`requestState` é entrada controlada por atacante** — precisa de HMAC/AEAD real, não apenas um JSON em base64 sem assinatura ([ADR-0003](./03-adr.md#adr-0003--proteção-do-requeststate-com-hmac-sha256-stateless)).

## 21. Critérios de sucesso / aceite

- `python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301` passa nas 36 verificações com saída 0, a partir de um clone limpo.
- README com as 4 seções obrigatórias (Como rodar, Onde a ponte acontece, Decisões técnicas, Saída do validador) e comandos verificados.
- Toda a checklist de Critérios de Aceite marcada — 37 casos de teste (TC-01 a TC-37), agrupados em Servidor MCP, MRTR, Agente host MCP, Agente A2A, A ponte e Validação/entrega, detalhados em [07-testplan.md](./07-testplan.md).

## 22. Fora de escopo

Autenticação/autorização, streaming (`SendStreamingMessage`/SSE/push notification), refinamento de Task e `referenceTaskIds`, card estendido autenticado e assinatura JWS, prompts/subscriptions/progress do MCP, container/compose/deploy/gateway, spans e atributos de OpenTelemetry, concorrência de escrita e corrida entre reservas no mesmo milissegundo, persistência em disco das reservas, interface gráfica de qualquer tipo.

## 23. Entregáveis

- Repositório público no GitHub, fork de `devfullcycle/desafio-a2a-com-mcp`, entrega na branch `main`.
- `servidor-mcp/` e `agente/` preenchidos; `dados/`, `validador/`, `exemplos/` intocados.
- `README.md` na raiz substituído pela documentação da entrega (com os comandos de subida, onde a ponte acontece, decisões técnicas e saída do validador).

## 24. Documentos relacionados (verificação cruzada)

| Documento | Conteúdo | Consultado nesta versão |
|---|---|---|
| [02-architecture.md](./02-architecture.md) | Modelo C4 (Contexto, Container, Componente) | ✅ diagrama macro refletido na seção 6 |
| [03-adr.md](./03-adr.md) | 7 ADRs com contexto/decisão/consequências | ✅ resumido na seção 17 |
| [04-specs.md](./04-specs.md) | Especificação técnica completa | ✅ base das seções 6-16 |
| [05-contract.md](./05-contract.md) | Contratos de wire exatos (MCP e A2A) | ✅ payloads-chave nas seções 11 e 13 |
| [06-stack.md](./06-stack.md) | Stack tecnológica detalhada | ✅ resumida na seção 18 |
| [07-testplan.md](./07-testplan.md) | 37 casos de teste + roteiro manual | ✅ referenciado na seção 21 |
| [08-readme.md](./08-readme.md) | Rascunho do README de entrega | ✅ comandos replicados na seção 19 |
| [09-runbook.md](./09-runbook.md) | Runbook operacional | ✅ referenciado na seção 19 |
| [10-contributing.md](./10-contributing.md) | Guia de contribuição e ordem de implementação | ✅ regras invioláveis alinhadas às seções 16 e 23 |
| [11-changelog.md](./11-changelog.md) | Histórico de mudanças | ✅ sem conflito de conteúdo |
