# Arquitetura — Modelo C4

**Documento:** 02-architecture.md
**Depende de:** [01-pontea2a.prd.md](./01-pontea2a.prd.md)
**Detalhamento técnico:** [04-specs.md](./04-specs.md), [05-contract.md](./05-contract.md)

Este documento cobre os três primeiros níveis do modelo C4 (Contexto, Container, Componente). O nível 4 (Código) não se aplica — o domínio é deliberadamente pequeno (5 salas, 3 regras) e o código-fonte é a própria documentação de nível 4.

## 1. Nível 1 — Contexto (System Context)

```mermaid
C4Context
    title Contexto — A Ponte (agente A2A com MCP por dentro)

    Person(clienteA2A, "Cliente A2A", "Outro agente da empresa que quer reservar uma sala")
    Person(avaliador, "Avaliador", "Roda o validador de conformidade contra o fork")

    System_Boundary(ponte, "A Ponte") {
        System(agente, "Agente", "Host MCP por dentro, servidor A2A por fora")
        System(mcp, "Servidor MCP", "Expõe as tools e o resource de salas")
    }

    System_Ext(dados, "dados/*.json e politica-de-uso.md", "Arquivos estáticos do domínio, somente leitura")
    System_Ext(validador, "validador/validar.py", "Cliente de conformidade, 36 verificações")

    Rel(clienteA2A, agente, "SendMessage / GetTask", "JSON-RPC 2.0 / HTTP (A2A v1.0)")
    Rel(avaliador, validador, "executa")
    Rel(validador, agente, "verifica", "HTTP :7300")
    Rel(validador, mcp, "verifica", "HTTP :7301")
    Rel(agente, mcp, "tools/list, resources/read, tools/call", "Streamable HTTP (MCP v2)")
    Rel(mcp, dados, "lê no boot / por request")
```

