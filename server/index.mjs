import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CodexStore, toInfo, toLive } from './codex-store.mjs'
import { CodexRuntime } from './codex-runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
const pageNumber = (value, fallback, max) => Math.min(max, Math.max(0, Number.parseInt(value ?? '', 10) || fallback))

function filtered(store, url) {
  const p = url.searchParams, q = (p.get('q') ?? '').toLowerCase()
  const multi = (key, value) => !p.get(key) || p.get(key).split(',').includes(value ?? '')
  const low = Number(p.get('time_after') ?? p.get('from') ?? 0), high = Number(p.get('time_before') ?? p.get('to') ?? Infinity)
  let rows = store.all({ archived: p.get('show_archived') === 'true' }).filter((item) =>
    (!p.get('project') || item.cwd === p.get('project')) && (!p.get('branch') || item.branch === p.get('branch')) &&
    multi('branches', item.branch) && multi('models', item.model) && multi('providers', 'codex') && multi('profiles', '') &&
    item.lastAt >= low && Math.floor(item.lastAt) <= high &&
    (!q || `${item.title}\n${item.firstUser}\n${item.lastUser}\n${item.lastAssistant}\n${item.activity}\n${item.cwd}`.toLowerCase().includes(q)) &&
    (!p.has('min_duration') || item.lastAt - item.firstAt >= Number(p.get('min_duration'))) &&
    (!p.has('min_files') || item.filesEdited.size >= Number(p.get('min_files'))) &&
    (!p.has('has_commits') || p.get('has_commits') === 'false') && (!p.has('has_skills') || p.get('has_skills') === 'false'))
  const sort = p.get('sort') ?? 'recent'
  if (sort === 'duration') rows.sort((a, b) => (b.lastAt - b.firstAt) - (a.lastAt - a.firstAt))
  else if (sort === 'prompts') rows.sort((a, b) => b.promptCount - a.promptCount)
  else if (sort === 'files_edited') rows.sort((a, b) => b.filesEdited.size - a.filesEdited.size)
  return rows
}

