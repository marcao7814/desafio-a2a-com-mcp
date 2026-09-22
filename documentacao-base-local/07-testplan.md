# Plano de Testes

**Documento:** 07-testplan.md
**Depende de:** [04-specs.md](./04-specs.md), [05-contract.md](./05-contract.md)

## 1. Objetivo
Garantir que os dois processos passem nas 36 verificações de `validador/validar.py` e em toda a checklist de Critérios de Aceite do enunciado, a partir de um clone limpo do fork.

## 2. Estratégia
1. **Validador oficial** (fonte de verdade, não pode ser alterado) — automatiza 20 checagens MCP + 16 checagens A2A.
2. **Testes manuais complementares** — reproduzem o "Fluxo do avaliador" do enunciado, via `curl` e inspeção de stderr.
3. **Testes unitários opcionais** — lógica de política (janela de uso, duração, sobreposição, alternativas) isolada, antes de subir os processos.

## 3. Ambiente
- Clone limpo do fork, dois terminais (`servidor-mcp` na 7301, `agente` na 7300), stderr do servidor MCP visível.
- `REQUEST_STATE_SECRET` exportado antes de subir o servidor MCP.
- Python 3.10+ disponível para o validador.

## 4. Matriz de casos — Servidor MCP

| ID | Caso | Critério de aceite correspondente |
|---|---|---|
| TC-01 | `tools/list` na porta 7301 lista as 3 tools | Sobe na porta 7301 em Streamable HTTP e responde a tools/list com as três tools |
| TC-02 | Toda tool tem `inputSchema` JSON Schema válido | Toda tool tem inputSchema que é um objeto JSON Schema válido |
| TC-03 | `listar_salas` retorna `structuredContent` + bloco texto | listar_salas devolve structuredContent conforme o outputSchema declarado e o mesmo JSON serializado em bloco de texto |
| TC-04 | Request sem `_meta` completo → `-32602` + HTTP 400 | Request sem io.modelcontextprotocol/protocolVersion ou sem clientCapabilities recebe -32602 com HTTP 400 |
| TC-05 | `tools/call` de tool inexistente → `-32602` ou `isError` | tools/call de tool inexistente é recusado, por -32602 ou por isError |
| TC-06 | `resources/read politica://uso` retorna conteúdo correto; URI inexistente → `-32602` | resources/read de politica://uso devolve o conteúdo, e de URI inexistente devolve -32602 |
| TC-07 | Sala inexistente, janela violada, duração acima, intervalo invertido → mensagens exatas | Sala inexistente, janela violada, duração acima do limite e intervalo invertido devolvem isError: true com as mensagens exatas |
| TC-08 | stderr registra método, id, traceparent | O stderr do processo registra método, id e traceparent de cada request |

## 5. Matriz de casos — MRTR

| ID | Caso | Critério de aceite |
|---|---|---|
| TC-09 | Conflito → `input_required`, 1 entrada em `inputRequests`, form mode, `requestState` presente | Reserva em intervalo ocupado devolve resultType igual a input_required |
| TC-10 | `requestedSchema` restringe às alternativas na ordem definida | O requestedSchema é plano e restringe a escolha às alternativas calculadas pela regra do enunciado |
| TC-11 | Cliente sem capability elicitation form → `-32021` + `data.requiredCapabilities` + HTTP 400 | O mesmo pedido, vindo de cliente que não declarou elicitation em form mode, recebe -32021 |
| TC-12 | Retry com `inputResponses`+`requestState` conclui, `resultType: complete` | O retry com inputResponses e requestState conclui a reserva e devolve resultType igual a complete |
| TC-13 | `requestState` adulterado → `-32602` | requestState adulterado recebe -32602 |
| TC-14 | Retry com argumentos adulterados não usa os valores adulterados | Um retry com argumentos adulterados não produz reserva com os valores adulterados |
| TC-15 | Retry válido conclui mesmo após restart do servidor MCP | Um retry com requestState válido conclui a reserva mesmo que o processo tenha sido reiniciado |
| TC-16 | Segredo vem de `REQUEST_STATE_SECRET`, ≥32 bytes, nada hardcoded | A chave de integridade vem de REQUEST_STATE_SECRET, com no mínimo 32 bytes |
| TC-17 | `action: decline` conclui sem reservar, sem `isError` | Recusa com action igual a decline conclui sem reservar e sem isError |

## 6. Matriz de casos — Agente como host MCP

| ID | Caso | Critério de aceite |
|---|---|---|
| TC-18 | stderr mostra `tools/list` antes do primeiro `tools/call` | O log do servidor MCP mostra um tools/list antes do primeiro tools/call do agente |
| TC-19 | `traceparent` no stderr com mesmo trace-id do validador | O log do servidor MCP mostra o traceparent com o mesmo trace-id enviado pelo validador |
| TC-20 | Requests do agente declaram capability elicitation form | Os requests do agente declaram a capability de elicitation em form mode |

## 7. Matriz de casos — Agente como servidor A2A

