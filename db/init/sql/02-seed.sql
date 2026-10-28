-- Seed com generate_series. Com 3M pedidos o relatório da main (seq scan + to_char() por linha)
-- leva ~1 s isolado num Mac Apple Silicon, ~2 s num notebook modesto e 10+ s sob a carga da demo.
\connect shop
SET ROLE app;
SET synchronous_commit = off;
SET maintenance_work_mem = '512MB';

\echo 'seed: products'
INSERT INTO products (id, name, price_cents, description)
SELECT g, 'Produto ' || g, 500 + (g * 7919) % 50000, repeat(md5(g::text), 4)
FROM generate_series(1, 10000) AS g;

\echo 'seed: orders'
-- :orders pedidos espalhados por 2025 inteiro, em ordem cronológica (como numa tabela real).
INSERT INTO orders (id, customer_id, status, created_at, shipping_address)
SELECT g,
       1 + (g * 7907) % 200000,
       (ARRAY['paid', 'shipped', 'delivered', 'cancelled'])[1 + g % 4],
       timestamptz '2025-01-01 00:00:00+00' + (g::double precision / :orders) * interval '365 days',
       'Rua ' || md5(g::text) || ', ' || (g % 9999) || ' - ' || repeat(md5((g * 31)::text), :padding)
FROM generate_series(1::bigint, :orders) AS g;
SELECT setval('orders_id_seq', :orders);

\echo 'seed: order_items'
INSERT INTO order_items (order_id, product_id, quantity, price_cents)
SELECT o, 1 + (o * 31 + i * 7) % 10000, 1 + (o + i) % 5, 500 + ((o * 31 + i * 7) * 7919) % 50000
FROM generate_series(1::bigint, :orders) AS o, generate_series(1, 3) AS i;

\echo 'seed: índices e estatísticas'
CREATE INDEX order_items_order_id_idx ON order_items (order_id);
ANALYZE;
