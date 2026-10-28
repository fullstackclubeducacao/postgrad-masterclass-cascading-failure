import pg from 'pg'
import { observePool } from './metrics.js'

// ─── A DECISÃO DESTA BRANCH ────────────────────────────────────────────────
// fix/timeouts: limites explícitos. No máximo 1 s esperando uma conexão do pool
// e no máximo 2 s de SQL. Passou disso, 503 imediato (ver errors.js).
// ──────────────────────────────────────────────────────────────────────────
const main = createPool('main', {
  max: 15,
  connectionTimeoutMillis: 1000,
  statement_timeout: 2000,
})

// Todas as rotas usam o mesmo pool.
export const pools = {
  products: main,
  orders: main,
  reports: main,
}

function createPool(name, options) {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: `api-${name}`,
    ...options,
  })
  pool.name = name
  pool.on('error', (err) => console.error(`[pool ${name}] idle client error:`, err.message))
  observePool(pool)
  return pool
}