| ID | Caso | Critério de aceite |
|---|---|---|
| TC-21 | Agent Card responde 200, v1.0 válido | GET /.well-known/agent-card.json responde 200 com um card v1.0 válido |
| TC-22 | Card declara interface JSON-RPC, versão 1.0, skill `reservar-sala` | O card declara a interface JSON-RPC com a URL do endpoint e a versão de protocolo 1.0, e uma skill de id reservar-sala |
| TC-23 | Sala livre → Task `COMPLETED` + artifact `reserva` | SendMessage com sala livre termina a Task em TASK_STATE_COMPLETED com o artifact reserva |
| TC-24 | Artifact traz reserva + `politica` do resource | O artifact traz a reserva criada e o campo politica com o valor lido do resource |
| TC-25 | `GetTask` reflete id, contextId, estado, artifact | GetTask devolve id, contextId, estado corrente e o artifact quando existir |
| TC-26 | `SendMessage` em Task terminal é recusado | SendMessage referenciando Task em estado terminal é recusado com erro |
| TC-27 | Sala inexistente → Task `FAILED` com mensagem exata no histórico | SendMessage pedindo uma sala inexistente termina a Task em TASK_STATE_FAILED |

## 8. Matriz de casos — A ponte

| ID | Caso | Critério de aceite |
|---|---|---|
| TC-28 | Sala ocupada → Task `INPUT_REQUIRED` com linha `alternativas: ` correta | SendMessage pedindo sala ocupada deixa a Task em TASK_STATE_INPUT_REQUIRED |
| TC-29 | `escolha=<id>` conclui `COMPLETED` na sala escolhida | A continuação com escolha=<id> conclui a Task em TASK_STATE_COMPLETED com a reserva na sala escolhida |
| TC-30 | `escolha=recusar` → `CANCELED` | A continuação com escolha=recusar termina a Task em TASK_STATE_CANCELED |
| TC-31 | Escolha fora do enum mantém `INPUT_REQUIRED` | Escolha fora do enum mantém a Task em TASK_STATE_INPUT_REQUIRED |
| TC-32 | Duas Tasks pausadas simultâneas concluem sem trocar `requestState` | Duas Tasks pausadas ao mesmo tempo concluem cada uma com a sua reserva, sem trocar de requestState |
| TC-33 | `requestState` nunca aparece em resposta A2A | O requestState não aparece em nenhuma resposta A2A |

## 9. Matriz de casos — Validação e entrega

| ID | Caso | Critério de aceite |
|---|---|---|
| TC-34 | Validador passa 36/36, saída 0, processos recém-iniciados | python3 validador/validar.py passa nas 36 verificações, com os dois processos recém-iniciados, e termina com código de saída 0 |
| TC-35 | `dados/`, `validador/`, `exemplos/` intocados | dados/, validador/ e exemplos/ não foram alterados |
| TC-36 | Determinismo: mesmo pedido 2x → mesmo resultado; sem SDK de LLM no manifest | O agente é determinístico e não há dependência de SDK de provedor de LLM |
| TC-37 | README com as 4 seções, comandos funcionam em clone limpo | O README tem as quatro seções exigidas, e os comandos funcionam a partir de um clone limpo |

## 10. Roteiro manual (espelha o "Fluxo do avaliador")
1. Clonar em pasta limpa, seguir só o README.
2. Subir os dois processos, stderr do MCP visível.
3. `curl` no Agent Card, conferir contra `exemplos/wire/07-a2a-agent-card.json`.
4. Rodar o validador completo.
5. Localizar no stderr o `tools/list` antes do primeiro `tools/call` e o `traceparent`.
6. Localizar o par de `tools/call` de uma reserva pausada — confirmar id do retry ≠ id inicial.
7. `SendMessage` manual para `sala-garagem` 14h–15h 03/11/2026 (corpo de `exemplos/wire/08-a2a-send-message.json`) → conferir `INPUT_REQUIRED` e `alternativas: sala-fusca, sala-mirante`.
8. Continuar com `escolha=sala-mirante` → `GetTask` deve mostrar `COMPLETED` + artifact apontando `sala-mirante` + `politica`.
9. Repetir passo 7 e responder `escolha=recusar` → `CANCELED`.
10. `SendMessage` para `sala-inexistente` → `FAILED` com `Sala inexistente: sala-inexistente` no histórico.
11. Pegar `requestState` real (corpo de `exemplos/wire/03-tools-call-conflito-input-required.json`), trocar um caractere, reenviar → `-32602`.
12. Repetir sem alterar o `requestState`, mas reiniciar o servidor MCP antes do retry → reserva concluída mesmo assim.
13. Repetir o `tools/call` de conflito sem declarar elicitation nas capabilities → `-32021` + HTTP 400.

## 11. Critérios de saída
- 36/36 PASS no validador, código de saída 0.
- Toda a checklist das seções 4–9 marcada.
- Nenhum item da lista "Fora de escopo" testado ou implementado.

## 12. Fora do escopo de testes
Performance, carga, concorrência de escrita real, segurança de autenticação (não existe), testes de UI (não existe).
