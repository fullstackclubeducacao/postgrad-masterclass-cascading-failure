-- Executado uma única vez, quando o volume do Postgres está vazio (ver `make reset`).
CREATE ROLE app LOGIN PASSWORD 'app';
CREATE DATABASE shop OWNER app;
\connect shop

SET ROLE app;

CREATE TABLE products (
  id          int PRIMARY KEY,
  name        text NOT NULL,
  price_cents int  NOT NULL,
  description text NOT NULL
);

CREATE TABLE orders (
  id               bigserial PRIMARY KEY,
  customer_id      int         NOT NULL,
  status           text        NOT NULL,
  created_at       timestamptz NOT NULL,       -- SEM índice de propósito (ver branch fix/index)
  shipping_address text        NOT NULL         -- deixa a linha "larga", como numa tabela real
);

CREATE TABLE order_items (
  id          bigserial PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders (id),
  product_id  int    NOT NULL REFERENCES products (id),
  quantity    int    NOT NULL,
  price_cents int    NOT NULL
);
