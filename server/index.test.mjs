import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { DEFAULT_PORT, listenWithFallback, parseServerArgs } from './index.mjs'

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, '127.0.0.1', () => resolve(server.address().port))
})
const close = (server) => new Promise((resolve) => server.close(() => resolve()))

test('server arguments accept port and host flags, with flags taking precedence over env', () => {
  assert.deepEqual(parseServerArgs([], {}), { port: DEFAULT_PORT, host: '127.0.0.1' })
  assert.deepEqual(parseServerArgs([], { PORT: '5000', HOST: '0.0.0.0' }), { port: 5000, host: '0.0.0.0' })
  assert.deepEqual(parseServerArgs(['--port', '5001'], { PORT: '5000' }), { port: 5001, host: '127.0.0.1' })
  assert.deepEqual(parseServerArgs(['--port=5002', '--host=192.168.0.2'], {}), { port: 5002, host: '192.168.0.2' })
  assert.deepEqual(parseServerArgs(['--host'], {}), { port: DEFAULT_PORT, host: '0.0.0.0' })
  assert.throws(() => parseServerArgs(['--port'], {}), /requires a value/)
  assert.throws(() => parseServerArgs(['--port', '65536'], {}), /between 0 and 65535/)
  assert.throws(() => parseServerArgs([], { PORT: 'nope' }), /between 0 and 65535/)
  assert.throws(() => parseServerArgs(['--unknown'], {}), /Unknown argument/)
})

test('listenWithFallback moves to the next available port when the requested port is busy', async () => {
  const blocker = createServer()
  const retry = createServer()
  const busyPort = await listen(blocker, 0)
  try {
    const actualPort = await listenWithFallback(retry, busyPort, '127.0.0.1')
    assert.equal(actualPort, retry.address().port)
    assert.ok(actualPort > busyPort)
  } finally {
    await close(retry)
    await close(blocker)
  }
})

test('listenWithFallback lets the OS choose when the requested port is 0', async () => {
  const server = createServer()
  try {
    const actualPort = await listenWithFallback(server, 0, '127.0.0.1')
    assert.ok(actualPort > 0)
  } finally {
    await close(server)
  }
})
