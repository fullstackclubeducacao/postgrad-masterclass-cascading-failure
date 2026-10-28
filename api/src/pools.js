import pg from 'pg'
import { observePool } from './metrics.js'

// ─── A DECISÃO DESTA BRANCH ────────────────────────────────────────────────
// main: um único pool de 15 conexões, espera infinita pela conexão
// (connectionTimeoutMillis: 0) e nenhum statement_timeout.
// "Os defaults do driver devem estar bons."
// ──────────────────────────────────────────────────────────────────────────
const main = createPool('main', {
  max: 15,
  connectionTimeoutMillis: 0,
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