**Leitura**: de fora, "A Ponte" é opaca — um cliente A2A não sabe (nem precisa saber) que por trás da skill `reservar-sala` existe um agente que por sua vez fala com um servidor MCP. Essa opacidade é requisito de produto (ver [01-pontea2a.prd.md §20](./01-pontea2a.prd.md#20-as-três-fricções-propositais-riscos-de-execução-conhecidos)).

## 2. Nível 2 — Container

```mermaid
C4Container
    title Container — A Ponte

    Person(clienteA2A, "Cliente A2A")

    System_Boundary(ponte, "A Ponte") {
        Container(agente, "Agente", "Node.js 20 / TypeScript", "Servidor A2A (porta 7300) + host MCP. Sem LLM, decisão por regra fixa.")
        Container(mcpServer, "Servidor MCP", "Node.js 20 / TypeScript", "Streamable HTTP (porta 7301). 3 tools + 1 resource + ciclo MRTR.")
        ContainerDb(memReservas, "Reservas em memória", "Estrutura em memória do processo servidor-mcp", "Perdida a cada restart")
        ContainerDb(memTasks, "Tasks em memória", "Estrutura em memória do processo agente", "Perdida a cada restart do agente")
    }

    System_Ext(dadosJson, "dados/salas.json, dados/reservas.json, dados/politica-de-uso.md", "Arquivos estáticos, não alteráveis")
    System_Ext(validador, "validador/validar.py", "Python 3.10+, sem dependência externa")

    Rel(clienteA2A, agente, "JSON-RPC 2.0 / HTTP", "/a2a, /.well-known/agent-card.json")
    Rel(agente, mcpServer, "MCP v2 / Streamable HTTP", "/mcp")
    Rel(agente, memTasks, "lê/escreve estado da Task e requestState guardado")
    Rel(mcpServer, memReservas, "lê/escreve reservas criadas em runtime")
    Rel(mcpServer, dadosJson, "lê salas, reservas seed e política")
    Rel(validador, agente, "verifica 16 checagens A2A")
    Rel(validador, mcpServer, "verifica 20 checagens MCP")
```

**Observações de fronteira:**
- `agente` e `mcpServer` são processos independentes; a única via de comunicação entre eles é HTTP real (Streamable HTTP), nunca chamada de função direta.
- O `requestState` emitido pelo `mcpServer` precisa sobreviver a um restart do próprio `mcpServer` — por isso ele **não** é guardado em `memReservas`, e sim serializado, assinado e devolvido ao cliente (o agente), que o guarda associado à Task em `memTasks` sem nunca abri-lo.

## 3. Nível 3 — Componente

### 3.1 Componentes do `servidor-mcp`

```mermaid
C4Component
    title Componentes — servidor-mcp

    Container_Boundary(mcpServer, "Servidor MCP") {
        Component(transport, "Streamable HTTP Transport", "SDK MCP", "Endpoint único /mcp, valida _meta obrigatório")
        Component(toolsRegistry, "Registro de Tools", "SDK MCP", "listar_salas, consultar_disponibilidade, reservar_sala")
        Component(resourceHandler, "Resource Handler", "SDK MCP", "politica://uso -> texto/markdown")
        Component(policyEngine, "Motor de Política", "TypeScript puro", "Janela de uso, duração máxima, sobreposição, cálculo de alternativas")
        Component(mrtrEngine, "Motor de MRTR", "SDK MCP (input_required)", "Gera inputRequests, resolve retry")
        Component(stateSigner, "RequestState Signer/Verifier", "node:crypto HMAC-SHA256", "Assina, verifica integridade e expiração (5-30min)")
        Component(reservationStore, "Store de Reservas", "Map em memória", "CRUD simples, por processo")
        Component(logger, "Logger stderr", "console.error/pino", "Método, id, traceparent por request")
    }

    Rel(transport, toolsRegistry, "roteia tools/call")
    Rel(transport, resourceHandler, "roteia resources/read")
    Rel(toolsRegistry, policyEngine, "valida sala/janela/duração/sobreposição")
    Rel(toolsRegistry, mrtrEngine, "delega quando há conflito")
    Rel(mrtrEngine, stateSigner, "assina/verifica requestState")
    Rel(mrtrEngine, policyEngine, "recalcula alternativas")
    Rel(toolsRegistry, reservationStore, "lê/grava reserva concluída")
    Rel(transport, logger, "loga cada request")
```

### 3.2 Componentes do `agente`

```mermaid
C4Component
    title Componentes — agente

    Container_Boundary(agenteApp, "Agente") {
        Component(a2aTransport, "A2A JSON-RPC Handler", "Fastify/http", "/a2a, /.well-known/agent-card.json")
        Component(taskStateMachine, "Máquina de Estados de Task", "TypeScript puro", "SUBMITTED -> WORKING -> {INPUT_REQUIRED} -> terminal")
        Component(mcpHostClient, "MCP Host Client", "SDK MCP (client)", "tools/list, resources/read, tools/call contra servidor-mcp")
        Component(bridge, "Tradutor da Ponte", "TypeScript puro", "input_required <-> TASK_STATE_INPUT_REQUIRED; nunca abre requestState")
        Component(traceMiddleware, "Propagação de Trace", "TypeScript puro", "Extrai traceparent do A2A, injeta no _meta MCP mantendo trace-id")
        Component(taskStore, "Store de Tasks", "Map em memória", "Task + requestState opaco associado, por taskId")
        Component(requestParser, "Parser de pedido fixo", "TypeScript puro", "reservar sala=... / escolha=...")
    }

    Rel(a2aTransport, taskStateMachine, "SendMessage/GetTask")
    Rel(a2aTransport, requestParser, "interpreta texto fixo")
    Rel(taskStateMachine, mcpHostClient, "aciona tools/call")
    Rel(mcpHostClient, traceMiddleware, "injeta traceparent no _meta")
    Rel(mcpHostClient, bridge, "entrega resultType (complete/input_required)")
    Rel(bridge, taskStateMachine, "transiciona estado da Task")
    Rel(bridge, taskStore, "guarda/recupera requestState opaco por Task")
    Rel(taskStateMachine, taskStore, "persiste estado corrente")
```

## 4. Decisões de arquitetura derivadas

As decisões que sustentam este desenho (por que HMAC e não apenas base64, por que dois processos, por que sem callback síncrono) estão registradas formalmente em [03-adr.md](./03-adr.md).

## 5. Fora de escopo arquitetural

Sem gateway, sem service mesh, sem banco de dados, sem fila de mensagens, sem container/orquestração — ver [01-pontea2a.prd.md §22](./01-pontea2a.prd.md#22-fora-de-escopo).
