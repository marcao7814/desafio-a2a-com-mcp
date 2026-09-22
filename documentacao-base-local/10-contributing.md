# Guia de Contribuição

**Documento:** 10-contributing.md

## 1. Contexto
Este repositório é a entrega de um desafio individual (fork de `devfullcycle/desafio-a2a-com-mcp`), avaliado por um validador de conformidade automático. As regras abaixo existem para manter a entrega válida, não para coordenar um time.

## 2. Regras invioláveis
- **Nunca alterar** `dados/`, `validador/` ou `exemplos/`. O avaliador roda o validador original contra o fork; alterar esses caminhos apenas invalida a entrega.
- Toda a entrega vive na branch `main`.
- A estrutura de pastas do starter (`servidor-mcp/`, `agente/`, `dados/`, `validador/`, `exemplos/`) precisa ser mantida — não mover dados, não reescrever o validador, não colapsar os dois processos em um.
- Sem dependência de SDK de LLM em `package.json`/`pyproject.toml`.
- Sem segredo hardcoded em nenhum commit — `REQUEST_STATE_SECRET` só existe como variável de ambiente.

## 3. Fluxo de trabalho recomendado
Siga a "Ordem de execução sugerida" do enunciado (resumida):
1. Ler `exemplos/wire/` inteiro antes de escrever código.
2. Subir o servidor MCP com `listar_salas` apenas, validar com MCP Inspector.
3. Implementar `consultar_disponibilidade` + regras de política.
4. Implementar `reservar_sala` no caminho feliz (sem MRTR).
5. Adicionar o MRTR completo (`input_required` → `requestState` protegido → checagem de capability).
6. Construir o agente como client MCP puro (sem A2A ainda), respondendo elicitation manualmente.
7. Adicionar a camada A2A (card, `SendMessage`, `GetTask`, máquina de estados).
8. Costurar a ponte (pausa, guarda do `requestState`, retomada com id novo).
9. Rodar o validador, corrigir, repetir.
10. Do zero: matar os processos, clonar o próprio fork em pasta limpa, seguir só o README, percorrer a checklist de critérios item por item.

## 4. Antes de cada commit
- Rodar `python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301` com os processos recém-iniciados.
- Conferir que nenhuma mensagem de erro de negócio foi alterada (texto exato — ver [05-contract.md §2.8](./05-contract.md#28-tabela-de-erros-mcp) e [04-specs.md §4.4](./04-specs.md#44-regras-de-validação-e-mensagens-de-erro-fonte-única-de-verdade)).
- Conferir que `git status` não lista arquivos em `dados/`, `validador/` ou `exemplos/`.
- Nunca commitar o valor real de `REQUEST_STATE_SECRET`.

## 5. Estilo de código (TypeScript)
- ESM em todo o código (`"type": "module"`).
- TypeScript estrito (`strict: true` no `tsconfig.json`).
- Sem comentários explicando o óbvio; comentar apenas decisões não óbvias (ex.: por que um valor de expiração específico foi escolhido).
- Sem abstrações antecipadas — o domínio é deliberadamente simples (5 salas, 3 regras); não introduzir ORM, camada de serviços ou banco de dados.
- Decisões arquiteturais relevantes (novas ou revisadas) devem virar um novo ADR em [03-adr.md](./03-adr.md), não apenas um comentário no código.

## 6. Antes do push final
Checklist mínimo (ver detalhamento completo em [07-testplan.md](./07-testplan.md)):
- [ ] 36/36 no validador, saída 0.
- [ ] README com as 4 seções obrigatórias, comandos verificados a partir de clone limpo.
- [ ] `dados/`, `validador/`, `exemplos/` idênticos ao starter original.
- [ ] Nenhum segredo real commitado.
- [ ] Agente determinístico (mesmo pedido → mesmo resultado, testado 2x).
