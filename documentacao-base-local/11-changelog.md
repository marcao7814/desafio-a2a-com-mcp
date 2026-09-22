# Changelog

**Documento:** 11-changelog.md
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Não lançado]

### Adicionado
- Documentação inicial de planejamento a partir de `documentacao/solicitacao.md`:
  - `01-pontea2a.prd.md` — PRD do desafio.
  - `02-architecture.md` — arquitetura macro em modelo C4 (Contexto, Container, Componente).
  - `03-adr.md` — registro das decisões de arquitetura (ADR-0001 a ADR-0007).
  - `04-specs.md` — especificação técnica detalhada (servidor MCP, ciclo MRTR, agente host MCP, agente A2A, a ponte).
  - `05-contract.md` — contratos de wire (MCP e A2A), indexando `exemplos/wire/`.
  - `06-stack.md` — stack tecnológica (Node.js 20+ / TypeScript).
  - `07-testplan.md` — plano de testes, mapeando as 36 verificações do validador e a checklist de critérios de aceite.
  - `08-readme.md` — rascunho do README de entrega (a promover para a raiz do repositório após a implementação).
  - `09-runbook.md` — runbook operacional (subida, verificação, depuração por sintoma, rotação de segredo).
  - `10-contributing.md` — guia de contribuição e checklist de push.

### Decidido
- Stack de implementação: Node.js 20+ / TypeScript para `servidor-mcp/` e `agente/` (ver ADR-0001).
- Proteção do `requestState` via HMAC-SHA256 stateless, sem estado em memória do servidor entre `input_required` e o retry (ver ADR-0003).
- MRTR nativo do SDK MCP, sem callback síncrono de elicitation (ver ADR-0004).
