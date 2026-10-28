import client from 'prom-client'

export const registry = new client.Registry()
client.collectDefaultMetrics({ register: registry })

// Buckets vão de 1 ms a 2 min: precisamos enxergar tanto o baseline (ms) quanto a fila infinita (dezenas de s).
const buckets = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5, 1, 2, 3, 5, 10, 20, 30, 60, 120]

export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração da requisição HTTP, do ponto de vista da API',
  labelNames: ['route', 'status'],
  buckets,
  registers: [registry],
})

export const poolWait = new client.Histogram({
  name: 'db_pool_wait_seconds',
  help: 'Tempo esperando o pool entregar uma conexão (pool.connect())',
  labelNames: ['route', 'pool'],
  buckets,
  registers: [registry],
})

export const queryDuration = new client.Histogram({
  name: 'db_query_seconds',
  help: 'Tempo executando SQL com a conexão já em mãos',
  labelNames: ['route', 'pool'],
  buckets,
  registers: [registry],
})

// Gauges lidos do próprio pg.Pool no momento do scrape. Label `pool` separa os pools do bulkhead.
const pools = []
export function observePool(pool) {
  pools.push(pool)
}

function poolGauge(name, help, read) {
  return new client.Gauge({
    name,
    help,
    labelNames: ['pool'],
    registers: [registry],
    collect() {
      for (const pool of pools) this.set({ pool: pool.name }, read(pool))
    },
  })
}

poolGauge('db_pool_total', 'Conexões abertas pelo pool (ativas + ociosas)', (p) => p.totalCount)
poolGauge('db_pool_idle', 'Conexões abertas e ociosas', (p) => p.idleCount)
poolGauge('db_pool_waiting', 'Requisições na fila esperando uma conexão', (p) => p.waitingCount)
poolGauge('db_pool_max', 'Tamanho máximo configurado do pool', (p) => p.options.max)
