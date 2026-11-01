import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { appendFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCodexServer } from '../server/index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
const cache = path.join(os.homedir(), '.cache/ms-playwright')
let installed
try {
  for (const name of (await readdir(cache)).filter((name) => name.startsWith('chromium-')).sort().reverse()) {
    const file = path.join(cache, name, 'chrome-linux64/chrome')
    try { await import('node:fs/promises').then((fs) => fs.access(file)); installed = file; break } catch {}
  }
} catch {}
const home = await mkdtemp(path.join(os.tmpdir(), 'agenthud-browser-codex-'))
const log = path.join(home, 'sessions', 'fixture.jsonl')
const stamp = () => new Date().toISOString()
const row = (type, payload) => ({ timestamp: stamp(), type, payload })
const line = (item) => JSON.stringify(item) + '\n'
const message = (id, text) => row('event_msg', { type: 'item_completed', item: { type: 'AgentMessage', id, phase: 'Commentary', content: [{ type: 'text', text }] } })
let server, browser, daemon, daemonSockets
const observers = new Set()
const notify = (method, params = {}) => { for (const socket of observers) socket.send(JSON.stringify({ method, params: { threadId: 'fixture-codex', turnId: 'fixture-turn', ...params } })) }
const errors = [], badApi = []
try {
  await mkdir(path.dirname(log), { recursive: true })
  await writeFile(log, [
    row('session_meta', { id: 'fixture-codex', cwd: '/work/codex-fixture', source: 'cli', timestamp: stamp(), git: { branch: 'test/integration' } }),
    row('turn_context', { model: 'gpt-6.1-sol', cwd: '/work/codex-fixture' }),
    row('event_msg', { type: 'task_started', turn_id: 'fixture-turn' }),
    row('event_msg', { type: 'item_completed', item: { type: 'UserMessage', id: 'fixture-user', content: [{ type: 'text', text: 'Codex integration fixture' }] } }),
    message('fixture-commentary', 'Checking integration fixture.'),
    row('event_msg', { type: 'item_completed', item: { type: 'FileChange', id: 'fixture-edit', status: 'completed', changes: {
      '/work/codex-fixture/src/example.ts': { type: 'update', unified_diff: '@@ -1 +1 @@\n-const value = 1\n+const value = 2\n' },
      '/work/codex-fixture/unavailable.txt': { type: 'update' },
    } } }),
  ].map(line).join(''))
  await mkdir(path.join(home, 'app-server-control'), { recursive: true })
  daemon = createServer()
  daemonSockets = new WebSocketServer({ server: daemon })
  const thread = { id: 'fixture-codex', status: { type: 'active', activeFlags: [] } }
  daemonSockets.on('connection', (socket) => {
    observers.add(socket)
    socket.on('close', () => observers.delete(socket))
    socket.on('message', (buffer) => {
      const { id, method, params } = JSON.parse(buffer)
      if (method === 'initialized') return
      assert(['initialize', 'thread/loaded/list', 'thread/read', 'thread/resume'].includes(method), `Unexpected observer request: ${method}`)
      if (method === 'thread/resume') assert.deepEqual(params, { threadId: 'fixture-codex', excludeTurns: true, initialTurnsPage: { limit: 1, sortDirection: 'desc', itemsView: 'full' } })
      const result = method === 'initialize' ? {} : method === 'thread/loaded/list' ? { data: ['fixture-codex'], nextCursor: null } : { thread, initialTurnsPage: { data: [] } }
      socket.send(JSON.stringify({ id, result }))
    })
  })
  await new Promise(resolve => daemon.listen(path.join(home, 'app-server-control', 'app-server-control.sock'), resolve))
  const app = createCodexServer({ home, dist: path.join(root, 'apps/web/dist'), pollMs: 150 })
  server = app.server
  await app.ready
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || installed, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => { if (response.url().includes('/api/') && response.status() >= 400) badApi.push(new URL(response.url()).pathname) })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Codex logs · Read only', { exact: true })).toBeVisible()
  await expect(page.locator('[data-session-id]')).toHaveCount(1)
  await expect.poll(async () => (await (await fetch(base + '/api/runtime')).json()).statusSource).toBe('app-server-events')
  notify('item/started', { item: { id: 'tool-a', type: 'commandExecution', command: 'bun test' } })
  await expect(page.locator('.session-runtime-activity')).toHaveText('tool: Bash · bun test')
  notify('item/completed', { item: { id: 'tool-a', type: 'commandExecution' } })
  await expect(page.locator('.session-runtime-activity')).toHaveText('running')
  notify('item/started', { item: { id: 'reason-a', type: 'reasoning', summary: [], content: ['PRIVATE REASONING'] } })
  notify('item/reasoning/summaryTextDelta', { itemId: 'reason-a', summaryIndex: 0, delta: 'Checking integration behavior' })
  await expect(page.locator('.session-runtime-activity')).toHaveText('reasoning: Checking integration behavior')
  await expect(page.locator('body')).not.toContainText('PRIVATE REASONING')
  notify('item/completed', { item: { id: 'reason-a', type: 'reasoning' } })
  notify('item/agentMessage/delta', { itemId: 'output-a', delta: 'Some public answer' })
  await expect(page.locator('.session-runtime-activity')).toHaveText('outputting')
  await page.locator('[data-session-id]').click()
  await page.getByRole('tab', { name: 'Overview', exact: true }).click()
  const fileChanges = page.getByRole('region', { name: 'File changes', exact: true })
  const fileRow = fileChanges.getByRole('button', { name: /example.ts/ })
  await expect(fileRow).toHaveAttribute('aria-expanded', 'false')
  await expect(fileRow).toContainText('+1')
  await expect(fileRow).toContainText('−1')
  await expect(fileChanges.getByRole('button', { name: /unavailable.txt/ })).toHaveCount(0)
  await fileRow.click()
  await expect(fileChanges.getByRole('region', { name: 'Changes to /work/codex-fixture/src/example.ts' })).toContainText('-const value = 1')
  await expect(fileChanges).toContainText('+const value = 2')
  await fileRow.click()
  await expect(fileChanges.getByRole('region')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Chat', exact: true }).click()
  await expect(page.getByText('Checking integration fixture.', { exact: true }).last()).toBeVisible()
  await appendFile(log, [
    row('response_item', { type: 'function_call', name: 'update_plan', call_id: 'fixture-plan', arguments: JSON.stringify({ plan: [{ step: 'Verify persisted progress', status: 'completed' }] }) }),
    message('fixture-final', 'New persisted event arrived.'),
    row('event_msg', { type: 'task_complete', last_agent_message: 'New persisted event arrived.' }),
  ].map(line).join(''))
  notify('turn/completed', { turn: { id: 'fixture-turn', status: 'completed' } })
  await expect(page.locator('.session-runtime-activity')).toHaveCount(0)
  await expect(page.getByText('New persisted event arrived.', { exact: true }).last()).toBeVisible({ timeout: 15000 })
  await page.getByRole('tab', { name: 'Tasks', exact: true }).click()
  await expect(page.getByText('Verify persisted progress', { exact: true }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Close detail panel' }).click()
  await expect(page.locator('.session-status')).toBeEmpty()
  await expect(page.locator('.session-status')).toHaveAttribute('aria-label', 'idle')
  const dotPosition = await page.locator('.session-status').evaluate((dot) => {
    const card = dot.closest('.task-card').getBoundingClientRect()
    const bounds = dot.getBoundingClientRect()
    return { right: card.right - bounds.right, bottom: card.bottom - bounds.bottom }
  })
  assert(dotPosition.right >= 8 && dotPosition.right <= 16, 'Status dot must sit at the right edge of the card')
  assert(dotPosition.bottom >= 8 && dotPosition.bottom <= 16, 'Status dot must sit at the bottom edge of the card')
  await expect(page.locator('.task-card time')).toHaveCount(1)
  await expect(page.getByText('Turn completed', { exact: true })).toHaveCount(0)
  await page.goto(base + '/sessions', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Codex integration fixture', { exact: true }).first()).toBeVisible()
  await page.goto(base + '/sessions/codex%3Afixture-codex', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('New persisted event arrived.', { exact: true }).first()).toBeVisible()
  assert.deepEqual(errors, [])
  assert.deepEqual(badApi, [])
  console.log('PASS live tool/reasoning/output text, completed activity cleanup; real HTTP data, native Codex transcript, append updates, recorded plan, completed-turn transition, history and details')

  // A failed live backend must never silently turn into a demo.
  await page.route('**/api/runtime', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('alert')).toContainText('Could not connect to the dashboard data source (503)')
  await expect(page.getByText('Demo · Simulated sessions', { exact: true })).toHaveCount(0)
  console.log('PASS failed live connection does not fall back to mock data')

  if (process.env.CODEX_LIVE_URL) {
    const actual = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' })
    const actualErrors = []
    actual.on('pageerror', (error) => actualErrors.push(error.message))
    const live = process.env.CODEX_LIVE_URL
    const scope = process.env.CODEX_PROJECT || '/home/zhong/Projects/agentHUD'
    await actual.goto(`${live}/?project=${encodeURIComponent(scope)}`, { waitUntil: 'domcontentloaded' })
    await expect(actual.getByText('Codex logs · Read only', { exact: true })).toBeVisible()
    await expect(actual.getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
    await expect(actual.getByRole('heading', { name: 'Task board' })).toHaveCount(0)
    const snapshot = await actual.evaluate(async () => (await fetch('/api/live/sessions')).json())
    assert([...snapshot.sessions, ...snapshot.recentlyClosed].every((item) => item.id.startsWith('codex:')))
    assert(snapshot.sessions.some((item) => item.projectPath === scope))
    await mkdir(path.join(root, 'artifacts'), { recursive: true })
    await actual.screenshot({ path: path.join(root, 'artifacts/codex-board-dark.png') })
    const own = snapshot.sessions.find((item) => item.projectPath === scope)
    await actual.goto(`${live}/sessions/${encodeURIComponent(own.id)}`, { waitUntil: 'domcontentloaded' })
    await expect(actual.getByText('Codex logs · Read only', { exact: true })).toBeVisible()
    await expect(actual.getByRole('button', { name: 'Export options' })).toBeEnabled({ timeout: 15000 })
    await expect.poll(async () => (await actual.getByTestId('message-thread').first().innerText()).length).toBeGreaterThan(30)
    await actual.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await actual.screenshot({ path: path.join(root, 'artifacts/codex-detail-dark.png') })
    assert.deepEqual(actualErrors, [])
    console.log(`PASS local Codex sessions (${snapshot.sessions.length} recent open records, ${snapshot.recentlyClosed.length} finished turns)`)
  }
} finally {
  if (browser) await browser.close()
  if (server) await server.stop()
  if (daemonSockets) { for (const socket of daemonSockets.clients) socket.terminate(); await new Promise(resolve => daemonSockets.close(resolve)) }
  if (daemon) await new Promise(resolve => daemon.close(resolve))
  await rm(home, { recursive: true, force: true })
}
