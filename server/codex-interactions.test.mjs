import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CodexInteractions } from './codex-interactions.mjs'

const params = { threadId: 'thread-a', turnId: 'turn-a', itemId: 'item-a' }
const setup = (options = {}) => {
  const sent = []
  const interactions = new CodexInteractions({ send: async (id, result) => { sent.push({ id, result }) }, onChange() {}, ...options })
  const receive = (method, p = {}, id = 7) => { interactions.receive({ id, method, params: { ...params, ...p } }); return interactions.view('thread-a') }
  return { interactions, sent, receive }
}

test('command/file decisions target the original request and wait for server confirmation', async () => {
  for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']) {
    for (const action of ['accept', 'acceptForSession', 'decline', 'cancel']) {
      const { interactions, sent, receive } = setup()
      const view = receive(method, { command: 'bun test', reason: 'Needs access' })
      const response = interactions.respond('thread-a', { requestId: view.requestId, action })
      assert.deepEqual(sent, [{ id: 7, result: { decision: action } }])
      assert.equal(interactions.view('thread-a').canRespond, false)
      let completed = false
      response.then(() => { completed = true })
      await Promise.resolve()
      assert.equal(completed, false)
      interactions.resolved('thread-b', 7)
      assert(interactions.view('thread-a'))
      interactions.resolved('thread-a', 7)
      assert.deepEqual(await response, { ok: true })
      assert.equal(interactions.view('thread-a'), null)
      await assert.rejects(interactions.respond('thread-a', { requestId: view.requestId, action }), { status: 409 })
    }
  }
})

test('permissions only grant the requested access with an explicit turn or session scope', async () => {
  for (const action of ['accept', 'acceptForSession', 'decline']) {
    const { interactions, sent, receive } = setup()
    const permissions = { network: { enabled: true }, fileSystem: null }
    const view = receive('item/permissions/requestApproval', { permissions })
    const response = interactions.respond('thread-a', { requestId: view.requestId, action, permissions: { fileSystem: { write: ['/'] } } })
    assert.deepEqual(sent[0].result, { permissions: action === 'decline' ? {} : { network: { enabled: true } }, scope: action === 'acceptForSession' ? 'session' : 'turn' })
    interactions.resolved('thread-a', 7)
    await response
  }
})

test('blocking questions preserve ids, secret fields and allowed choices without starting another turn', async () => {
  const { interactions, sent, receive } = setup()
  const view = receive('item/tool/requestUserInput', { questions: [
    { id: 'choice', question: 'Choose a strategy', options: [{ label: 'Incremental', description: 'Keep records' }], isOther: false },
    { id: 'secret', question: 'Access code', options: null, isOther: true, isSecret: true },
  ] })
  assert.equal(view.fields[1].secret, true)
  await assert.rejects(interactions.respond('thread-a', { requestId: view.requestId, action: 'accept', values: { choice: 'Invalid', secret: 'code' } }), { status: 400 })
  assert.equal(sent.length, 0)
  const response = interactions.respond('thread-a', { requestId: view.requestId, action: 'accept', values: { choice: 'Incremental', secret: 'code' } })
  assert.deepEqual(sent[0], { id: 7, result: { answers: { choice: { answers: ['Incremental'] }, secret: { answers: ['code'] } } } })
  interactions.resolved('thread-a', 7)
  await response
})

