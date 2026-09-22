# Code Review — 00-01-pontea2a.prd.md
> Data: 2026-09-22
> Alvo: `documentacao-base-local/00-01-pontea2a.prd.md`

> **Nota de adaptação:** a skill `code-review` foi escrita para código Java/Spring (entidades JPA, endpoints `@PreAuthorize`, migrations), com regras definidas em um `CLAUDE.md` do projeto "Floqs". Este repositório **não tem `CLAUDE.md`**, e o alvo revisado é um PRD em Markdown de um projeto Node.js/TypeScript (MCP + A2A) — não código-fonte. Os checklists literais (`@Data`/`@ManyToOne(LAZY)`, `findByX().isPresent()`, SEC-01..SEC-08 de IDOR/`@PreAuthorize`, God Class, etc.) não se aplicam. Abaixo, a *intenção* de cada persona foi adaptada ao tipo real de artefato: Dev Sênior avalia qualidade/consistência do documento, Segurança avalia o que o documento especifica sobre segredos e superfícies de exposição, Smells avalia problemas de documentação (duplicação, referências mortas, inconsistência de convenção).

## Dev Sênior

### DS-01 — Cadeia de links internos quebrada por renomeação externa de 6 arquivos
**Criticidade:** 🔴

**Problema:** Fora desta sessão de review, 6 dos 11 arquivos de `documentacao-base-local/` foram renomeados com um prefixo `00-` adicional: `01-pontea2a.prd.md` → `00-01-pontea2a.prd.md`, `03-adr.md` → `00-03-adr.md`, `04-specs.md` → `00-04-specs.md`, `05-contract.md` → `00-05-contract.md`, `06-stack.md` → `00-06-stack.md`, `08-readme.md` → `00-08-readme.md`. Todo link markdown deste PRD que aponta para esses 6 arquivos pelo nome antigo agora resolve para "arquivo não encontrado" (linhas 63, 107, 183, 208, 242-250, 262, 284, 288, 290, 312-319 do PRD).

**Antes:**
```markdown
[03-adr.md](./03-adr.md)
[04-specs.md](./04-specs.md)
```
**Depois (opção A — atualizar os links):**
```markdown
[03-adr.md](./00-03-adr.md)
[04-specs.md](./00-04-specs.md)
```
**Depois (opção B — reverter a renomeação):** restaurar os 6 arquivos para `NN-nome.md`, mantendo a numeração original 01–11 contígua.

Não apliquei a correção automaticamente porque não sei qual das duas opções reflete a intenção de quem renomeou os arquivos.

### DS-02 — Numeração de leitura (macro → micro) quebrada
**Criticidade:** 🟠

**Problema:** A ordem alfabética real em disco hoje é `00-01, 00-03, 00-04, 00-05, 00-06, 00-08, 02, 07, 09, 10, 11`. A sequência lógica desenhada para o conjunto (PRD → Arquitetura → ADR → Specs → Contract → Stack → Test Plan → README → Runbook → Contributing → Changelog) não é mais a ordem física dos arquivos — `02-architecture.md` deveria vir logo após o PRD, mas hoje ordena depois de `00-08-readme.md`.

**Correção:** mesma decisão do DS-01 — normalizar os 11 arquivos para um único esquema de prefixo.

### DS-03 — Metadado de auto-referência desatualizado
**Criticidade:** 🟡

**Problema:** Linha 3 do PRD, `**Documento:** 01-pontea2a.prd.md`, não reflete mais o nome real do arquivo (`00-01-pontea2a.prd.md`).

**Correção:** atualizar o campo após decidir DS-01, ou remover — o nome do arquivo já é visível no explorador/URL, o campo é redundante e ficou obsoleto na primeira renomeação.

### DS-04 — Duplicação de conteúdo normativo entre PRD e documentos especializados
**Criticidade:** 🟡

**Problema:** A tabela de mensagens de erro exatas (seção 10) e os payloads JSON (seções 11 e 13) existem, palavra por palavra, em `04-specs.md` e `05-contract.md`. Uma correção futura nesses fatos (ex.: o enunciado do desafio mudar uma mensagem de erro) precisa ser replicada manualmente em até 3 arquivos.

**Observação:** trade-off já discutido e aceito com o autor (o PRD prioriza ser "quase autossuficiente" para implementação). Sugestão de melhoria, não bloqueador: marcar essas seções com um comentário do tipo `<!-- espelhado de 04-specs.md §4.4, não editar aqui sem editar lá -->` para reduzir o risco de divergência silenciosa.

---

## Segurança

*Os checks SEC-01..SEC-08 do CLAUDE.md (IDOR, `@PreAuthorize`, migrations com `UNIQUE`) pressupõem endpoints REST e entidades JPA, que não existem neste artefato. Abaixo, os pontos de segurança que o próprio conteúdo do PRD deveria cobrir corretamente, dado que ele especifica um mecanismo de integridade criptográfica (`requestState`).*

