import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CodexStore, toFileHistory, toInfo, toLive } from './codex-store.mjs'
import { CodexRuntime } from './codex-runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_PORT = 4174
export const MAX_PORT = 65535
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
const pageNumber = (value, fallback, max) => Math.min(max, Math.max(0, Number.parseInt(value ?? '', 10) || fallback))

export function parsePort(value, source = 'PORT') {
  const text = String(value).trim()
  const port = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(port) || port > MAX_PORT) throw new Error(`${source} must be an integer between 0 and ${MAX_PORT}.`)
  return port
}

export function parseServerArgs(args, env = process.env) {
  let port = parsePort(env.PORT ?? DEFAULT_PORT)
  let host = env.HOST ?? '127.0.0.1'
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--host') {
      host = args[i + 1] && !args[i + 1].startsWith('-') ? args[++i] : '0.0.0.0'
    } else if (arg.startsWith('--host=') && arg.length > '--host='.length) {
      host = arg.slice('--host='.length)
    } else if (arg === '--port') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--port requires a value between 0 and 65535.')
      port = parsePort(args[++i], '--port')
    } else if (arg.startsWith('--port=') && arg.length > '--port='.length) {
      port = parsePort(arg.slice('--port='.length), '--port')
    } else {
      throw new Error(`Unknown argument: ${arg}. Usage: npm run start -- [--host [address]] [--port <port>]`)
    }
  }
  return { port, host }
}

export function listenWithFallback(server, port, host) {
  return new Promise((resolve, reject) => {
    let candidate = port
    const attempt = () => {
      const onError = (error) => {
        server.off('listening', onListening)
        if (error.code === 'EADDRINUSE' && candidate > 0 && candidate < MAX_PORT) {
          candidate += 1
          attempt()
        } else {
          reject(error)
        }
      }
      const onListening = () => {
        server.off('error', onError)
        resolve(server.address().port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(candidate, host)
    }
    attempt()
  })
}

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
    const address = server.address()?.address
    const hostFor = (ip) => `${ip.includes(':') ? `[${ip}]` : ip}:${port}`
    if (address === '0.0.0.0' || address === '::') {
      for (const network of Object.values(os.networkInterfaces())) {
        for (const iface of network ?? []) allowedHosts.add(hostFor(iface.address))
      }
    } else if (address) allowedHosts.add(hostFor(address))
    if (!allowedHosts.has(req.headers.host) || (req.headers.origin && ![...allowedHosts].some(host => req.headers.origin === `http://${host}`)) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, { error: 'Local same-origin access only' }, 403)
    try {
      const url = new URL(req.url, `http://${req.headers.host}`), pathname = decodeURIComponent(url.pathname)
      const answerRoute = req.method === 'POST' && /^\/api\/sessions\/(codex:[^/]+)\/question\/answer$/.test(pathname)
      const interactRoute = req.method === 'POST' && /^\/api\/sessions\/(codex:[^/]+)\/interact$/.test(pathname)
      if (req.method !== 'GET' && req.method !== 'HEAD' && !answerRoute && !interactRoute) return json(res, { error: 'Only explicit replies to pending Codex requests can be submitted. Other operations are read-only.' }, 405)
      if (pathname === '/api/runtime') return json(res, { mode: 'codex', readOnly: true, questionReplies: true, requestReplies: true, source: 'local-rollouts', statusSource: runtime.connected ? 'app-server-events' : 'recorded-events', searchScope: 'indexed-excerpts' })
      await ready
      if (pathname === '/api/config') return json(res, { auth: false, sharing: false, version: 'Session Board · Codex observer', telemetry: 'disabled', posthogKey: null, anonymousId: null, features: { systemMonitor: false } })
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
        if (answerRoute) await store.refresh()
        const [, id, suffix] = sessionRoute, item = await store.detail(id)
        if (!item) return json(res, { error: 'Codex session not found' }, 404)
        if ((suffix === 'question/answer' && answerRoute) || (suffix === 'interact' && interactRoute)) {
          if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, { error: 'Send the response as application/json.' }, 415)
          const chunks = []
          let bytes = 0
          for await (const chunk of req) {
            bytes += chunk.length
            if (bytes > 32 * 1024) return json(res, { error: 'Response is too large.' }, 413)
            chunks.push(chunk)
          }
          let payload
          try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return json(res, { error: 'Invalid JSON answer.' }, 400) }
          if (interactRoute) {
            if (!runtime.connected) return json(res, { error: 'Codex disconnected. Reconnect to load current requests.' }, 503)
            return json(res, await runtime.interactions.respond(item.rawId, payload))
          }
          return json(res, await runtime.answerQuestion(toLive(item), payload?.requestId, payload?.answers))
        }
        if (suffix === 'question') {
          const live = runtime.decorate(toLive(item))
          return json(res, live.pendingQuestion ? { ...live.pendingQuestion, canAnswer: runtime.canAnswer(live) } : null)
        }
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
        if (suffix === 'file-history') return json(res, toFileHistory(item))
        if (suffix === 'plans') {
          const content = item.planText || item.plan.map((step) => `- [${step.status === 'completed' ? 'x' : ' '}] ${step.title}`).join('\n')
          return json(res, content ? [{ slug: item.rawId, variant: null, filename: 'Recorded Codex plan', content, sizeBytes: Buffer.byteLength(content), modifiedAt: item.lastAt }] : [])
        }
        if (suffix === 'hook-events') return json(res, { hookEvents: [] })
        if (suffix === 'interaction') return json(res, runtime.connected ? runtime.interactions.view(item.rawId) : null)
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
  const { port, host } = parseServerArgs(process.argv.slice(2))
  await readFile(path.join(root, 'apps/web/dist/index.html')).catch(() => { throw new Error('Build the frontend first: bun run build') })
  const { server, ready, store } = createCodexServer()
  await ready
  const actualPort = await listenWithFallback(server, port, host)
  if (port !== 0 && actualPort !== port) console.log(`Port ${port} is in use; using ${actualPort} instead.`)
  console.log(`Codex observer: http://${host.includes(':') ? `[${host}]` : host}:${actualPort} (${store.all().length} primary sessions; read-only)`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.stop().then(() => process.exit(0)))
}
