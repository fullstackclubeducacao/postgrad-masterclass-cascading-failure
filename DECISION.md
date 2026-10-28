# `fix/index` — "tratar a causa: a query"

## Decisão
Em `db/branch.sql` (aplicado automaticamente pelo serviço `migrate`):
1. índice em `orders (created_at)`;
2. índice *covering* em `order_items (order_id) INCLUDE (quantity, price_cents)`.

E em `api/src/routes.js`, a query do relatório deixa de aplicar `to_char()` em `created_at` no
`WHERE`: os limites do período é que são convertidos para o fuso de São Paulo, e o filtro vira um
intervalo sobre a coluna. Sem isso o índice do item 1 **não seria usado**.

Os timeouts e o bulkhead das branches anteriores continuam lá.

## Por que parece certa (e desta vez é)
- O relatório não é lento por falta de conexões ou de réplicas: ele lê 3 milhões de linhas para
  devolver 7 dias. Com o índice ele lê só as ~58 mil do período, e o join lê só o índice de
  `order_items`.
- O índice muda o custo do relatório de ~1 s de CPU isolado (15+ s sob carga) para ~0,1 s.

## Efeito colateral esperado
Nenhum visível na demo: todas as rotas saudáveis com a mesma carga. Os custos reais ficam fora do
gráfico: escrita um pouco mais cara em `orders`/`order_items` (mais índices para manter), espaço em
disco, e o risco de alguém "otimizar" a query de volta para `to_char(created_at)`.
Os timeouts e o bulkhead **continuam necessários**: são eles que protegem o sistema da próxima
query lenta que ainda não conhecemos.

## Onde olhar no Grafana
- **Painel 1**: p95 do relatório < 200 ms; rotas rápidas no baseline.
- **Painel 2**: erro ≈ 0 em todas as rotas.
- **Painel 4**: pool `reports` com folga; fila vazia.
- **Painel 5**: poucas conexões ativas no Postgres.
