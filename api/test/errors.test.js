import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toHttpError } from '../src/errors.js'

test('pool acquisition timeout fails fast with 503', () => {
  const { status } = toHttpError(new Error('timeout exceeded when trying to connect'))
  assert.equal(status, 503)
})

test('statement_timeout (SQLSTATE 57014) fails with 503', () => {
  const err = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
  assert.equal(toHttpError(err).status, 503)
})

test('any other failure is still a 500', () => {
  assert.equal(toHttpError(new Error('boom')).status, 500)
})

test('timing out while opening a new connection is also a fast 503', () => {
  const { status } = toHttpError(new Error('Connection terminated due to connection timeout'))
  assert.equal(status, 503)
})
