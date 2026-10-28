// fix/timeouts: falhar rápido e de forma explícita. Esperar demais pelo pool ou pelo
// banco vira 503 (sobrecarga, tente depois) — não uma requisição pendurada.
// pg-pool: esperou na fila / pg: estourou o prazo abrindo uma conexão nova.
const POOL_TIMEOUTS = ['timeout exceeded when trying to connect', 'Connection terminated due to connection timeout']
const QUERY_CANCELED = '57014' // statement_timeout

export function toHttpError(err) {
  if (err.validation) return { status: 400, body: { error: err.message } }
  if (POOL_TIMEOUTS.includes(err.message)) return { status: 503, body: { error: 'sem conexão disponível no pool' } }
  if (err.code === QUERY_CANCELED) return { status: 503, body: { error: 'consulta excedeu statement_timeout' } }
  return { status: 500, body: { error: err.message } }
}
