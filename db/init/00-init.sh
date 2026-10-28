#!/bin/sh
# Roda schema + seed, passando os parâmetros do .env (SEED_ORDERS, SEED_PADDING) para o psql.
set -e
echo "seed: orders=${SEED_ORDERS:-3000000} padding=${SEED_PADDING:-2}"
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -f /docker-entrypoint-initdb.d/sql/01-schema.sql
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v orders="${SEED_ORDERS:-3000000}" -v padding="${SEED_PADDING:-2}" \
  -f /docker-entrypoint-initdb.d/sql/02-seed.sql
