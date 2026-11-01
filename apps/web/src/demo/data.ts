import type { LiveSession } from '../components/live/use-live-sessions'
import type { ConversationBlock } from '@claude-view/shared/types/blocks'
import type { SessionInfo, ProjectSummary } from '../types/generated'
import defaults from './defaults.json'

export const now = Math.floor(Date.now() / 1000)
const titles = [
  'Build the agent activity dashboard', 'Add OAuth authentication flow',
  'Review database migration strategy', 'Fix streaming response rendering',
  'Implement keyboard shortcuts', 'Optimize dashboard query performance',
  'Write integration tests for the API', 'Update component documentation',
  'Refactor notification service', 'Ship responsive session cards',
  'Add dark mode to settings', 'Investigate cache invalidation',
]
const names = ['agentHUD', 'commerce-api', 'design-system', 'claude-view']

export function demoRuntimeActivity(step: number): NonNullable<LiveSession['runtimeActivity']> {
  const phases = [
    { kind: 'tool', detail: 'Read src/components/Dashboard.tsx' },
    { kind: 'reasoning', detail: 'Checking the implementation and edge cases' },
    { kind: 'outputting', detail: '' },
  ] as const
  return { ...phases[step % phases.length], updatedAt: Date.now(), source: 'app-server' }
}

export const liveSessions: LiveSession[] = titles.slice(0, 8).map((title, i) => {
  const needsYou = i < 3
  const inputTokens = 24000 + i * 4700
  const outputTokens = 8200 + i * 1600
  const cacheReadTokens = 68000 + i * 12000
  const cacheCreationTokens = 4500 + i * 800
  const branch = ['feat/agent-dashboard', 'feat/oauth', 'main', 'fix/streaming'][i % 4]
  return {
    ...(structuredClone(defaults.LiveSession) as LiveSession),
    id: `demo-session-${String(i + 1).padStart(3, '0')}`, title, aiTitle: title,
    status: needsYou ? 'paused' : 'working',
    runtimeActivity: needsYou ? null : demoRuntimeActivity(i - 3),
    startedAt: now - 600 - i * 370, lastUserMessageAt: now - 120 - i * 90, pid: 42100 + i,
    model: i % 3 === 0 ? 'claude-opus-4-6' : 'claude-sonnet-4-6',
    modelDisplayName: i % 3 === 0 ? 'Opus 4.6' : 'Sonnet 4.6',
    contextWindowTokens: inputTokens, statuslineContextWindowSize: 200000,
    statuslineUsedPct: 18 + i * 9, statuslineRemainingPct: 82 - i * 9,
    lastUserMessage: `${title}. Follow the existing architecture and verify the result.`,
    lastAssistantPreview: needsYou ? 'Implementation ready. Please review the proposed changes.' : 'I am checking the implementation and running the targeted tests.',
    currentActivity: needsYou ? ['Waiting for tool approval', 'Ready for your review', 'Choose a migration strategy'][i] : ['Reading src/components/Dashboard.tsx', 'Editing src/hooks/use-shortcuts.ts', 'Running performance benchmarks', 'Running integration tests', 'Writing component documentation'][i - 3],
    agentState: { group: needsYou ? 'needs_you' : 'autonomous', state: needsYou ? ['needs_permission', 'awaiting_approval', 'awaiting_input'][i] : 'working', label: needsYou ? ['Needs approval', 'Ready for review', 'Awaiting input'][i] : 'Working', context: null },
    pendingInteraction: i === 0 ? { variant: 'permission', requestId: 'demo-approval', preview: 'Allow running bun run test?' } : i === 2 ? { variant: 'question', requestId: 'demo-question', preview: 'Use an incremental migration or rebuild the index?' } : null,
    turnCount: 8 + i * 3, lastActivityAt: now - i * 4,
    currentTurnStartedAt: needsYou ? null : now - 30 - i * 12,
    lastTurnTaskSeconds: 84 + i * 12, lastCacheHitAt: now - 20 - i * 12,
    project: names[i % 4], projectDisplayName: names[i % 4],
    projectPath: `/home/demo/Projects/${names[i % 4]}`, filePath: `/demo/sessions/session-${i}.jsonl`,
    gitBranch: branch, effectiveBranch: branch, cacheStatus: 'warm',
    tokens: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, cacheCreation5mTokens: cacheCreationTokens, cacheCreation1hrTokens: 0, totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens },
    cost: { ...defaults.LiveSession.cost, totalUsd: 0.84 + i * 0.37, inputCostUsd: 0.15 + i * 0.05, outputCostUsd: 0.48 + i * 0.24, cacheReadCostUsd: 0.06 + i * 0.03, cacheCreationCostUsd: 0.15 + i * 0.05, cacheSavingsUsd: 1.8 + i * 0.4, pricedTokenCoverage: 1, totalCostSource: 'computed_priced_tokens_full' },
    subAgents: i === 3 || i === 5 ? [
      { toolUseId: `tool-${i}-1`, agentId: `agent-${i}-1`, agentType: 'Explore', description: 'Explore the existing implementation', status: 'complete', startedAt: now - 360, completedAt: now - 200, durationMs: 160000, toolUseCount: 12, costUsd: 0.12 },
      { toolUseId: `tool-${i}-2`, agentId: `agent-${i}-2`, agentType: 'code-reviewer', description: 'Review changes and check edge cases', status: 'running', startedAt: now - 90, toolUseCount: 7, currentActivity: 'Read src/components/Dashboard.tsx', costUsd: 0.08 },
    ] : [],
    entrypoint: i % 2 ? 'claude-vscode' : 'cli', sessionKind: 'interactive', editCount: 4 + i,
  }
})

