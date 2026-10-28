import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withConnection } from '../src/db.js'
import { registry } from '../src/metrics.js'

function fakePool(name, { connectDelayMs = 0, connectError } = {}) {
  const pool = { name, released: [], totalCount: 0, idleCount: 0, waitingCount: 0 }
  pool.connect = async () => {
    await new Promise((r) => setTimeout(r, connectDelayMs))
    if (connectError) throw connectError
    return { release: (err) => pool.released.push(err ?? null) }
  }
  return pool
}

async function sampleCount(metric, labels) {
  const { values } = await registry.getSingleMetric(metric).get()
  const match = values.find(
    (v) => v.metricName === `${metric}_count` && Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  )
  return match?.value ?? 0
}

async function sampleSum(metric, labels) {
  const { values } = await registry.getSingleMetric(metric).get()
  return values.find(
    (v) => v.metricName === `${metric}_sum` && Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  )?.value ?? 0
}

test('measures pool wait and query time separately, per route, and releases the connection', async () => {
  const pool = fakePool('main', { connectDelayMs: 50 })
  const result = await withConnection(pool, 'GET /x', async () => {
    await new Promise((r) => setTimeout(r, 20))
    return 'rows'
  })

  assert.equal(result, 'rows')
  assert.deepEqual(pool.released, [null])
  assert.equal(await sampleCount('db_pool_wait_seconds', { route: 'GET /x', pool: 'main' }), 1)
  assert.equal(await sampleCount('db_query_seconds', { route: 'GET /x', pool: 'main' }), 1)
  assert.ok((await sampleSum('db_pool_wait_seconds', { route: 'GET /x' })) >= 0.045)
  const query = await sampleSum('db_query_seconds', { route: 'GET /x' })
  assert.ok(query >= 0.015 && query < 0.045, `query time ${query} should exclude pool wait`)
})

test('a SQL error returns the connection to the pool; a broken connection is discarded', async () => {
  const pool = fakePool('main')
  const sqlError = Object.assign(new Error('canceling statement due to statement timeout'), {
    code: '57014',
    severity: 'ERROR',
  })
  const brokenConnection = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })

  await assert.rejects(withConnection(pool, 'GET /y', async () => { throw sqlError }), sqlError)
  await assert.rejects(withConnection(pool, 'GET /y', async () => { throw brokenConnection }), brokenConnection)

  assert.deepEqual(pool.released, [null, brokenConnection])
})

test('when the pool cannot deliver a connection, the wait is still recorded and nothing is released', async () => {
  const pool = fakePool('main', { connectError: new Error('sorry, too many clients already') })
  await assert.rejects(withConnection(pool, 'GET /z', async () => 'never'), /too many clients/)
  assert.equal(await sampleCount('db_pool_wait_seconds', { route: 'GET /z' }), 1)
  assert.equal(await sampleCount('db_query_seconds', { route: 'GET /z' }), 0)
  assert.deepEqual(pool.released, [])
})
