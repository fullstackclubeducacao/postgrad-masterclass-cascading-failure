import pg from 'pg'
import { observePool } from './metrics.js'

// ─── A DECISÃO DESTA BRANCH ────────────────────────────────────────────────
// fix/bulkhead: os mesmos limites de fix/timeouts, mas o relatório ganha um pool
// SÓ DELE (3 conexões). As rotas transacionais ficam com as outras 12.
// Mesmas 15 conexões no total: não pedimos nada a mais para o banco.
// ──────────────────────────────────────────────────────────────────────────
const limits = {
  connectionTimeoutMillis: 1000,
  statement_timeout: 2000,
}
const transactional = createPool('transactional', { max: 12, ...limits })
const reports = createPool('reports', { max: 3, ...limits })

export const pools = {
  products: transactional,
  orders: transactional,
  reports,
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
