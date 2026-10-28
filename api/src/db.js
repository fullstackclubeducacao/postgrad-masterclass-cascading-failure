import { poolWait, queryDuration } from './metrics.js'

// Não usamos pool.query(): ela esconde quanto tempo foi fila e quanto foi SQL.
// Aqui as duas fases são medidas separadamente — é isso que o painel 3 mostra.
export async function withConnection(pool, route, fn) {
  const labels = { route, pool: pool.name }
  const endWait = poolWait.startTimer(labels)
  let conn
  try {
    conn = await pool.connect()
  } finally {
    endWait()
  }

  const endQuery = queryDuration.startTimer(labels)
  let brokenConnection
  try {
    return await fn(conn)
  } catch (err) {
    // Erros vindos do Postgres têm `severity` (ex.: 57014 statement_timeout): a conexão continua boa.
    // Sem `severity` é erro de socket/protocolo (ECONNRESET...): release(err) faz o pool descartá-la.
    if (!err.severity) brokenConnection = err
    throw err
  } finally {
    endQuery()
    conn.release(brokenConnection)
  }
}
