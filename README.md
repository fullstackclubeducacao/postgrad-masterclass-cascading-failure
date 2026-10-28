# cascading-failure-lab

Demo de aula: **falha em cascata por esgotamento do pool de conexões** contra um Postgres de
instância única, reproduzível num notebook. Cada branch é uma decisão de arquitetura
("decisão → efeito colateral → próxima decisão"), com um `DECISION.md` explicando o porquê.

```
main ──┬── fix/scale-out      (4 réplicas: piora)
       ├── fix/retry          (retries: tempestade)
       └── fix/timeouts ── fix/bulkhead ── fix/index
           (falhar rápido)  (isolar)        (tratar a causa)
```

## O que tem aqui

| Peça | Detalhe |
|---|---|
| `api/` | Node 20 + Fastify + `pg` + `prom-client`. Usa `pool.connect()` explícito (`api/src/db.js`) para medir **fila do pool** e **SQL** separadamente |
| Postgres 16 | `max_connections=50`, **2 vCPU** (`PG_CPUS`), sem paralelismo/JIT (comportamento previsível). Seed: 10k produtos, 3M pedidos, 9M itens |
| `postgres_exporter` | conexões por estado (`pg_stat_activity`) e `max_connections` |
| Prometheus | scrape a cada 5 s; descobre todas as réplicas da API via DNS do Docker; recebe o remote write do k6 |
| Grafana | datasource e dashboard provisionados como código; acesso anônimo (Admin); o dashboard da demo é a home |
| k6 | `constant-arrival-rate` (**modelo aberto**), um cenário por rota; baseline de 30 s sem relatório → relatório entra → 150 s de carga |

Tráfego padrão (`.env`): `GET /products/:id` 60 req/s · `POST /orders` 25 · `GET /orders/:id` 13 ·
`GET /reports/sales` 2 (**2%**).

## Pré-requisitos

- Docker Desktop com **≥ 6 GB de RAM** e ≥ 4 CPUs para a VM (Settings → Resources) e ~3 GB de disco.
- `make`, `git`. Portas livres: **3000** (Grafana) e **9090** (Prometheus); dá para mudar no `.env`.

**Antes da aula (com internet boa):**

```bash
make pull      # docker compose pull + build da API: nada é baixado durante a aula
make reset     # cria o banco do zero e faz o seed (~2 min)
```

## Comandos

| Comando | O que faz |
|---|---|
| `make up` | sobe/atualiza a stack da branch atual e aplica `db/branch.sql` (índices da branch) |
| `make load` | recria a API (zera filas) e roda o k6 (~3 min). Taxas no `.env` ou no shell: `RATE_REPORT=8 make load` |
| `make reset` | apaga o volume e recria o banco do zero (~2 min) |
| `make logs` | logs da API e do Postgres |
| `make who` | roda `scripts/who-holds-connections.sql`: quem está segurando conexões agora |
| `make down` | para tudo (mantém o banco) |

Grafana: <http://localhost:3000> (modo projetor: <http://localhost:3000/d/cascade?kiosk>).

## O dashboard

| # | Painel | Para que serve |
|---|---|---|
| topo | p95 products · fila do pool · erro do cliente · conexões no Postgres | números grandes para o projetor |
| 1 | Latência p95 por rota (escala log) | a degradação de **todas** as rotas |
| 2 | Taxa de erro por rota, vista pelo **cliente** (5xx + timeouts do k6) | quem falha, e quando |
| 3 | **Fila do pool (tracejado) vs SQL (sólido), por rota** | **o painel-chave**: separa "o banco está lento" de "estou esperando conexão" |
| 4 | Pool: ativas / ociosas / máximo / em espera (eixo direito) | o pool cheio e a fila crescendo |
| 5 | Conexões do Postgres por estado vs `max_connections` | o limite do banco (scale-out) |
| 6 | Req/s enviadas pelo k6 vs taxa configurada (+ descartadas) | amplificação por retry |

## Roteiro por branch

