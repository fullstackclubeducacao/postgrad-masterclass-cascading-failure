# `main` — o ponto de partida

## Decisão
Uma réplica da API, um único pool `pg` com **15 conexões**, `connectionTimeoutMillis: 0`
(espera infinita por uma conexão) e **nenhum `statement_timeout`**. Todas as rotas usam o mesmo pool.
Ver `api/src/pools.js`.

## Por que parece certa
- São os defaults do `node-postgres`: "se o driver vem assim, deve estar bom".
- 15 conexões sobram para ~100 req/s de queries de 1–2 ms.
- O relatório de vendas é só **2% do tráfego**. Que mal ele pode fazer?

## Efeito colateral esperado
O relatório faz seq scan em ~3 milhões de pedidos e calcula `to_char()` em cada linha.
Com 2 req/s de relatório e um banco de 2 vCPU, os relatórios chegam mais rápido do que terminam:
eles se acumulam até ocupar **as 15 conexões do pool**. A partir daí toda requisição, inclusive
`GET /products/:id` (1 ms de SQL), entra numa fila FIFO sem limite atrás de relatórios de 15+ s.
A rota de 2% derruba as outras 98%.

## Onde olhar no Grafana
- **Painel 3** (o painel-chave): nas rotas rápidas o tracejado (fila do pool) dispara para dezenas de
  segundos enquanto o sólido (SQL) continua em ~2 ms. O problema não é o banco ser lento para elas:
  é a **fila**.
- **Painel 4**: "ativas" cola no máximo (15) e "em espera" sobe sem parar.
- **Painel 1**: p95 de `GET /products/:id` sai de ~1 ms para dezenas de segundos.
- **Painel 2**: os erros só aparecem ~1–2 min depois, quando o cliente (timeout padrão de 60 s do k6)
  desiste. Espera infinita não falha — só fica pendurada.
- **Painel 5**: o Postgres nem está cheio (~17 de 50). O gargalo é o pool, não o `max_connections`.

## Próximas decisões possíveis
- "Falta capacidade, vamos escalar a API" → `fix/scale-out`
- "Os clientes devem tentar de novo" → `fix/retry`
- "Falhar rápido" → `fix/timeouts`
