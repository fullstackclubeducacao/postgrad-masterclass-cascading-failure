-- Estado de schema desta branch. Aplicado a cada `make up` pelo serviço `migrate`,
-- para que trocar de branch não exija recriar o banco.
-- main: created_at SEM índice.
DROP INDEX IF EXISTS orders_created_at_idx;