Para cada branch: `git checkout <branch> && make up && make load`, depois olhe o Grafana.
O relatório entra aos **30 s** de carga. Os números abaixo foram **medidos neste repositório**
(MacBook, Apple Silicon, 14 CPUs, Docker Desktop com 8 GB; Postgres limitado a 2 vCPU),
lidos do Prometheus em janelas de 20 s. Relatório isolado, sem carga: **~1,1 s** neste Mac
(o seq scan de 3M linhas com `to_char()` por linha); num notebook mais modesto, 2–3 s.

### 1. `main`: a rota de 2% derruba todas

```bash
git checkout main && make up && make load
```

**O que acontece:** os relatórios (seq scan + `to_char()` em 3M linhas) chegam mais rápido do que o
banco de 2 vCPU consegue terminá-los, ocupam as 15 conexões do pool, e todas as outras rotas
entram numa fila FIFO sem limite atrás deles.

**Olhe:** painel 3 (o tracejado das rotas rápidas dispara, o sólido fica em ms), painel 4, painel 1.

| Medido | Valor |
|---|---|
| p95 `GET /products/:id` no baseline | 1–2 ms |
| p95 `GET /products/:id` 20 s depois do relatório entrar | **8,4–9,1 s** (> 4000× o baseline) |
| p95 `GET /products/:id` 60 s depois | 19–28 s, e subindo até o teto de 60 s do cliente |
| `db_pool_waiting` | > 0 o tempo todo após o relatório: 450 → **~3.500** requisições na fila |
| Painel 3, `GET /products/:id` | **fila 1,3 s → 49 s**; SQL 2–7 ms |
| Painel 3, `GET /reports/sales` | SQL 10–17 s por relatório (isolado: 1,1 s). Nos primeiros ~40 s o SQL domina; depois o próprio relatório também passa a esperar na fila |
| Conexões no Postgres | **17 de 50**: o banco não está cheio, o pool está |
| Erros vistos pelo cliente | **0%** por ~2 min (a espera infinita não falha, só pendura); depois **100%** (timeout de 60 s do k6) |

> Para a aula: o erro só aparece no painel 2 bem depois do estrago no painel 1. "Sem erro" ≠ saudável.

### 2. `fix/scale-out`: 4 réplicas × 15 = 60 > 50

```bash
git checkout fix/scale-out && make up && make load
```

**O que acontece:** os pools das 4 réplicas tentam crescer juntos e o Postgres recusa
(`sorry, too many clients already`, ver `make logs`). Mais relatórios em paralelo nas mesmas 2 vCPUs:
cada um fica ainda mais lento.

**Olhe:** painel 5 (bate no limite), painel 2.

| Medido | `fix/scale-out` | `main` (mesmo instante) |
|---|---|---|
| Conexões no Postgres | **47–48** (o limite: 50 − 3 reservadas para superusuário) | 17 |
| Erro total, 40 s após o relatório | 5% | 0% |
| Erro total, 60 s → 160 s após o relatório | **45–51%, em todas as rotas** | 0% |
| Erros `too many clients` nos logs da API | ~1.200 por execução | 0 |
| SQL do relatório | 24–42 s | 10–17 s |
| p95 `GET /products/:id` | 90–180 ms | 9–58 s |

> Repare: o p95 das rotas rápidas até "melhora", porque metade das requisições agora falha
> **na hora** em vez de esperar. A falha mudou de forma (de pendurada para explícita), não sumiu.
> Nos ~2 primeiros minutos o scale-out tem muito mais erro que a `main`; no fim da execução a
> `main` também chega a 100% por timeout do cliente.

### 3. `fix/retry`: tempestade de retries

```bash
git checkout fix/retry && make up && make load
```

**O que acontece:** o cliente desiste em 3 s e repete até 3 vezes, imediatamente. Quando a
latência passa de 3 s, cada requisição vira 4. O servidor não sabe que o cliente desistiu: as
abandonadas continuam na fila.

**Olhe:** painel 6 (a linha vermelha descola da tracejada), painel 4.

| Medido | `fix/retry` | `main` |
|---|---|---|
| Req/s enviadas (configurado: 100) | 200 (+20 s) → 340 (+40 s) → **~400/s (4×)** a partir de +60 s | ≤ 100 |
| 100% de erro em todas as rotas | **~20 s** após o relatório entrar | ~2,5 min |
| `db_pool_waiting` no fim | **~48.000** | ~3.500 |

### 4. `fix/timeouts`: falhar rápido

