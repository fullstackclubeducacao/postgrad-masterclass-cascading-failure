-- Estado de schema desta branch. Aplicado a cada `make up` pelo serviço `migrate`,
-- para que trocar de branch não exija recriar o banco.
-- main: created_at SEM índice (remove os índices criados por fix/index, se existirem).
DROP INDEX IF EXISTS orders_created_at_idx;
DROP INDEX IF EXISTS order_items_order_id_covering_idx;
