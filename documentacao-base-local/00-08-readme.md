# README (rascunho de entrega)

**Documento:** 00-08-readme.md
**Status:** Rascunho — este conteúdo deve substituir o `README.md` da raiz do fork quando `servidor-mcp/` e `agente/` estiverem implementados. Os trechos marcados `TODO` dependem de código ainda não escrito.

---

# A Ponte: um agente A2A com MCP por dentro

Implementação do desafio [devfullcycle/desafio-a2a-com-mcp](https://github.com/devfullcycle/desafio-a2a-com-mcp): um servidor MCP (Streamable HTTP) que expõe a reserva de salas da Hill Valley Tech, e um agente que consome esse servidor por dentro (host MCP) e se oferece como servidor A2A por fora.

## Como rodar

Pré-requisitos: Node.js ≥ 20, Python ≥ 3.10 (apenas para o validador).

```bash
# 1. Gerar e exportar o segredo de integridade do requestState
export REQUEST_STATE_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# 2. Instalar dependências (a partir da raiz do repositório)
cd servidor-mcp && npm ci && cd ..
cd agente && npm ci && cd ..

# 3. Subir o servidor MCP (terminal 1) — porta 7301
cd servidor-mcp && npm start

# 4. Subir o agente (terminal 2) — porta 7300
cd agente && npm start

# 5. Rodar o validador (terminal 3, a partir da raiz)
python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301
```

> `REQUEST_STATE_SECRET` precisa estar exportado no terminal do `servidor-mcp` **antes** de subir o processo. Nunca versione o valor usado — apenas o comando para gerá-lo (o repositório é público).

## Onde a ponte acontece

TODO — após a implementação, apontar aqui:
- O ponto exato do código do agente em que o `input_required` recebido do servidor MCP é traduzido para `TASK_STATE_INPUT_REQUIRED` (arquivo:linha).
- O ponto exato em que o `requestState` guardado é reenviado ao servidor MCP no retry (arquivo:linha).

Ver o desenho conceitual dessa fronteira em [04-specs.md §8](./00-04-specs.md#8-a-ponte) e nos componentes "Tradutor da Ponte" / "Store de Tasks" de [02-architecture.md §3.2](./02-architecture.md#32-componentes-do-agente).

## Decisões técnicas

- **Proteção do `requestState`**: HMAC-SHA256 via `node:crypto`, chave de `REQUEST_STATE_SECRET` (≥32 bytes) — ver [03-adr.md ADR-0003](./00-03-adr.md#adr-0003--proteção-do-requeststate-com-hmac-sha256-stateless). TODO: confirmar biblioteca final e detalhar o payload assinado.
- **Expiração**: TODO — definir valor exato dentro da janela de 5–30 minutos exigida pelo enunciado.
- **Onde fica o estado das Tasks**: em memória, no processo do agente, indexado por `taskId`.

## Saída do validador

TODO — colar aqui a saída completa da última execução de `python3 validador/validar.py`, incluindo o trace-id impresso na primeira linha e o resultado das 36 verificações, código de saída 0.

```
TODO: colar saída aqui
```
