# Especificação Técnica — A Ponte (MCP + A2A)

**Documento:** 00-04-specs.md
**Depende de:** [02-architecture.md](./02-architecture.md), [03-adr.md](./00-03-adr.md)
**Fonte normativa:** [solicitacao.md](./solicitacao.md) — em caso de conflito, o enunciado original prevalece.

## 1. Visão geral da arquitetura

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

Dois processos independentes, comunicando-se por HTTP real (nenhuma chamada de função direta entre eles). Ver o modelo C4 completo em [02-architecture.md](./02-architecture.md).

## 2. Processos e portas

| Processo | Porta padrão | Endpoint | Protocolo |
|---|---|---|---|
| Agente | 7300 | `/a2a` (JSON-RPC), `/.well-known/agent-card.json` | A2A v1.0 sobre JSON-RPC 2.0/HTTP |
| Servidor MCP | 7301 | `/mcp` | MCP v2, Streamable HTTP, spec 2026-07-28 |

Portas parametrizáveis por variável de ambiente, com esses valores como default.

## 3. Modelo de dados (somente leitura do starter)

- `dados/salas.json` — 5 salas fixas (`id`, `nome`, `capacidade`, `recursos`).
- `dados/reservas.json` — reservas seed (`id`, `sala`, `inicio`, `fim`, `responsavel`).
- `dados/politica-de-uso.md` — primeira linha `versao: <data>`; regras: janela 08:00–20:00 (-03:00), duração máxima 2h, sem sobreposição por sala.