test('MCP forms validate values, preserve boolean/number types, and support declined or cancelled URL requests', async () => {
  const { interactions, sent, receive } = setup()
  const view = receive('mcpServer/elicitation/request', { mode: 'form', message: 'Details', requestedSchema: {
    type: 'object', required: ['name', 'count', 'enabled', 'tags'], properties: {
      name: { type: 'string', minLength: 2 }, count: { type: 'integer', minimum: 1, maximum: 10 }, enabled: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string', enum: ['one', 'two'] }, minItems: 1 },
    },
  } })
  for (const values of [ { name: 'ok', count: 1.5, enabled: true, tags: ['one'] }, { name: 'ok', count: 1, enabled: 'true', tags: ['one'] }, { name: 'ok', count: 1, enabled: true, tags: ['other'] } ]) {
    await assert.rejects(interactions.respond('thread-a', { requestId: view.requestId, action: 'accept', values }), { status: 400 })
  }
  const values = { name: 'Example', count: 2, enabled: false, tags: ['one'] }
  const response = interactions.respond('thread-a', { requestId: view.requestId, action: 'accept', values })
  assert.deepEqual(sent[0].result, { action: 'accept', content: values, _meta: null })
  interactions.resolved('thread-a', 7); await response
  for (const action of ['accept', 'decline', 'cancel']) {
    const urlView = receive('mcpServer/elicitation/request', { mode: 'url', url: 'https://example.com/login', message: 'Sign in' }, action)
    const pending = interactions.respond('thread-a', { requestId: urlView.requestId, action })
    assert.deepEqual(sent.at(-1).result, { action, content: null, _meta: null })
    interactions.resolved('thread-a', action); await pending
  }
})

test('unknown schema rules and unsafe URLs cannot be accepted', async () => {
  const { interactions, sent, receive } = setup()
  const view = receive('mcpServer/elicitation/request', { mode: 'form', requestedSchema: { type: 'object', properties: { name: { type: 'string', pattern: '^safe$' } } } })
  assert.equal(view.unsupported, true)
  await assert.rejects(interactions.respond('thread-a', { requestId: view.requestId, action: 'accept', values: { name: 'other' } }), { status: 400 })
  interactions.clear()
  const url = receive('mcpServer/elicitation/request', { mode: 'url', url: 'javascript:alert(1)' })
  assert.equal(url.url, null)
  await assert.rejects(interactions.respond('thread-a', { requestId: url.requestId, action: 'accept' }), { status: 400 })
  assert.equal(sent.length, 0)
  interactions.clear()
  const malformed = receive('mcpServer/elicitation/request', { mode: 'form', requestedSchema: { type: 'object', required: {}, properties: {} } })
  assert.equal(malformed.unsupported, true)
  interactions.clear()
  assert.equal(receive('item/tool/requestUserInput', { questions: [null] }).unsupported, true)
})

test('rejects cross-thread, unavailable, duplicate and concurrent decisions; clears on disconnect', async () => {
  const { interactions, sent, receive } = setup()
  const view = receive('item/commandExecution/requestApproval', { availableDecisions: ['accept', 'decline'] })
  await assert.rejects(interactions.respond('thread-b', { requestId: view.requestId, action: 'accept' }), { status: 409 })
  await assert.rejects(interactions.respond('thread-a', { requestId: view.requestId, action: 'acceptForSession' }), { status: 400 })
  const response = interactions.respond('thread-a', { requestId: view.requestId, action: 'accept' })
  await assert.rejects(interactions.respond('thread-a', { requestId: view.requestId, action: 'decline' }), { status: 409 })
  interactions.clear(null, 'Disconnected', 503)
  await assert.rejects(response, { status: 503 })
  assert.equal(sent.length, 1)
  const current = receive('item/commandExecution/requestApproval')
  assert.notEqual(current.requestId, view.requestId)
})

test('a failed send allows retry; unconfirmed delivery stays pending and cannot be sent twice', async () => {
  const { interactions, receive } = setup({ send: async () => { throw new Error('offline') } })
  const view = receive('item/fileChange/requestApproval')
  await assert.rejects(interactions.respond('thread-a', { requestId: view.requestId, action: 'decline' }), { status: 502 })
  assert.equal(interactions.view('thread-a').canRespond, true)
  interactions.send = async () => {}
  interactions.confirmationMs = 10
  await Promise.all([
    assert.rejects(interactions.respond('thread-a', { requestId: view.requestId, action: 'decline' }), { status: 504 }),
    new Promise(resolve => setTimeout(resolve, 20)),
  ])
  assert.equal(interactions.view('thread-a').canRespond, false)
  await assert.rejects(interactions.respond('thread-a', { requestId: view.requestId, action: 'accept' }), { status: 409 })
  interactions.resolved('thread-a', 7)
  assert.equal(interactions.view('thread-a'), null)
})
