-- Estado de schema desta branch. Aplicado a cada `make up` pelo serviço `migrate`,
-- para que trocar de branch não exija recriar o banco.
-- fix/index (leva ~10–20 s na primeira vez):
-- 1) índice em orders(created_at): encontra os pedidos do período sem seq scan;
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at);
-- 2) índice "covering" em order_items: o join lê quantidade e preço direto do índice
--    (index-only scan), em vez de varrer as ~9 milhões de linhas de order_items.
CREATE INDEX IF NOT EXISTS order_items_order_id_covering_idx
  ON order_items (order_id) INCLUDE (quantity, price_cents);
VACUUM (ANALYZE) orders, order_items;