Esses arquivos não podem ser alterados. O servidor MCP os lê no boot e/ou por request; a persistência de reservas criadas em runtime é em memória do processo do servidor MCP (ver [03-adr.md ADR-0005](./00-03-adr.md#adr-0005--persistência-em-memória-sem-banco-de-dados)).

## 4. Servidor MCP

### 4.1 Transporte e negociação
- Streamable HTTP, endpoint único `/mcp`, porta 7301.
- Toda request precisa trazer, em `_meta`: `io.modelcontextprotocol/protocolVersion` e `io.modelcontextprotocol/clientCapabilities`. Ausência de qualquer um → `-32602` + HTTP 400. Não inferir de request anterior.
- Capabilities declaradas: `tools`, `resources`.

### 4.2 Tools

| Tool | Parâmetros | Retorno |
|---|---|---|
| `listar_salas` | nenhum | `structuredContent` conforme `outputSchema` + bloco de texto com o mesmo JSON serializado |
| `consultar_disponibilidade` | `sala`, `inicio`, `fim` | livre/ocupado + reservas em conflito; mesmas validações de `reservar_sala` |
| `reservar_sala` | `sala`, `inicio`, `fim`, `responsavel` | reserva criada (caminho livre) ou `input_required` (conflito) |

Todas com `inputSchema` JSON Schema válido. `reservar_sala` concluída retorna em `structuredContent`: `reserva`, `reservado`, `sala`, `inicio`, `fim`, `responsavel`, `politica` (ver [05-contract.md](./00-05-contract.md)).

### 4.3 Resource
- URI `politica://uso`, `mimeType: text/markdown`, conteúdo = `dados/politica-de-uso.md` literal.
- `resources/read` de URI inexistente → `-32602` (nunca `contents` vazio).

### 4.4 Regras de validação e mensagens de erro (fonte única de verdade)

**Erros de execução (`isError: true`, dentro de resultado `complete`)**

| Condição | Mensagem exata |
|---|---|
| Sala não existe | `Sala inexistente: <id informado>` |
| Início ou fim fora de 08:00–20:00 (-03:00) | `Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00` |
| Duração > 2h | `Duracao acima do limite: a politica permite no maximo 2 horas` |
| `fim <= inicio` | `Intervalo invalido: fim deve ser posterior a inicio` |
| Conflito sem alternativa válida | `Sem alternativas disponiveis no intervalo` |

Prefixos de SDK (ex.: `Error executing tool <nome>:`) são aceitos; o texto exato da mensagem não pode variar.

**Erros de protocolo (JSON-RPC `error`)**

| Condição | Código | HTTP |
|---|---|---|
| Tool inexistente | `-32602` (ou `isError: true`, ambos aceitos) | — |
| `_meta` sem `protocolVersion` ou `clientCapabilities` | `-32602` | 400 |
| Elicitation exigida sem capability `elicitation.form` declarada | `-32021`, com `data.requiredCapabilities` | 400 |
| `requestState` inválido/expirado | `-32602` | — |
| `resources/read` de URI inexistente | `-32602` | — |
| Header mismatch (`Mcp-Method`/`Mcp-Name` ≠ corpo) | `-32020` | — |

**Não é erro**: recusa (`decline`/`cancel`) na elicitation → resultado `complete`, `isError` ausente/`false`, `structuredContent.reservado = false` + motivo.

### 4.5 Logging
Cada request registrado em stderr com, no mínimo: método, id, `traceparent` (quando presente em `_meta`). Nunca usar API de logging depreciada do SDK.

## 5. O ciclo de MRTR na reserva

1. Conflito detectado → `reservar_sala` responde `resultType: "input_required"`.
2. `inputRequests`: mapa de uma entrada só, chave gerada pelo servidor, valor = request `elicitation/create` em `mode: "form"`.
3. `requestedSchema`: objeto plano, propriedade `sala` (string), `enum` com as alternativas (ou `const` se houver só uma).
4. Sem alternativa → sem elicitation; `isError: true` com `Sem alternativas disponiveis no intervalo`.
5. `requestState`: protegido por HMAC ou AEAD (assinatura obrigatória, cifra opcional), expiração entre 5 e 30 minutos, contém tudo que o servidor precisa para reconstruir o pedido — **nenhum estado em memória do servidor entre `input_required` e o retry**. Precisa funcionar após restart do processo (ver [03-adr.md ADR-0003](./00-03-adr.md#adr-0003--proteção-do-requeststate-com-hmac-sha256-stateless)).
6. Chave de integridade: variável de ambiente `REQUEST_STATE_SECRET`, ≥32 bytes de aleatoriedade, nunca hardcoded.
7. `requestState` adulterado ou expirado → `-32602`.
8. No retry, argumentos reenviados pelo cliente não são confiáveis: divergência do que foi selado não pode ter efeito (rejeitar ou usar valores selados — ambos aceitos).
9. Cliente sem capability de elicitation form → `-32021` (nunca tenta enviar elicitation mesmo assim).
10. Retry: servidor lê `inputResponses` + `requestState` de dentro de `params`, reconstrói do próprio `requestState`, conclui.
11. `action: decline` ou `cancel` → conclui sem reservar (não é erro).

## 6. Agente como host MCP

- Descobre tools via `tools/list` **antes** da primeira chamada — nunca lista fixa hardcoded.
- Lê o resource `politica://uso` e extrai a versão da primeira linha (`versao: <data>`).
- Todo request MCP carrega `_meta` obrigatório e declara `{"elicitation": {"form": {}}}`.
- Headers espelhados do corpo: `MCP-Protocol-Version`, `Mcp-Method`, e em `tools/call`/`resources/read`, `Mcp-Name`. Mismatch → `-32020`.
- Propaga o `traceparent` recebido do cliente A2A (mesmo trace-id; span-id pode ser novo) em todos os requests MCP daquela Task.
- Erro de execução da tool (`isError: true`) → Task `TASK_STATE_FAILED`, com a mensagem exata da tool visível no histórico.

## 7. Agente como servidor A2A

- `GET /.well-known/agent-card.json` → card v1.0 (interface JSON-RPC, URL do endpoint, versão de protocolo `1.0`, capabilities, skill `id: reservar-sala`). Forma fiel a `exemplos/wire/07-a2a-agent-card.json`.
- `/a2a` aceita `SendMessage` e `GetTask` (binding JSON-RPC).
- `SendMessage` sem `taskId` → nova Task (`id`, `contextId` próprios).
- Máquina de estados: `SUBMITTED` → `WORKING` → estado terminal (`COMPLETED`/`CANCELED`/`FAILED`). `GetTask` reflete o estado corrente a qualquer momento.
- Sucesso → artifact `name: "reserva"`, conteúdo = JSON da reserva, incluindo `politica` (versão lida do resource).
- Estado terminal é definitivo — `SendMessage` para Task terminal é recusado com erro.

## 8. A ponte

Esta é a seção mais crítica — ver também [05-contract.md](./00-05-contract.md) para os payloads exatos.

- `input_required` (MCP) → `TASK_STATE_INPUT_REQUIRED` (A2A). Mensagem de texto da Task = **exatamente** `alternativas: <ids separados por virgula e espaco>`, na ordem do `enum`. Sem prefixo, sem saudação (comparação byte a byte pelo avaliador).
- `requestState` fica guardado no agente, associado à Task — nunca exposto em card, artifact ou mensagem A2A. **Opaco**: o agente nunca abre, interpreta ou reconstrói o conteúdo.
- Continuação: `SendMessage` com `taskId` + texto `escolha=<valor>`.
  - Fora do enum → mantém `TASK_STATE_INPUT_REQUIRED`, repete a lista de alternativas.
  - `escolha=recusar` → `action: decline` na elicitation → Task `TASK_STATE_CANCELED`.
  - `escolha=<id válido>` → `action: accept`, `content: {"sala": "<id>"}`.
- Retry ao MCP: **novo id de JSON-RPC**, `inputResponses` com a mesma chave recebida, `requestState` ecoado sem modificação.
- Estado pausado é por Task: duas Tasks pausadas simultaneamente não trocam `requestState` entre si.

## 9. Requisitos não funcionais

- **Determinismo**: mesmo pedido, mesmo resultado, sempre. Nenhuma dependência de SDK de LLM no `package.json`.
- **Sem sessão**: nenhum lado infere versão/capabilities/contexto de request anterior ou conexão aberta (manter um client MCP vivo entre chamadas é normal; o que é proibido é inferir estado de protocolo).
- **Sem persistência em disco** de reservas; `requestState` é a exceção (precisa sobreviver a restart do servidor MCP).
- **Sem autenticação/autorização** em nenhuma camada.

## 10. Restrições não negociáveis

1. Dois processos separados, comunicação HTTP real (nunca import direto da tool no código do agente).
2. Agente não implementa regra de negócio de sala (conflito/política/alternativas são decisão exclusiva do servidor MCP).
3. Nada de sessão — ver seção 9.
4. `requestState` opaco para o agente.
5. Sem LLM no caminho de execução.
6. Limitação real de SDK → documentar no README com evidência, nunca contornar reescrevendo o protocolo.

## 11. Fora de escopo
Ver [01-pontea2a.prd.md §22](./00-01-pontea2a.prd.md#22-fora-de-escopo).
