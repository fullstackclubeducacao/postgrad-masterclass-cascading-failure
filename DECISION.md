# `fix/timeouts` — "falhar rápido"

## Decisão
Limites explícitos em `api/src/pools.js`:
- `connectionTimeoutMillis: 1000`: no máximo **1 s** na fila do pool;
- `statement_timeout: 2000`: o Postgres cancela qualquer SQL que passe de **2 s**;
- em `api/src/errors.js`, os dois casos viram **503 imediato** (em vez de 500 ou de uma requisição pendurada).

## Por que parece certa
- Uma requisição que espera 60 s não ajuda ninguém: o cliente já foi embora.
- Cancelar o SQL devolve a conexão ao pool; falhar na fila evita que ela cresça sem limite.
- 503 é honesto: "estou sobrecarregado, tente depois".

## Efeito colateral esperado
O relatório leva bem mais que 2 s sob carga → é **cancelado sempre** → o relatório passa a
falhar 100% (antes ele era lento, agora não funciona). Em compensação cada relatório segura uma
conexão por no máximo 2 s, então os relatórios não conseguem mais ocupar o pool inteiro:
as rotas rápidas **sobrevivem**, com latência limitada. Ainda há espera no pool (as conexões
continuam compartilhadas) e o banco continua gastando CPU com relatórios que serão cancelados.

## Onde olhar no Grafana
- **Painel 1**: p95 de `GET /products/:id` fica na casa das centenas de ms, não dezenas de segundos.
- **Painel 2**: erros concentrados em `GET /reports/sales`.
- **Painel 3**: SQL do relatório "achatado" em ~2 s (o `statement_timeout`).
- **Painel 4**: "em espera" limitado.

## Próxima decisão
O relatório ainda divide o pool com as rotas transacionais → `fix/bulkhead`.