export const closedSessions: LiveSession[] = titles.slice(8).map((title, i) => ({
  ...structuredClone(liveSessions[i]), id: `demo-closed-${i}`, title, aiTitle: title,
  lastUserMessageAt: now - 150 - i * 300, status: 'done', closedAt: now - 180 - i * 300, lastActivityAt: now - 180 - i * 300,
  pendingInteraction: null, runtimeActivity: null, currentActivity: 'Session ended', lastUserMessage: `${title}. Follow the existing architecture and verify the result.`,
  pid: null, agentState: { group: 'needs_you', state: 'idle', label: 'Completed', context: null },
}))

export const history: SessionInfo[] = Array.from({ length: 84 }, (_, i) => {
  const s = [...liveSessions, ...closedSessions][i % 12]
  return { ...(structuredClone(defaults.SessionInfo) as SessionInfo),
    id: i < 12 ? s.id : `demo-history-${i}`, project: s.project, projectPath: s.projectPath,
    displayName: s.projectDisplayName, filePath: s.filePath, modifiedAt: now - i * 4300,
    firstMessageAt: now - i * 4300 - 1200, sizeBytes: 68000 + i * 1024,
    preview: s.title, summary: s.title, lastMessage: s.lastAssistantPreview ?? '',
    filesTouched: ['src/App.tsx', 'src/components/Dashboard.tsx', 'src/hooks/use-data.ts'],
    filesRead: ['src/App.tsx', 'src/components/Dashboard.tsx'], filesEdited: ['src/hooks/use-data.ts'],
    skillsUsed: i % 2 ? ['code-review'] : ['frontend-design'], toolCounts: { read: 24, edit: 12, bash: 8, write: 3 },
    messageCount: 28 + i % 15, turnCount: s.turnCount, deepIndexed: true, gitBranch: s.gitBranch,
    totalInputTokens: s.tokens.inputTokens, totalOutputTokens: s.tokens.outputTokens,
    totalCacheReadTokens: s.tokens.cacheReadTokens, totalCacheCreationTokens: s.tokens.cacheCreationTokens,
    primaryModel: s.model, userPromptCount: 8, apiCallCount: 16, toolCallCount: 47,
    filesReadCount: 12, filesEditedCount: 6, durationSeconds: 1200 + i * 37,
    commitCount: i % 3, agentSpawnCount: s.subAgents.length, linesAdded: 240 + i * 7, linesRemoved: 38,
    totalCostUsd: s.cost.totalUsd, entrypoint: s.entrypoint, profile: 'default',
  }
})

export const projects: ProjectSummary[] = names.map(name => ({ name, displayName: name,
  path: `/home/demo/Projects/${name}`, sessionCount: history.filter(s => s.project === name).length,
  activeCount: liveSessions.filter(s => s.project === name).length, lastActivityAt: now, isArchived: false,
}))

export function conversation(id: string): ConversationBlock[] {
  const s = history.find(s => s.id === id) ?? history[0]
  return [
    { type: 'user', id: `${id}-u1`, text: s.preview, timestamp: now - 320, status: 'sent' },
    { type: 'assistant', id: `${id}-a1`, streaming: false, timestamp: now - 310, segments: [
      { kind: 'text', text: 'I’ll inspect the existing components, make the changes, and run the relevant checks.' },
      { kind: 'tool', execution: { toolName: 'Read', toolUseId: `${id}-t1`, toolInput: { file_path: 'src/components/Dashboard.tsx' }, status: 'complete', result: { output: 'export function Dashboard() {\n  return <SessionGrid sessions={sessions} />\n}', isError: false, isReplay: false }, category: 'builtin' } },
    ] },
    { type: 'assistant', id: `${id}-a2`, streaming: false, timestamp: now - 200, segments: [
      { kind: 'text', text: 'The implementation follows the existing React and TypeScript patterns.\n\n- Added accessible components and keyboard navigation\n- Connected the data hooks with proper loading states\n- Kept the layout responsive\n\n```tsx\nconst { data: sessions } = useSessions()\nreturn <SessionGrid sessions={sessions ?? []} />\n```' },
      { kind: 'tool', execution: { toolName: 'Bash', toolUseId: `${id}-t2`, toolInput: { command: 'bun run test' }, status: 'complete', result: { output: '✓ 24 tests passed\n✓ TypeScript checks passed', isError: false, isReplay: false }, category: 'builtin' } },
    ] },
    { type: 'user', id: `${id}-u2`, text: 'Looks good. Please check the edge cases and summarize the changes.', timestamp: now - 120, status: 'sent' },
    { type: 'assistant', id: `${id}-a3`, streaming: false, timestamp: now - 100, segments: [{ kind: 'text', text: 'All checks passed. Empty lists, interrupted streams, and narrow screens are handled. The changes are ready for review.\n\nThis conversation is mock data for the standalone frontend demo.' }] },
  ]
}

export function summarize() {
  const sessions = liveSessions
  return { needsYouCount: sessions.filter(s => s.agentState.group === 'needs_you').length,
    autonomousCount: sessions.filter(s => s.agentState.group === 'autonomous').length,
    processCount: sessions.length, totalCostTodayUsd: sessions.reduce((a, s) => a + s.cost.totalUsd, 0),
    totalTokensToday: sessions.reduce((a, s) => a + s.tokens.totalTokens, 0),
    ...Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'].map(k => [k, sessions.reduce((a, s) => a + s.tokens[k as keyof typeof s.tokens], 0)])),
    ...Object.fromEntries(['inputCostUsd', 'outputCostUsd', 'cacheReadCostUsd', 'cacheCreationCostUsd', 'cacheSavingsUsd'].map(k => [k, sessions.reduce((a, s) => a + Number(s.cost[k as keyof typeof s.cost]), 0)])),
  }
}

export { defaults }
