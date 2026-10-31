import { closedSessions, conversation, defaults, history, liveSessions, now, projects, summarize } from './data'

const meta = { dataScope: { sessions: 'primary_sessions_only', workload: 'primary_plus_subagent_work' }, sessionBreakdown: { primarySessions: 84, sidechainSessions: 16, otherSessions: 0, totalObservedSessions: 100 } }
const heatmap = Array.from({ length: 180 }, (_, i) => ({ date: new Date((now - (179 - i) * 86400) * 1000).toISOString().slice(0, 10), count: (i * 7 + i % 3) % 12 }))
let settings = JSON.parse(localStorage.getItem('demo-settings') || '{"llmModel":"claude-sonnet-4-6","llmTimeoutSecs":120}')
const memory = { name: 'Project conventions', description: 'Architecture and coding conventions for agentHUD', memoryType: 'project', body: '# Project conventions\n\nUse React and TypeScript. Prefer small components, accessible controls, and the existing design tokens.\n\nRun the build before submitting changes.', filename: 'conventions.md', relativePath: 'agentHUD/conventions.md', scope: 'project', projectDir: 'agentHUD', sizeBytes: 256, modifiedAt: now - 3600 }

function filtered(url: URL) {
  const p = url.searchParams
  let rows = history.filter(s => (!p.get('project') || s.project === p.get('project'))
    && (!p.get('q') || `${s.preview} ${s.project} ${s.skillsUsed.join(' ')}`.toLowerCase().includes(p.get('q')!.toLowerCase()))
    && (!p.get('branches') || p.get('branches')!.split(',').includes(s.gitBranch ?? ''))
    && (!p.get('branch') || s.gitBranch === p.get('branch'))
    && (!p.get('models') || p.get('models')!.split(',').includes(s.primaryModel ?? ''))
    && (!p.get('from') || s.modifiedAt >= Number(p.get('from')))
    && (!p.get('to') || s.modifiedAt <= Number(p.get('to')))
    && (!p.get('time_after') || s.modifiedAt >= Number(p.get('time_after')))
    && (!p.get('time_before') || s.modifiedAt <= Number(p.get('time_before')))
    && (!p.get('has_commits') || (s.commitCount > 0) === (p.get('has_commits') === 'true')))
  const sort = p.get('sort') ?? 'recent'
  if (sort.includes('duration')) rows = rows.sort((a, b) => b.durationSeconds - a.durationSeconds)
  if (sort.includes('cost')) rows = rows.sort((a, b) => (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0))
  if (sort.includes('tokens')) rows = rows.sort((a, b) => (b.totalInputTokens ?? 0) - (a.totalInputTokens ?? 0))
  return rows
}