export function createCodexServer({ home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), dist = path.join(root, 'apps/web/dist'), pollMs = 2000, store = new CodexStore(home), runtime: runtimeOptions = {} } = {}) {
  const streams = new Set()
  let refreshTimer, pushTimer, stopped = false
  const runtime = new CodexRuntime(home, { ...runtimeOptions, onChange: queueSnapshot })
  const snapshot = () => runtime.decorateSnapshot(store.snapshot())
  function pushSnapshot() {
    const payload = `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`
    for (const res of streams) { if (res.writableLength > 1024 * 1024) res.destroy(); else res.write(payload) }
  }
  function queueSnapshot() {
    if (stopped || pushTimer) return
    pushTimer = setTimeout(() => { pushTimer = null; if (!stopped) pushSnapshot() }, 80)
    pushTimer.unref()
  }
  async function refresh() { await store.refresh(); if (!stopped) pushSnapshot() }
  const ready = store.refresh().then(() => runtime.start())
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    const port = server.address()?.port
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
    if (!allowedHosts.has(req.headers.host) || (req.headers.origin && !['http://127.0.0.1:' + port, 'http://localhost:' + port, 'http://[::1]:' + port].includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, { error: 'Local same-origin access only' }, 403)
    try {
      const url = new URL(req.url, `http://${req.headers.host}`), pathname = decodeURIComponent(url.pathname)
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, { error: 'Codex observer is read-only. Continue or approve work in your existing Codex client.' }, 405)
      if (pathname === '/api/runtime') return json(res, { mode: 'codex', readOnly: true, source: 'local-rollouts', statusSource: runtime.connected ? 'app-server-events' : 'recorded-events', searchScope: 'indexed-excerpts' })
      await ready
      if (pathname === '/api/config') return json(res, { auth: false, sharing: false, version: 'Agent HUD · Codex observer', telemetry: 'disabled', posthogKey: null, anonymousId: null, features: { systemMonitor: false } })
      if (pathname === '/api/health') return json(res, { status: 'ok', provider: 'codex', sessions: store.all().length, unreadableFiles: store.errors?.length ?? 0 })
      if (pathname === '/api/projects') return json(res, store.projects())
      if (pathname === '/api/live/sessions') return json(res, snapshot())
      if (pathname === '/api/live/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
        streams.add(res); res.on('close', () => streams.delete(res))
        return
      }
      if (pathname === '/api/indexing/progress') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end(`event: done\ndata: ${JSON.stringify({ indexed: store.all().length, total: store.all().length, bytes_processed: 0, bytes_total: 0 })}\n\n`)
        return
      }
      if (pathname === '/api/sidecar/sessions') return json(res, { active: [], sessions: [] })
      if (pathname === '/api/teams') return json(res, [])
      if (pathname === '/api/facets/pattern-alert') return json(res, { alert: null })
      if (pathname === '/api/facets/badges') return json(res, {})
      if (pathname === '/api/local-llm/status') return json(res, { available: false, status: 'not_configured', model: null })
      if (pathname === '/api/sessions/activity') {
        const rows = filtered(store, url), counts = new Map()
        for (const item of rows) { const date = new Date(item.lastAt * 1000).toISOString().slice(0, 10); counts.set(date, (counts.get(date) ?? 0) + 1) }
        return json(res, { activity: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })), bucket: 'day', total: rows.length })
      }
      if (pathname === '/api/providers') return json(res, { providers: [{ id: 'codex', displayName: 'Codex', count: store.all().length }] })
      if (pathname === '/api/profiles') return json(res, { profiles: [] })
      if (pathname === '/api/branches') return json(res, [...new Set(store.all().map((s) => s.branch).filter(Boolean))])
      const projectRoute = pathname.match(/^\/api\/projects\/(.+)\/(sessions|branches)$/)
      if (projectRoute) {
        url.searchParams.set('project', projectRoute[1])
        if (projectRoute[2] === 'branches') {
          const counts = new Map()
          for (const item of filtered(store, url)) if (item.branch) counts.set(item.branch, (counts.get(item.branch) ?? 0) + 1)
          return json(res, { branches: [...counts].map(([branch, count]) => ({ branch, count })) })
        }
      }
      if (pathname === '/api/sessions' || projectRoute) {
        const rows = filtered(store, url), offset = pageNumber(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER), limit = pageNumber(url.searchParams.get('limit'), 30, 500)
        return json(res, { sessions: rows.slice(offset, offset + limit).map(toInfo), total: rows.length, hasMore: offset + limit < rows.length, filter: '', sort: url.searchParams.get('sort') ?? 'recent' })
      }
      if (pathname === '/api/search') {
        const rows = filtered(store, url), limit = pageNumber(url.searchParams.get('limit'), 20, 100), q = (url.searchParams.get('q') ?? '').toLowerCase()
        return json(res, { query: q, totalSessions: rows.length, totalMatches: rows.length, elapsedMs: 0, scope: 'indexed-excerpts', sessions: rows.slice(0, limit).map((item) => {
          const candidates = [{ role: 'user', text: item.title }, { role: 'user', text: item.firstUser }, { role: 'user', text: item.lastUser }, { role: 'assistant', text: item.lastAssistant }, { role: 'assistant', text: item.activity }]
          const match = candidates.find((c) => c.text.toLowerCase().includes(q)) ?? candidates[0], start = Math.max(0, match.text.toLowerCase().indexOf(q) - 80)
          const hit = { role: match.role, turnNumber: 1, snippet: match.text.slice(start, start + 400), timestamp: item.lastAt }
          return { sessionId: item.id, project: item.cwd ?? '(unknown)', branch: item.branch, modifiedAt: item.lastAt, matchCount: 1, bestScore: 1, topMatch: hit, matches: [hit], engines: ['grep'] }
        }) })
      }
      const sessionRoute = pathname.match(/^\/api\/sessions\/(codex:[^/]+)(?:\/(.*))?$/)
      if (sessionRoute) {
        const [, id, suffix] = sessionRoute, item = await store.detail(id)
        if (!item) return json(res, { error: 'Codex session not found' }, 404)
        const childRoute = suffix?.match(/^subagents\/([^/]+)\/messages$/)
        if (childRoute) {
          const child = await store.detail(`codex:${childRoute[1]}`)
          if (!child || child.parentId !== item.rawId) return json(res, { error: 'Subagent is not part of this session' }, 404)
          const offset = pageNumber(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER), limit = pageNumber(url.searchParams.get('limit'), 80, 5000)
          return json(res, { sessionId: child.id, blocks: child.blocks.slice(offset, offset + limit), total: child.blocks.length, offset, hasMore: offset + limit < child.blocks.length })
        }
        if (!suffix) return json(res, { ...toInfo(item), derivedMetrics: {}, commits: [], hasPlans: Boolean(item.planText || item.plan.length), todos: [], tasks: item.plan.map((step) => ({ id: step.id, subject: step.title, description: step.description ?? '', activeForm: '', status: step.status, blocks: [], blockedBy: [], owner: null })), warnings: ['Status comes from recorded events. A completed turn is not proof that the task is complete.'] })
        if (suffix === 'messages') {
          const offset = pageNumber(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER), limit = pageNumber(url.searchParams.get('limit'), 80, 5000)
          return json(res, { sessionId: id, blocks: item.blocks.slice(offset, offset + limit), total: item.blocks.length, offset, hasMore: offset + limit < item.blocks.length })
        }
        if (suffix === 'rich') return json(res, { ...runtime.decorate(toLive(item)), firstUserMessage: item.firstUser })
        if (suffix === 'file-history') return json(res, { files: [], totalEdits: 0, sessionId: id })
        if (suffix === 'plans') {
          const content = item.planText || item.plan.map((step) => `- [${step.status === 'completed' ? 'x' : ' '}] ${step.title}`).join('\n')
          return json(res, content ? [{ slug: item.rawId, variant: null, filename: 'Recorded Codex plan', content, sizeBytes: Buffer.byteLength(content), modifiedAt: item.lastAt }] : [])
        }
        if (suffix === 'hook-events') return json(res, { hookEvents: [] })
        if (suffix === 'interaction') return json(res, null)
      }
      if (pathname.startsWith('/api/')) return json(res, { error: 'This capability is not available from Codex rollout logs.' }, 404)
      const filename = path.resolve(dist, '.' + pathname)
      if (!filename.startsWith(path.resolve(dist) + path.sep) && filename !== path.resolve(dist)) return json(res, { error: 'Invalid asset path' }, 403)
      let asset = filename
      try { if (!(await stat(asset)).isFile()) asset = path.join(dist, 'index.html') } catch { asset = path.join(dist, 'index.html') }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }
      await stat(asset)
      res.writeHead(200, { 'Content-Type': types[path.extname(asset)] ?? 'application/octet-stream' })
      if (req.method === 'HEAD') return res.end()
      createReadStream(asset).on('error', () => res.destroy()).pipe(res)
    } catch (error) {
      if (!res.headersSent) json(res, { error: error.status ? error.message : 'Could not read local Codex data. Check the server log.' }, error.status ?? 500)
      else res.destroy()
      if (!error.status) console.error('Codex observer:', error.code ?? error.message)
    }
  })
  server.on('listening', () => { refreshTimer = setInterval(() => refresh().catch((error) => { console.error('Codex scan failed:', error.code ?? error.message); for (const res of streams) res.destroy() }), pollMs); refreshTimer.unref() })
  server.on('close', () => { stopped = true; clearTimeout(pushTimer); runtime.stop(); clearInterval(refreshTimer); for (const res of streams) res.destroy() })
  server.stop = () => { stopped = true; clearTimeout(pushTimer); runtime.stop(); clearInterval(refreshTimer); for (const res of streams) res.destroy(); return new Promise((resolve) => server.close(resolve)) }
  return { server, store, runtime, ready }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 4174)
  await readFile(path.join(root, 'apps/web/dist/index.html')).catch(() => { throw new Error('Build the frontend first: bun run build') })
  const { server, ready, store } = createCodexServer()
  await ready
  server.listen(port, '127.0.0.1', () => console.log(`Codex observer: http://127.0.0.1:${server.address().port} (${store.all().length} primary sessions; read-only)`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.stop().then(() => process.exit(0)))
}
