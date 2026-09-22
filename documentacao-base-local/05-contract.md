# Contrato de Wire — MCP e A2A

**Documento:** 05-contract.md
**Depende de:** [04-specs.md](./04-specs.md)
**Fonte fiel:** `exemplos/wire/*.json` (imutável) — este documento resume e indexa; em caso de divergência, os arquivos de exemplo do starter prevalecem.

## 1. Convenções gerais

### 1.1 `_meta` obrigatório (MCP)
Todo request MCP (agente → servidor) carrega:
```json
{
  "_meta": {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": { "elicitation": { "form": {} } },
    "traceparent": "00-<trace-id>-<span-id>-01"
  }
}
```
Ausência de `protocolVersion` ou `clientCapabilities` → `-32602` / HTTP 400.

### 1.2 Headers HTTP espelhados (MCP)
- `MCP-Protocol-Version`
- `Mcp-Method`
- `Mcp-Name` (somente em `tools/call` e `resources/read`)

Precisam bater com o corpo — mismatch → `-32020`.

### 1.3 Headers HTTP (A2A)
- `traceparent` no `SendMessage` inicial de uma Task → propagado pelo agente para todo request MCP daquela Task (mesmo trace-id).

## 2. Contratos MCP

### 2.1 `tools/list`
Request sem parâmetros (além de `_meta`). Response: array das 3 tools, cada uma com `name`, `description`, `inputSchema` (JSON Schema válido), e `listar_salas` também com `outputSchema`.

### 2.2 `listar_salas`
- `inputSchema`: objeto vazio (`{"type":"object","properties":{}}`).
- Retorno: `structuredContent` conforme `outputSchema` (array de salas com `id`, `nome`, `capacidade`, `recursos`) **e** o mesmo JSON serializado em um bloco `text`.

### 2.3 `consultar_disponibilidade`
- `inputSchema`: `{ sala: string, inicio: string(iso8601), fim: string(iso8601) }`, todos obrigatórios.
- Retorno (`structuredContent`): `{ livre: boolean, conflitos?: Reserva[] }`.
- Aplica as mesmas validações de sala/política que `reservar_sala` — mesmas mensagens de erro (ver [04-specs.md §4.4](./04-specs.md#44-regras-de-validação-e-mensagens-de-erro-fonte-única-de-verdade)).

### 2.4 `reservar_sala` — caminho feliz
- `inputSchema`: `{ sala, inicio, fim, responsavel }` (todos string, obrigatórios).
- Retorno `complete` — `structuredContent`:
```json
{
  "reserva": "res-0003",
  "reservado": true,
  "sala": "sala-fusca",
  "inicio": "2026-11-03T14:00:00-03:00",
  "fim": "2026-11-03T15:00:00-03:00",
  "responsavel": "Marty",
  "politica": "2026-11-01"
}
```

### 2.5 `reservar_sala` — conflito (`input_required`)
Ver `exemplos/wire/03-tools-call-conflito-input-required.json` para a forma completa. Resumo:
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "resultType": "input_required",
    "inputRequests": {
      "<chave gerada pelo servidor>": {
        "method": "elicitation/create",
        "params": {
          "mode": "form",
          "message": "A sala pedida esta ocupada nesse intervalo. Escolha uma alternativa.",
          "requestedSchema": {
            "type": "object",
            "properties": { "sala": { "type": "string", "enum": ["sala-fusca", "sala-mirante"] } },
            "required": ["sala"]
          }
        }
      }
    },
    "requestState": "<opaco, HMAC/AEAD, expira em 5-30min>"
  }
}
```

### 2.6 Retry (`tools/call` com `inputResponses` + `requestState`)
```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "tools/call",
  "params": {
    "name": "reservar_sala",
    "arguments": { "sala": "sala-garagem", "inicio": "2026-11-03T14:00:00-03:00", "fim": "2026-11-03T15:00:00-03:00", "responsavel": "Marty" },
    "inputResponses": {
      "<mesma chave de inputRequests>": { "action": "accept", "content": { "sala": "sala-fusca" } }
    },
    "requestState": "<mesmo valor opaco, ecoado sem modificação>",
    "_meta": { "...": "ver 1.1" }
  }
}
```
- `id` **diferente** do request inicial (obrigatório).
- `action: decline` ou `cancel` → conclui sem reservar (`structuredContent.reservado = false`).

### 2.7 `resources/read`
- `politica://uso` → `{ contents: [{ uri: "politica://uso", mimeType: "text/markdown", text: "<conteúdo de dados/politica-de-uso.md>" }] }`.
- URI inexistente → erro `-32602` (nunca `contents` vazio).