export function mockApi(url: URL, method: string, body?: string): Response {
  const path = decodeURIComponent(url.pathname)
  const json = (data: unknown, status = 200) => Response.json(data, { status })
  if (path === '/api/config') return json({ auth: false, sharing: false, version: '0.46.2 · Demo', telemetry: 'disabled', posthogKey: null, anonymousId: null, features: { systemMonitor: true } })
  if (path === '/api/projects') return json(projects)
  if (path === '/api/health') return json({ status: 'ok', version: '0.46.2-demo' })
  if (path === '/api/live/sessions') return json({ sessions: liveSessions, recentlyClosed: closedSessions, summary: summarize() })
  if (path === '/api/live/recently-closed' && method === 'DELETE') { closedSessions.splice(0); return json({ success: true }) }
  if (path.endsWith('/dismiss') && method === 'DELETE') { const index = closedSessions.findIndex(s => s.id === path.split('/')[4]); if (index >= 0) closedSessions.splice(index, 1); return json({ success: true }) }
  if (path === '/api/active-sessions') return json(liveSessions.map(s => ({ pid: s.pid, sessionId: s.id, cwd: s.projectPath, startedAt: s.startedAt, kind: s.sessionKind, entrypoint: s.entrypoint })))
  if (path === '/api/status') return json({ lastIndexedAt: now, lastIndexDurationMs: 840, sessionsIndexed: 84, projectsIndexed: 4, lastGitSyncAt: now - 15, commitsFound: 38, linksCreated: 26, updatedAt: now })
  if (path === '/api/settings') {
    if (method === 'PUT') { settings = { ...settings, ...JSON.parse(body ?? '{}') }; localStorage.setItem('demo-settings', JSON.stringify(settings)) }
    return json(settings)
  }
  if (path === '/api/oauth/usage' || path === '/api/oauth/usage/refresh') return json({ hasAuth: true, error: null, plan: 'Max', tiers: [
    { id: 'session', kind: 'session', label: '5-hour session', percentage: 38, resetAt: new Date((now + 7200) * 1000).toISOString() },
    { id: 'weekly', kind: 'window', label: 'Weekly', percentage: 62, resetAt: new Date((now + 172800) * 1000).toISOString() },
  ] })
  if (path === '/api/oauth/identity') return json({ authenticated: true, email: 'demo@example.com', subscriptionType: 'max' })
  if (path === '/api/local-llm/status') return json({ available: false, status: 'not_installed', model: null })
  if (path === '/api/facets/pattern-alert') return json({ alert: null })
  if (path === '/api/branches') return json([...new Set(history.map(s => s.gitBranch))])
  if (path.endsWith('/branches')) return json({ branches: [...new Set(history.map(s => s.gitBranch))].map(name => ({ name, branch: name, count: 21, sessionCount: 21 })) })
  if (path === '/api/sessions/activity/rich') {
    const rows = filtered(url)
    return json({ histogram: heatmap.map(d => ({ ...d, totalSeconds: d.count * 600 })), bucket: 'day', projects: projects.map(p => ({ projectPath: p.path, displayName: p.displayName, sessionCount: rows.filter(s => s.project === p.name).length, totalSeconds: 21600, totalCostUsd: 38.4 })), summary: { totalSeconds: rows.reduce((a, s) => a + s.durationSeconds, 0), sessionCount: rows.length, totalToolCalls: rows.length * 47, totalAgentSpawns: 16, totalMcpCalls: 24, uniqueSkills: 6, longestSessionId: history[0].id, longestSessionSeconds: 4800, longestSessionProject: 'agentHUD', longestSessionTitle: history[0].preview }, total: rows.length })
  }
  if (path === '/api/sessions' || /^\/api\/projects\/[^/]+\/sessions$/.test(path)) {
    if (path.startsWith('/api/projects/')) url.searchParams.set('project', path.split('/')[3])
    const rows = filtered(url), offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0)), limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30)))
    return json({ sessions: rows.slice(offset, offset + limit), total: rows.length, hasMore: offset + limit < rows.length, filter: '', sort: url.searchParams.get('sort') ?? 'recent' })
  }
  const match = path.match(/^\/api\/sessions\/([^/]+)(?:\/(.*))?$/)
  if (match) {
    const [, id, suffix] = match
    const s = history.find(s => s.id === id)
    if (!s) return json({ error: 'Demo session not found' }, 404)
    const live = [...liveSessions, ...closedSessions].find(s => s.id === id) ?? liveSessions[history.indexOf(s) % 8]
    if (!suffix) return json({ ...defaults.SessionDetail, ...s, commits: [], tasks: [
      { id: '1', subject: 'Inspect existing implementation', description: 'Read components and data hooks', status: 'completed', blocks: [], blockedBy: [], activeForm: '', owner: null },
      { id: '2', subject: 'Implement changes and verify', description: 'Apply changes following project conventions', status: 'in_progress', blocks: [], blockedBy: [], activeForm: 'Running checks', owner: null },
    ], todos: [], warnings: [] })
    if (suffix === 'messages' || suffix.includes('/messages')) { const blocks = conversation(id); return json({ blocks, total: blocks.length, hasMore: false, offset: 0, sessionId: id }) }
    if (suffix === 'parsed') return json({ messages: conversation(id).filter(b => b.type === 'user' || b.type === 'assistant').map(b => ({ role: b.type, content: b.type === 'user' ? b.text : b.type === 'assistant' ? b.segments.filter(s => s.kind === 'text').map(s => s.kind === 'text' ? s.text : '').join('\n') : '', timestamp: new Date(now * 1000).toISOString() })), metadata: { totalMessages: 5, toolCallCount: 2 } })
    if (suffix === 'rich') return json({ ...defaults.RichSessionData, ...live, firstUserMessage: s.preview })
    if (suffix === 'file-history') return json({ files: [], totalEdits: 0, sessionId: id })
    if (suffix === 'plans' || suffix === 'hook-events') return json([])
    if (suffix === 'interaction') {
      const pending = live.pendingInteraction
      if (!pending) return json(null)
      return json({ type: 'interaction', id: pending.requestId, variant: pending.variant, requestId: pending.requestId, resolved: false,
        data: pending.variant === 'permission'
          ? { type: 'permission_request', requestId: pending.requestId, toolName: 'Bash', toolInput: { command: 'bun run test' }, toolUseID: 'demo-tool-approval', timeoutMs: 0 }
          : { type: 'ask_question', requestId: pending.requestId, questions: [{ question: pending.preview, header: 'Migration strategy', options: [{ label: 'Incremental migration', description: 'Preserve existing records' }, { label: 'Rebuild index', description: 'Regenerate the search index' }], multiSelect: false }] },
      })
    }
    if (suffix === 'archive' || suffix === 'unarchive') return json({ success: true })
  }
  if (path === '/api/stats/dashboard') {
    const rows = filtered(url), from = Number(url.searchParams.get('from') || now - 30 * 86400), to = Number(url.searchParams.get('to') || now)
    return json({ ...defaults.ExtendedDashboardStats, totalSessions: rows.length, totalProjects: new Set(rows.map(s => s.project)).size,
      currentWeek: { sessionCount: rows.length, totalTokens: rows.reduce((a, s) => a + (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0), 0), totalFilesEdited: rows.length * 6, commitCount: rows.reduce((a, s) => a + s.commitCount, 0) },
      periodStart: from, periodEnd: to, dataStartDate: now - 180 * 86400,
      meta: { ...meta, ranges: { currentPeriod: { from, to, source: 'explicit_from_to' }, heatmap: { from, to, source: 'explicit_from_to' } } }, heatmap,
      topSkills: [{ name: 'frontend-design', count: 32 }, { name: 'code-review', count: 24 }, { name: 'systematic-debugging', count: 18 }],
      topCommands: [{ name: '/review', count: 28 }, { name: '/commit', count: 19 }], topMcpTools: [{ name: 'github', count: 38 }, { name: 'context7', count: 22 }], topAgents: [{ name: 'Explore', count: 18 }, { name: 'code-reviewer', count: 12 }],
      topProjects: projects.map(p => ({ name: p.name, displayName: p.displayName, sessionCount: rows.filter(s => s.project === p.name).length })), toolTotals: { read: rows.length * 24, edit: rows.length * 12, bash: rows.length * 8, write: rows.length * 3 }, longestSessions: [],
    })
  }
  if (path === '/api/stats/ai-generation') {
    const rows = filtered(url), input = rows.reduce((a, s) => a + (s.totalInputTokens ?? 0), 0), output = rows.reduce((a, s) => a + (s.totalOutputTokens ?? 0), 0), cost = rows.reduce((a, s) => a + (s.totalCostUsd ?? 0), 0)
    return json({ ...defaults.AIGenerationStatsResponse, meta, linesAdded: rows.reduce((a, s) => a + s.linesAdded, 0), linesRemoved: rows.length * 38, filesCreated: rows.length * 3, totalInputTokens: input, totalOutputTokens: output, cacheReadTokens: input * 3, cacheCreationTokens: Math.floor(input / 8), tokensByModel: ['claude-opus-4-6', 'claude-sonnet-4-6'].map(model => ({ model, inputTokens: rows.filter(s => s.primaryModel === model).reduce((a, s) => a + (s.totalInputTokens ?? 0), 0), outputTokens: rows.filter(s => s.primaryModel === model).reduce((a, s) => a + (s.totalOutputTokens ?? 0), 0) })), tokensByProject: projects.map(p => ({ project: p.name, inputTokens: Math.floor(input / 4), outputTokens: Math.floor(output / 4) })), cost: { ...defaults.AIGenerationStatsResponse.cost, totalCostUsd: cost, computedPricedTotalCostUsd: cost, inputCostUsd: cost * 0.2, outputCostUsd: cost * 0.6, cacheReadCostUsd: cost * 0.08, cacheCreationCostUsd: cost * 0.12, cacheSavingsUsd: cost * 2.8, pricedModelCount: 2, pricedTokenCoverage: 1, totalCostSource: 'computed_priced_tokens_full' } })
  }
  if (path === '/api/providers/usage') return json({ providers: [], days: 30 })
  if (path === '/api/contributions') return json({ ...defaults.ContributionsResponse, meta, overview: { fluency: { sessions: 84, promptsPerSession: 8, trend: 12, insight: { text: 'More focused prompts this month', kind: 'info' } }, output: { linesAdded: 12480, linesRemoved: 3192, filesCount: 156, commitsCount: 38, insight: { text: 'Consistent progress across four projects', kind: 'info' } }, effectiveness: { commitRate: 0.68, reeditRate: 0.12, insight: { text: 'Most changes land with minimal rework', kind: 'info' } } } })
  if (path === '/api/search') {
    const rows = filtered(url).slice(0, Number(url.searchParams.get('limit') ?? 20))
    return json({ query: url.searchParams.get('q'), totalSessions: rows.length, totalMatches: rows.length, elapsedMs: 8, sessions: rows.map(s => { const hit = { role: 'user', turnNumber: 1, snippet: s.preview, timestamp: s.modifiedAt }; return { sessionId: s.id, project: s.project, branch: s.gitBranch, modifiedAt: s.modifiedAt, matchCount: 1, bestScore: 1, topMatch: hit, matches: [hit], engines: ['grep'] } }) })
  }
  if (path === '/api/system') return json({ ...defaults.SystemResponse, health: { ...defaults.SystemResponse.health, sessionsCount: 84, commitsCount: 38, projectsCount: 4, lastSyncAt: now }, storage: { jsonlBytes: 48000000, indexBytes: 8000000, dbBytes: 4200000, cacheBytes: 2000000, totalBytes: 62200000 }, claudeCli: { path: '/demo/bin/claude', version: 'demo', authenticated: false, subscriptionType: null } })
  if (path === '/api/stats/storage') return json({ ...defaults.StorageStats, sessionCount: 84, projectCount: 4, commitCount: 38, jsonlBytes: 48000000, sqliteBytes: 4200000, indexBytes: 8000000, lastIndexAt: now, oldestSessionDate: now - 180 * 86400 })
  if (path === '/api/claude-code-settings') return json({ env: [], permissions: { allow: ['Read', 'Grep', 'Glob'], deny: [], ask: ['Bash', 'Write'] }, userHooks: [], systemHooks: [], systemHookCount: 0, plugins: [], customMarketplaces: [], voiceEnabled: false, skipDangerousPrompt: false, statusLine: null, defaultMode: 'default' })
  if (path === '/api/memory') return json({ totalCount: 1, global: [], projects: [{ projectDir: 'agentHUD', displayName: 'agentHUD', count: 1, memories: [memory] }] })
  if (path === '/api/memory/file') return json(memory)
  if (path === '/api/plugins') return json(defaults.PluginsResponse)
  if (path === '/api/plugins/marketplaces') return json([])
  if (path === '/api/plugins/marketplaces/refresh-status') return json({ status: 'idle', running: false })
  if (path === '/api/plugins/ops') return json([])
  if (path === '/api/teams' || path === '/api/reports' || path === '/api/workflows' || path === '/api/claude-home' || path === '/api/mcp-servers' || path === '/api/coaching/rules') return json([])
  if (path === '/api/workflows/runs') return json({ runs: [], total: 0 })
  if (path === '/api/prompts/stats') return json({ totalPrompts: 672, uniqueProjects: 4, daysCovered: 180, promptsPerDay: 3.7, nightOwlRatio: 0.18, intentBreakdown: { create: 248, fix: 186, review: 142, refactor: 96 }, hourlyDistribution: Array.from({ length: 24 }, (_, i) => i > 8 && i < 20 ? 42 : 8), topProjects: [], peakHour: 15, peakDay: 4 })
  if (path === '/api/prompts/templates') return json([{ pattern: 'Review <file> and check the edge cases', frequency: 24 }, { pattern: 'Implement <feature> following the existing architecture', frequency: 18 }])
  if (path === '/api/prompts') {
    const rows = filtered(url), offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 30)
    return json({ prompts: rows.slice(offset, offset + limit).map((s, i) => ({ id: `prompt-${s.id}`, display: s.preview + '. Follow the existing architecture and verify the result.', snippet: null, project: s.project, projectDisplayName: s.displayName, sessionId: s.id, timestamp: s.modifiedAt, branch: s.gitBranch, model: s.primaryModel, intent: ['create', 'fix', 'review', 'refactor'][i % 4], complexity: 'medium', hasPaste: false, pastePreview: null, templateId: null })), total: rows.length, hasMore: offset + limit < rows.length })
  }
  if (path === '/api/insights') return json(defaults.InsightsResponse)
  if (path === '/api/classify/status') return json({ state: 'idle', classified: 84, total: 84, isRunning: false })
  if (path === '/api/facets/stats') return json({ total: 0, ingested: 0, pending: 0 })
  if (path === '/api/ide/detect') return json({ ides: [], preferred: null })
  if (path === '/api/sidecar/sessions') return json({ sessions: [] })
  if (path === '/api/sidecar/sessions/models') return json({ models: [{ value: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6' }, { value: 'claude-opus-4-6', displayName: 'Opus 4.6' }], updatedAt: now })
  if (path.startsWith('/api/live/closed/') && method === 'DELETE') return json({ success: true })
  // Make unsupported operations explicit; never forward demo actions to a real backend.
  return json({ error: 'This action is not available in the frontend demo.' }, 501)
}
