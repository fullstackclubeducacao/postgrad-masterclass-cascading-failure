# `fix/bulkhead` — "isolar o relatório"

## Decisão
Dois pools em `api/src/pools.js`, com os mesmos timeouts de `fix/timeouts`:
- `transactional` (**12 conexões**): `GET /products/:id`, `POST /orders`, `GET /orders/:id`;
- `reports` (**3 conexões**): `GET /reports/sales`.

O total continua 15: nenhuma conexão a mais no banco.

## Por que parece certa
- Em `fix/timeouts` o relatório ainda compete pelo mesmo pool: a proteção depende de uma
  conta (taxa do relatório × 2 s < 15) que qualquer pico de relatório quebra.
- Bulkhead (compartimentos estanques de um navio): um vazamento inunda um compartimento, não o navio.
- O relatório é a carga de risco; o checkout é a carga que paga as contas.

## Efeito colateral esperado
O relatório fica limitado a 3 execuções simultâneas: com 2 req/s, parte dos pedidos estoura a fila
do pool `reports` (1 s) e recebe 503 rápido; os que entram disputam menos CPU e uma parte termina
antes dos 2 s. O relatório continua falhando em boa parte das vezes.
As rotas transacionais ficam **saudáveis**: erro ≈ 0, mesmo se a taxa do relatório subir.
A falha ficou **confinada**, mas não resolvida: o relatório ainda não funciona.

## Onde olhar no Grafana
- **Painel 4**: pool `reports` cheio (3/3) e com fila; pool `transactional` folgado.
- **Painel 2**: erro só em `GET /reports/sales`.
- **Painel 3**: rotas transacionais sem espera no pool.
- Experimento ao vivo: `RATE_REPORT=8 make load` aqui e em `fix/timeouts` (ver README).

## Próxima decisão
Parar de tratar o sintoma: o relatório é lento porque a query faz seq scan → `fix/index`.