```bash
git checkout fix/timeouts && make up && make load
```

**O que acontece:** `connectionTimeoutMillis: 1000`, `statement_timeout: 2000`, 503 imediato. Cada
relatório segura uma conexão por no máximo 2 s, então eles não ocupam mais o pool inteiro.

**Olhe:** painel 1 (as rotas rápidas não se mexem), painel 2 (só o relatório), painel 3 (SQL do
relatório "achatado" em 2 s).

| Medido | Valor |
|---|---|
| p95 `GET /products/:id` durante toda a carga | **1 ms** |
| Erro nas rotas transacionais | 0% |
| Erro no relatório | **90–100%** (503, `statement_timeout`) |
| Erro total | 1,8–1,9% (= a fatia do relatório) |
| SQL do relatório | ~2,0 s (o `statement_timeout`) |

### 5. `fix/bulkhead`: isolar o relatório

```bash
git checkout fix/bulkhead && make up && make load
```

**O que acontece:** pool `reports` (3) e pool `transactional` (12). Com só 3 relatórios
simultâneos disputando a CPU, parte deles volta a terminar antes dos 2 s.

**Olhe:** painel 4 (dois pools: `reports` cheio, `transactional` folgado), painel 2.

| Medido | Valor |
|---|---|
| Erro nas rotas transacionais | **0,0%** |
| p95 `GET /products/:id` | 1–15 ms |
| Erro no relatório | 40–78% (503: fila do pool `reports` ou `statement_timeout`) |
| Fila do pool `reports` / SQL do relatório | ~0,6 s / 1,7–1,9 s |

#### Experimento ao vivo: por que bulkhead se `fix/timeouts` já parecia resolver?

Com a carga padrão, `fix/timeouts` também fica com 0% de erro nas rotas rápidas, mas só porque a
conta fecha: 2 relatórios/s × 2 s = ~4 das 15 conexões. Quadruplique o relatório:

```bash
git checkout fix/timeouts && make up && RATE_REPORT=8 make load   # 8 × 2 s = 16 > 15
git checkout fix/bulkhead && make up && RATE_REPORT=8 make load
```

| `RATE_REPORT=8` | `fix/timeouts` | `fix/bulkhead` |
|---|---|---|
| Erro em `GET /products/:id` | **22–30%** (503: sem conexão no pool) | **0,0%** |
| p95 `GET /products/:id` | ~1,7 s | 1–20 ms |
| Fila do pool para as rotas rápidas | ~0,9 s | 0 ms |

Timeout limita *quanto tempo* uma conexão fica presa; bulkhead limita *quantas* uma carga pode prender.

### 6. `fix/index`: tratar a causa

```bash
git checkout fix/index && make up && make load    # a 1ª subida cria os índices (~20 s)
```

**O que acontece:** índice em `orders(created_at)`, índice covering em `order_items`, e o filtro do
relatório reescrito como intervalo sobre a coluna (com `to_char(created_at)` no `WHERE` o índice
não seria usado). Timeouts e bulkhead continuam lá.

| Medido | Valor |
|---|---|
| SQL do relatório | **118–121 ms** (antes: 1,1 s isolado, 10–40 s sob carga) |
| p95 do relatório (histograma da API) | ~148 ms |
| p95 `GET /products/:id` | 1–2 ms |
| Erro em todas as rotas | **0,0%** |
| Conexões no Postgres | ~5 |

### Resumo

| Branch | p95 `GET /products/:id` sob carga | Erro nas rotas transacionais | Erro no relatório |
|---|---|---|---|
| `main` | 9 s → 60 s | 0% por ~2 min, depois 100% (timeout) | idem |
| `fix/scale-out` | 90–180 ms | **45–51%** (too many clients) | 45–65% |
| `fix/retry` | 19 s → 120 s | **100% em ~20 s** | 100% |
| `fix/timeouts` | 1 ms | 0% | 90–100% |
| `fix/bulkhead` | 1–15 ms | 0% | 40–78% |
| `fix/index` | 1–2 ms | 0% | 0% |

## Plano B (se algo falhar ao vivo)

Grave **antes da aula**, com a stack aquecida (`make reset` uma vez, depois `make up` em cada branch):

