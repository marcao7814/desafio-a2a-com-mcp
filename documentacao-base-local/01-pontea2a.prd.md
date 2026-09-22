# PRD — A Ponte: um agente A2A com MCP por dentro

**Documento:** 01-pontea2a.prd.md
**Fonte:** [solicitacao.md](./solicitacao.md)
**Status:** Aprovado para implementação
**Stack definida:** Node.js 20+ / TypeScript (ver [04-stack.md](./04-stack.md))

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

## 6. Fluxo de valor (jornada ponta a ponta)

1. Cliente A2A busca o Agent Card, descobre a skill `reservar-sala`, envia `SendMessage` com o pedido em texto.
2. Agente abre uma Task, chama `reservar_sala` no servidor MCP.
   - **Caminho livre**: Task conclui em `TASK_STATE_COMPLETED` com artifact `reserva`.
   - **Caminho de conflito**: servidor devolve `input_required` com elicitation de alternativas + `requestState` opaco. Agente pausa a Task em `TASK_STATE_INPUT_REQUIRED`, expõe a linha `alternativas: <ids>`.
3. Cliente responde com novo `SendMessage` na mesma Task (`escolha=<id>` ou `escolha=recusar`).
4. Agente repete o `tools/call` original (id JSON-RPC novo) com `inputResponses` + `requestState` ecoado.
5. Servidor conclui a reserva ou cancela; Task termina em `TASK_STATE_COMPLETED` ou `TASK_STATE_CANCELED`.

Ver diagrama de estados detalhado em [04-specs.md](./04-specs.md#8-a-ponte) e a visão macro de containers/componentes em [02-architecture.md](./02-architecture.md).

## 7. Requisitos funcionais (macro — detalhamento em specs.md)

- **RF1** — Servidor MCP com 3 tools (`listar_salas`, `consultar_disponibilidade`, `reservar_sala`) e 1 resource (`politica://uso`).
- **RF2** — Ciclo MRTR completo na tool de reserva, com `requestState` protegido por integridade.
- **RF3** — Agente como host MCP: descoberta em runtime, propagação de `_meta` e headers, propagação de `traceparent`.
- **RF4** — Agente como servidor A2A: Agent Card v1.0, `SendMessage`, `GetTask`, máquina de estados de Task.
- **RF5** — A ponte: mapeamento bidirecional entre `input_required`/`requestState` (MCP) e `TASK_STATE_INPUT_REQUIRED`/Task (A2A).

## 8. Requisitos não funcionais

- Determinismo: mesmo pedido → mesmo resultado, sempre.
- Sem estado de sessão inferido de request anterior ou de conexão aberta.
- `requestState` tratado como entrada não confiável (assinatura obrigatória, verificação de integridade, expiração de 5–30 min).
- Logging mínimo em stderr (método, id, `traceparent`) — sem OpenTelemetry.

## 9. As três fricções propositais (riscos de execução conhecidos)

1. **Sem canal de volta no transporte stateless** — tentar callback síncrono do servidor para o cliente falha com um erro explícito. Solução: usar o mecanismo de MRTR/`input_required` nativo do SDK, não um callback de elicitation síncrono.
2. **Elicitation exige capability declarada** — cliente sem `io.modelcontextprotocol/clientCapabilities.elicitation.form` recebe `-32021`.
3. **`requestState` é entrada controlada por atacante** — precisa de HMAC/AEAD real, não apenas um JSON em base64 sem assinatura.

## 10. Critérios de sucesso

- `python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301` passa nas 36 verificações com saída 0, a partir de um clone limpo.
- Todos os itens da checklist de Critérios de Aceite (ver [05-testplan.md](./05-testplan.md)) marcados.
- README com as 4 seções obrigatórias e comandos verificados.

## 11. Fora de escopo

Autenticação/autorização, streaming (`SendStreamingMessage`/SSE/push notification), refinamento de Task e `referenceTaskIds`, card estendido autenticado e assinatura JWS, prompts/subscriptions/progress do MCP, container/compose/deploy/gateway, spans e atributos de OpenTelemetry, concorrência de escrita e corrida entre reservas no mesmo milissegundo, persistência em disco das reservas, interface gráfica de qualquer tipo.

## 12. Entregáveis

- Repositório público no GitHub, fork de `devfullcycle/desafio-a2a-com-mcp`, entrega na branch `main`.
- `servidor-mcp/` e `agente/` preenchidos; `dados/`, `validador/`, `exemplos/` intocados.
- `README.md` na raiz substituído pela documentação da entrega (com as comandos de subida, onde a ponte acontece, decisões técnicas e saída do validador).

## 13. Documentos relacionados

- [02-architecture.md](./02-architecture.md) — arquitetura macro (modelo C4)
- [03-adr.md](./03-adr.md) — registro das decisões de arquitetura
- [04-specs.md](./04-specs.md) — especificação técnica detalhada
- [05-contract.md](./05-contract.md) — contratos de wire (MCP e A2A)
- [06-stack.md](./06-stack.md) — stack tecnológica
- [07-testplan.md](./07-testplan.md) — plano de testes
- [08-readme.md](./08-readme.md) — rascunho do README de entrega
- [09-runbook.md](./09-runbook.md) — runbook operacional
- [10-contributing.md](./10-contributing.md) — guia de contribuição
- [11-changelog.md](./11-changelog.md) — changelog