### Aprovado — nenhum segredo real exposto
🟢 O PRD nunca inclui um valor de `REQUEST_STATE_SECRET` real, apenas o comando para gerar um (seções 7 e 19). Consistente com a exigência do enunciado de não commitar segredo em repositório público.

### Aprovado — opacidade do requestState corretamente especificada
🟢 Seção 14 deixa explícito que o `requestState` nunca é exposto em card, artifact ou mensagem A2A, e que o agente nunca o interpreta — alinhado com a restrição do enunciado original.

### Vulnerabilidade 1 — Aviso de "nunca versionar o segredo" perdido na condensação
**Categoria:** Gestão de segredos (equivalente adaptado a OWASP A05 — Security Misconfiguration)
**Criticidade:** 🟡
**Onde:** Seção 19 ("Como rodar") do PRD, comparado com `00-08-readme.md`, que tem a nota explícita: *"REQUEST_STATE_SECRET precisa estar exportado... Nunca versione o valor usado — apenas o comando para gerá-lo (o repositório é público)."*
**Cenário de ataque:** alguém segue só a seção 19 do PRD — que o próprio documento promete ser "quase autossuficiente" — não vê o aviso, cria um `.env` com o segredo gerado e commita por hábito, já que nada na seção alerta contra isso.
**Impacto:** vazamento do segredo em repositório público, invalidando a garantia de integridade do `requestState` para qualquer entrega feita com aquele segredo.
**Correção:**
```markdown
> `REQUEST_STATE_SECRET` precisa estar exportado no terminal do `servidor-mcp` **antes** de subir o processo. Nunca versione o valor usado — apenas o comando para gerá-lo (o repositório é público).
```
Adicionar esse bloco de aviso logo abaixo do bloco de comandos da seção 19.

---

## Smells

### Smell 1 — Dead Reference (equivalente a Dead Code)
**Tipo:** Documentação obsoleta / referência morta
**Criticidade:** 🔴
**Problema:** 6 links markdown apontando para nomes de arquivo que não existem mais em disco (mesma causa raiz de DS-01, vista pela lente de "código morto").
**Antes:** `[04-specs.md](./04-specs.md)`
**Depois:** `[04-specs.md](./00-04-specs.md)` — ou reverter a renomeação.

### Smell 2 — Inconsistent Naming
**Tipo:** Convenção de nomenclatura
**Criticidade:** 🟠
**Problema:** 6 de 11 arquivos têm prefixo duplo `00-NN-`, os outros 5 mantêm `NN-` simples. Não há mais um padrão único de nomenclatura na pasta.
**Antes:** `00-01-pontea2a.prd.md`, `02-architecture.md`, `00-03-adr.md`, `07-testplan.md`
**Depois:** escolher um padrão único, ex. `01-pontea2a.prd.md`, `02-architecture.md`, `03-adr.md`, `07-testplan.md`.

### Smell 3 — Conteúdo duplicado entre documentos
**Tipo:** Duplicação (equivalente a Código Duplicado)
**Criticidade:** 🟡
**Problema:** mesmo caso de DS-04 — tabelas e payloads JSON replicados byte a byte em 3 arquivos.
**Correção:** ver DS-04.

---

## Resumo Executivo

| Categoria | Total | 🔴 | 🟠 | 🟡 | 🟢 |
|-----------|-------|----|----|----|----|
| Dev Sênior | 4 | 1 | 1 | 2 | 0 |
| Segurança  | 3 | 0 | 0 | 1 | 2 |
| Smells     | 3 | 1 | 1 | 1 | 0 |

### Bloqueadores 🔴
- **DS-01 / Smell 1** — links internos quebrados para 6 arquivos renomeados (mesma causa raiz, duas lentes). Bloqueia porque qualquer pessoa navegando o PRD por esses links (inclusive o próprio autor, mais tarde) cai em "arquivo não encontrado".

### Alta prioridade 🟠
- **DS-02 / Smell 2** — numeração de leitura macro→micro quebrada; convenção de nomenclatura inconsistente entre os 11 arquivos. Corrigir junto com o bloqueador acima, na mesma decisão (opção A ou B do DS-01).

### Média prioridade 🟡
- **DS-03** — metadado de auto-referência desatualizado no cabeçalho do PRD.
- **DS-04 / Smell 3** — duplicação de conteúdo normativo entre PRD, specs e contract (aceito como trade-off, mas vale marcar a origem).
- **Vulnerabilidade 1** — aviso de "não versionar o segredo" ausente na seção 19 do PRD (presente nos documentos-fonte, perdido na condensação).

### Aprovado ✅
- Conteúdo técnico do PRD (portas, mensagens de erro, payloads, variáveis de ambiente) verificado consistente com `00-04-specs.md`, `00-05-contract.md`, `00-06-stack.md` e `00-03-adr.md` — nenhuma divergência factual encontrada, só de caminho de arquivo.
- Nenhum segredo real exposto em nenhuma seção.
- Opacidade do `requestState` especificada corretamente, coerente com a restrição do enunciado original.