1. **Vídeo de cada branch.** Abra <http://localhost:3000/d/cascade?kiosk&from=now-5m&to=now&refresh=5s>,
   comece a gravar (macOS: `Cmd+Shift+5`) e rode `make load`. Grave os ~3,5 min inteiros.
   Prioridade se o tempo for curto: `main`, `fix/retry`, `fix/bulkhead`, `fix/index`.
2. **Snapshot do Grafana** ao fim de cada execução: ícone de compartilhar (topo do dashboard) →
   **Snapshot** → *Local Snapshot* → **Publish snapshot**, e guarde o link
   (fica em *Dashboards → Snapshots*, servido pelo próprio Grafana local, sem internet).
   Para levar para outra máquina: *Share → Export → Save to file* exporta o JSON do dashboard;
   os dados não vão junto, então para outra máquina o vídeo é o plano B de verdade.
3. **Prints dos painéis-chave** (painel 3 na `main`, painel 6 na `fix/retry`, painel 4 na
   `fix/bulkhead`): abra o painel em tela cheia (passe o mouse e aperte `v`) e use `Cmd+Shift+4`.
   (O "rendered image" do Grafana precisa de um plugin que não está instalado.)
4. Os dados do Prometheus ficam guardados por 2 dias: dá para voltar o intervalo do Grafana
   para uma execução gravada mais cedo (*time picker* → intervalo absoluto), desde que você
   não rode `make reset` nem `docker compose down -v`.

## Troubleshooting

**Porta ocupada** (`Bind for 0.0.0.0:3000 failed: port is already allocated`)
: mude `GRAFANA_PORT` / `PROMETHEUS_PORT` no `.env` e rode `make up`. Para ver quem usa a porta:
`lsof -iTCP:3000 -sTCP:LISTEN`.

**Docker sem memória** (containers reiniciando, `exit code 137`, k6 morto no meio)
: Docker Desktop → Settings → Resources → Memory ≥ 6 GB. Feche o que puder. Se ainda faltar,
reduza `MAX_VUS` no `.env` (ex.: 1500). Na `main` e na `fix/retry` o k6 então **descarta**
iterações (aparece no painel 6 como "descartadas"), mas a cascata continua visível.

**Seed travado ou banco estranho** / quero começar do zero
: `make reset` (apaga o volume e refaz o seed, ~2 min). `make logs` mostra o progresso do seed
(`seed: orders`, `seed: order_items`...). A API só sobe depois que o seed termina.

**Troquei de branch e nada mudou**
: rode `make up` (reconstrói a API e aplica `db/branch.sql`). `make load` também reconstrói a API.
Na `fix/index`, a primeira subida cria dois índices (~20 s).

**`VACUUM`/query falha com `No space left on device`**
: é o `/dev/shm` do container; o compose já define `shm_size: 512mb`. Se aparecer, confira se
o `docker-compose.yml` da branch tem essa linha.

**Os números não batem com os daqui**
: a cascata depende de *taxa do relatório × duração do relatório* ser maior que a capacidade
do banco. Numa máquina mais lenta ela é mais forte; numa mais rápida, suba `RATE_REPORT`
(3–4) ou baixe `PG_CPUS` para 1. Rode `make load` de novo; não é preciso recriar o banco.

**O Grafana mostra dados da execução anterior**
: o intervalo padrão é "últimos 5 min". Espere ou ajuste para `now-4m`.

## Estrutura

```
api/src/pools.js     ← a decisão de cada branch (tamanho do pool, timeouts, bulkhead)
api/src/db.js        ← withConnection(): mede fila do pool vs SQL
api/src/errors.js    ← mapeamento de erros (500 na main, 503 rápido a partir de fix/timeouts)
api/src/routes.js    ← as 4 rotas (a query do relatório muda em fix/index)
db/init/             ← schema + seed (generate_series), só num volume vazio
db/branch.sql        ← índices da branch (aplicado a cada `make up` pelo serviço migrate)
load/script.js       ← k6, modelo aberto (retries em fix/retry)
grafana/dashboards/  ← o dashboard, como código
DECISION.md          ← decisão / por que parece certa / efeito colateral / onde olhar
```

Testes da instrumentação: `cd api && npm install && npm test`.
