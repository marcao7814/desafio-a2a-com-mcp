# Runbook Operacional

**Documento:** 09-runbook.md
**Depende de:** [06-stack.md](./06-stack.md), [08-readme.md](./08-readme.md)

## 1. Escopo
Procedimentos operacionais para subir, verificar, depurar e reiniciar os dois processos do desafio (`servidor-mcp` e `agente`) em ambiente local de desenvolvimento/avaliação. Não cobre deploy, orquestração ou produção (fora de escopo do desafio).

## 2. Pré-requisitos
- Node.js ≥ 20 instalado (`node -v`).
- Python ≥ 3.10 instalado (`python3 --version`), sem dependência externa para o validador.
- Porta 7300 e 7301 livres localmente.

## 3. Gerar e exportar `REQUEST_STATE_SECRET`
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
export REQUEST_STATE_SECRET=<valor gerado>
```
- Gerar um valor novo por ambiente/máquina. **Nunca commitar o valor real** — o repositório é público.
- Exportar sempre no terminal onde `servidor-mcp` vai subir, antes do `npm start`.

## 4. Subir os processos
| Passo | Comando | Terminal |
|---|---|---|
| 1 | `cd servidor-mcp && npm start` | 1 (MCP, porta 7301) |
| 2 | `cd agente && npm start` | 2 (A2A, porta 7300) |

Manter o stderr do `servidor-mcp` visível — é o principal instrumento de depuração do desafio.

## 5. Verificações rápidas de saúde
```bash
curl http://localhost:7300/.well-known/agent-card.json
curl -X POST http://localhost:7301/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"...":"ver 05-contract.md"}}}'
```
Card deve responder 200; `tools/list` deve listar as 3 tools.

## 6. Rodar o validador
```bash
python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301
```
- Roda com os dois processos recém-iniciados (estado limpo).
- Primeira linha impressa é o trace-id usado no header `traceparent`.
- Saída esperada: 36 PASS, código de saída 0.

## 7. Reiniciar processos
```bash
# Encerrar (Ctrl+C nos terminais 1 e 2, ou:)
lsof -ti:7301 | xargs kill   # servidor-mcp
lsof -ti:7300 | xargs kill   # agente
```
- Reservas em memória são perdidas ao reiniciar o `servidor-mcp` (esperado).
- `requestState` emitido antes do restart continua válido depois (é o comportamento exigido — ver TC-15 em [07-testplan.md](./07-testplan.md)).
- O agente perde o estado das Tasks pausadas se for reiniciado (não há requisito de sobrevivência de Task a restart do agente).

## 8. Depuração por sintoma

| Sintoma | Causa provável | Onde olhar |
|---|---|---|
| Erro "transporte não tem canal de volta" | Tentativa de callback síncrono do servidor para o cliente em vez de `input_required`/MRTR | Implementação de `reservar_sala` no servidor MCP — ver [03-adr.md ADR-0004](./03-adr.md#adr-0004--mrtr-nativo-do-sdk-nunca-callback-síncrono-de-elicitation) |
| `-32021` inesperado | Cliente (agente) não está declarando `elicitation.form` no `_meta` de todo request | `_meta.clientCapabilities` no client MCP do agente |
| `-32020` | Header HTTP (`Mcp-Method`/`Mcp-Name`) não bate com o corpo do request | Camada de transporte HTTP do cliente MCP |
| `-32602` no retry | `requestState` adulterado, expirado, ou ausente no payload | Serialização/echo do `requestState` no agente |
| Task nunca pausa, elicitation "some" | Client MCP configurado com callback automático de elicitation em vez de expor o `input_required` cru ao agente | Configuração do client MCP no agente |
| Retry falha por id repetido | Reaproveitando o `id` do request original em vez de gerar um novo | Geração de id JSON-RPC no retry |
| `tools/list` não aparece no stderr antes do `tools/call` | Agente pulou a descoberta e usa lista fixa hardcoded | Bootstrap do host MCP no agente |
| `traceparent` ausente no stderr do MCP | Agente não está propagando o trace-id recebido do A2A para o `_meta` dos requests MCP | Middleware de propagação de trace no agente |

Instrumento recomendado: MCP Inspector apontando para `http://localhost:7301/mcp`, ao lado do stderr do servidor.

## 9. Rotação do segredo
Se `REQUEST_STATE_SECRET` precisar ser trocado (ex.: suspeita de vazamento):
1. Gerar novo valor (seção 3).
2. Reiniciar `servidor-mcp` com a nova variável exportada.
3. Qualquer `requestState` emitido com o segredo antigo passa a falhar a verificação de integridade (`-32602`) — comportamento esperado, não é um bug.

## 10. Limitações conhecidas de SDK
Se durante a implementação for identificada uma limitação real do SDK MCP/A2A escolhido que impeça algum requisito, documentar aqui e em [08-readme.md](./08-readme.md) com o trecho de evidência — nunca contornar reescrevendo o protocolo (restrição não negociável, ver [04-specs.md §10](./04-specs.md#10-restrições-não-negociáveis)).