### 2.8 Tabela de erros MCP

| Código | Quando | HTTP |
|---|---|---|
| `-32602` | `_meta` incompleto / tool inexistente (alternativa a `isError`) / `requestState` inválido-expirado / `resources/read` inexistente | 400 no caso de `_meta` incompleto |
| `-32021` | Elicitation exigida sem `elicitation.form` declarada, com `data.requiredCapabilities` | 400 |
| `-32020` | Header HTTP não bate com o corpo (`Mcp-Method`/`Mcp-Name`) | — |

## 3. Contratos A2A

### 3.1 Agent Card (`GET /.well-known/agent-card.json`)
Forma fiel a `exemplos/wire/07-a2a-agent-card.json`. Campos mínimos: identidade, interface JSON-RPC (URL do endpoint `/a2a`), `protocolVersion: "1.0"`, `capabilities`, `skills: [{ id: "reservar-sala", ... }]`.

### 3.2 `SendMessage` — abertura de Task
Request (ver `exemplos/wire/08-a2a-send-message.json`):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "SendMessage",
  "params": { "message": { "parts": [{ "text": "reservar sala=sala-garagem inicio=2026-11-03T14:00:00-03:00 fim=2026-11-03T15:00:00-03:00 responsavel=Marty" }] } }
}
```
Response: Task nova, `id` + `contextId`, estado `TASK_STATE_SUBMITTED` → `TASK_STATE_WORKING`.

### 3.3 `SendMessage` — continuação (pausa)
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "SendMessage",
  "params": { "taskId": "<id da Task pausada>", "message": { "parts": [{ "text": "escolha=sala-mirante" }] } }
}
```

### 3.4 `GetTask`
```json
{ "jsonrpc": "2.0", "id": 3, "method": "GetTask", "params": { "taskId": "<id>" } }
```
Response: `{ id, contextId, state, artifacts?, history? }`.

### 3.5 Artifact `reserva`
```json
{
  "name": "reserva",
  "parts": [
    { "text": "{\"reserva\":\"res-0003\",\"sala\":\"sala-fusca\",\"inicio\":\"2026-11-03T14:00:00-03:00\",\"fim\":\"2026-11-03T15:00:00-03:00\",\"responsavel\":\"Marty\",\"politica\":\"2026-11-01\"}" }
  ]
}
```

### 3.6 Mensagem de pausa (a ponte)
Texto da Task em `TASK_STATE_INPUT_REQUIRED`, **exatamente**:
```
alternativas: sala-fusca, sala-mirante
```
Sem prefixo, sem saudação — comparação byte a byte.

### 3.7 Estados de Task
`TASK_STATE_SUBMITTED → TASK_STATE_WORKING → { TASK_STATE_INPUT_REQUIRED ⇄ (retorna para WORKING internamente ao continuar) } → TASK_STATE_COMPLETED | TASK_STATE_CANCELED | TASK_STATE_FAILED`. Estado terminal é definitivo.

## 4. Índice de `exemplos/wire/`
Arquivo imutável do starter, dez pares request/response. Referências citadas neste projeto:
- `03-tools-call-conflito-input-required.json`
- `07-a2a-agent-card.json`
- `08-a2a-send-message.json`

Leia o diretório completo antes de implementar (ordem de execução sugerida, passo 1 — ver [07-testplan.md](./07-testplan.md)).
