import { useInteractionResponder } from '@claude-view/shared'
import { SessionInteractionCard } from '@claude-view/shared/components/conversation/blocks/shared/SessionInteractionCard'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  AlertTriangle,
  Archive,
  Bell,
  CheckCircle,
  CirclePause,
  Clock,
  FileCheck,
  FolderOpen,
  GitBranch,
  Loader,
  MessageCircle,
  Power,
  Shield,
  Sparkles,
  Target,
  Terminal,
  TreePine,
} from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useFullInteraction } from '../../hooks/use-full-interaction'
import { buildSessionUrl } from '../../lib/url-utils'
import { cleanPreviewText } from '../../utils/get-session-title'
import { TaskProgressList } from './TaskProgressList'
import { RuntimeActivity } from './RuntimeActivity'
import { getEffectiveBranch } from './effective-branch'
import { sortSubAgentsForCard } from './sort-sub-agents'
import type { AgentState } from './types'
import { boardStatus, GROUP_DEFAULTS, KNOWN_STATES } from './types'
import { lastPromptTime } from './session-order'
import { SessionContextRing } from './SessionContextRing'
import { CodexQuestionCard } from './CodexQuestionCard'
import { CodexRequestCard } from './CodexRequestCard'
import { type LiveSession } from './use-live-sessions'

// ─── StateBadge (exported — used by Harness, ListView, TerminalOverlay) ──

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  MessageCircle,
  FileCheck,
  Shield,
  AlertTriangle,
  Clock,
  Sparkles,
  Terminal,
  GitBranch,
  CheckCircle,
  Power,
  Bell,
  Loader,
  Archive,
  CirclePause,
}

const COLOR_MAP: Record<string, string> = {
  green: 'text-green-700 dark:text-green-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red: 'text-red-700 dark:text-red-400',
  gray: 'text-zinc-600 dark:text-zinc-400',
}

function StateBadge({ agentState }: { agentState: AgentState }) {
  const known = KNOWN_STATES[agentState.state]
  const defaults = GROUP_DEFAULTS[agentState.group]
  const config = known ?? defaults

  const Icon = ICON_MAP[config.icon] ?? Bell
  const colorClass = COLOR_MAP[config.color] ?? COLOR_MAP.gray

  return (
    <span
      className={`inline-flex items-center gap-1 py-0.5 text-xs font-medium ${colorClass}`}
    >
      <Icon className="h-3 w-3" />
      {agentState.label}
    </span>
  )
}

export { StateBadge }

// ─── Helpers ──────────────────────────────────────────────────────────

function formatDurationMs(ms: number): string {
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return remMins > 0 ? `${hours}h${remMins}m` : `${hours}h`
}

const TOOLTIP_CLS =
  'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-lg z-50 max-w-sm text-xs'
const ARROW_CLS = 'fill-gray-200 dark:fill-gray-700'

// ─── Shared detail-zone text classes ──────────────────────────────────
// 3 levels only: label (muted), content (readable), accent (colored)
const TXT = {
  label: 'text-gray-500 dark:text-gray-400', // labels, separators, overflow counts
  content: 'text-gray-700 dark:text-gray-300', // values — file names, tool names, member names
  accent: 'text-amber-600 dark:text-amber-400', // team name accent (Anthropic brand)
} as const
const SEP = <span className={`${TXT.label} mx-0.5`}>·</span>

function DetailLabel({ children }: { children: React.ReactNode }) {
  return <span className={`${TXT.label} shrink-0 select-none`}>{children}</span>
}

// ─── Detail-zone renderers (plain text, no colored pills) ─────────────

const FILE_KIND_ICON: Record<string, React.ReactNode> = {
  mention: <span className="text-emerald-500 dark:text-emerald-400 font-semibold">@</span>,
  ide: <span className="text-sky-500 dark:text-sky-400">↗</span>,
  pasted: <span className="text-violet-500 dark:text-violet-400">⎘</span>,
}

/**
 * The session's pinned `/goal` — the Stop-hook condition the session is driving toward.
 * Rendered as a single accented banner (distinct from the muted `✦` AI title) with the
 * full goal text available on hover. Shown only when a goal is set; otherwise nothing.
 */
function GoalLine({ goal }: { goal: string }) {
  const oneLine = cleanPreviewText(goal)
  if (!oneLine) return null
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className="flex items-start gap-1.5 mb-1.5 rounded-md border border-indigo-200/80 dark:border-indigo-800/50 bg-indigo-50/60 dark:bg-indigo-950/30 px-2 py-1 cursor-default min-w-0">
          <Target
            className="w-3.5 h-3.5 mt-px shrink-0 text-indigo-500 dark:text-indigo-400"
            aria-hidden="true"
          />
          <span className="text-xs font-medium leading-snug text-indigo-700 dark:text-indigo-300 line-clamp-2 min-w-0">
            {oneLine}
          </span>
        </div>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={TOOLTIP_CLS} sideOffset={5}>
          <div className="flex items-start gap-1.5">
            <Target
              className="w-3.5 h-3.5 mt-px shrink-0 text-indigo-500 dark:text-indigo-400"
              aria-hidden="true"
            />
            <span className="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
              {goal}
            </span>
          </div>
          <Tooltip.Arrow className={ARROW_CLS} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function FilesLine({ files }: { files: NonNullable<LiveSession['userFiles']> }) {
  if (files.length === 0) return null
  const visible = files.slice(0, 4)
  const overflow = files.length - 4

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className="flex items-center gap-1.5 text-xs cursor-default min-w-0">
          <DetailLabel>Files</DetailLabel>
          <span className={`flex items-center gap-1 ${TXT.content} font-mono flex-wrap min-w-0`}>
            {visible.map((f, i) => (
              <span key={f.path} className="inline-flex items-center gap-0.5 shrink-0">
                {i > 0 && SEP}
                {FILE_KIND_ICON[f.kind] ?? FILE_KIND_ICON.mention}
                {f.displayName}
              </span>
            ))}
            {overflow > 0 && <span className={`${TXT.label} shrink-0 ml-0.5`}>+{overflow}</span>}
          </span>
        </div>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={TOOLTIP_CLS} sideOffset={5}>
          <div className="space-y-0.5">
            {files.map((f) => (
              <div key={f.path} className="flex items-center gap-1.5">
                <span className="shrink-0">{FILE_KIND_ICON[f.kind]}</span>
                <span className="font-mono text-gray-900 dark:text-gray-100 break-all">
                  {f.path}
                </span>
              </div>
            ))}
          </div>
          <Tooltip.Arrow className={ARROW_CLS} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function cleanToolName(name: string, kind: string): string {
  if (kind !== 'mcp') return name
  let cleaned = name.startsWith('plugin_') ? name.slice(7) : name
  const parts = cleaned.split('_')
  if (parts.length === 2 && parts[0] === parts[1]) cleaned = parts[0]
  return cleaned
}

function ToolsLine({ tools }: { tools: { name: string; kind: string }[] }) {
  if (tools.length === 0) return null
  const visible = tools.slice(0, 4)
  const overflow = tools.length - 4

  return (
    <div className="flex items-center gap-1.5 text-xs min-w-0">
      <DetailLabel>Tools</DetailLabel>
      <span className={`flex items-center gap-1 ${TXT.content} flex-wrap min-w-0`}>
        {visible.map((t, i) => (
          <span key={`${t.kind}-${t.name}`} className="inline-flex items-center gap-0.5 shrink-0">
            {i > 0 && SEP}
            <span className={TXT.label}>{t.kind === 'mcp' ? '⊞' : '⚡'}</span>
            {cleanToolName(t.name, t.kind)}
          </span>
        ))}
        {overflow > 0 && <span className={`${TXT.label} shrink-0 ml-0.5`}>+{overflow}</span>}
      </span>
    </div>
  )
}

const STATUS_DOT: Record<string, string> = {
  running: 'bg-green-500',
  complete: 'bg-gray-400 dark:bg-gray-500',
  error: 'bg-red-500',
}

function AgentsLine({ subAgents }: { subAgents: LiveSession['subAgents'] }) {
  if (!subAgents || subAgents.length === 0) return null
  const visible = sortSubAgentsForCard(subAgents).slice(0, 3)
  const overflow = subAgents.length - 3

  return (
    <div className="text-xs space-y-0.5">
      <DetailLabel>Agents</DetailLabel>
      {visible.map((a) => (
        <div key={a.toolUseId} className="flex items-center gap-1.5 pl-1 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[a.status] ?? STATUS_DOT.complete}`}
          />
          <span className={`font-medium ${TXT.content} shrink-0`}>{a.agentType}</span>
          {a.description && <span className={TXT.label}>{a.description}</span>}
        </div>
      ))}
      {overflow > 0 && <div className={`pl-1 ${TXT.label}`}>+{overflow} more</div>}
    </div>
  )
}

function TeamLine({ session }: { session: LiveSession }) {
  if (!session.teamName) return null
  const members = session.teamMembers ?? []

  return (
    <div className="text-xs space-y-0.5">
      <div className="flex items-center gap-1.5">
        <DetailLabel>Team</DetailLabel>
        <span className={`font-medium ${TXT.accent}`}>{session.teamName}</span>
      </div>
      {members.length > 0 && (
        <div className={`flex items-center gap-1 pl-1 flex-wrap ${TXT.label}`}>
          {members.map((m, i) => (
            <span key={m.agentId} className="inline-flex items-center gap-0.5 shrink-0">
              {i > 0 && SEP}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: m.color }}
              />
              <span className={TXT.content}>{m.name}</span>
              <span className={TXT.label}>{m.model}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function LocationGrouped({ session }: { session: LiveSession }) {
  const { branch, isWorktree } = getEffectiveBranch(
    session.gitBranch,
    session.worktreeBranch ?? null,
    session.isWorktree ?? false,
  )

  return (
    <div className="text-xs">
      <div className={`flex items-center gap-1 ${TXT.content}`}>
        <FolderOpen className="w-3 h-3 shrink-0 text-zinc-500 dark:text-zinc-400" />
        <span className="truncate">{session.projectDisplayName || session.project}</span>
        {branch && (
          <>
            {SEP}
            <GitBranch className={`w-2.5 h-2.5 shrink-0 ${TXT.label}`} />
            <span className={`font-mono ${TXT.label}`}>{branch}</span>
            {isWorktree && (
              <TreePine className="w-2.5 h-2.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MetaFooter({ session }: { session: LiveSession }) {
  const parts: string[] = []
  if (session.statuslineVimMode) parts.push(`VIM:${session.statuslineVimMode}`)
  if (session.statuslineOutputStyle && session.statuslineOutputStyle !== 'default')
    parts.push(session.statuslineOutputStyle)
  if (session.statuslineVersion) parts.push(`v${session.statuslineVersion}`)
  if (session.sessionKind === 'background') parts.push('subagent')
  if (session.statuslineWorktreeName) parts.push(`wt:${session.statuslineWorktreeName}`)
  if (session.statuslineAgentName) parts.push(session.statuslineAgentName)

  if (parts.length === 0) return null

  return (
    <div className={`flex items-center gap-1.5 text-xs ${TXT.label} font-mono select-none`}>
      {parts.map((p, i) => (
        <span key={p}>
          {i > 0 && <span className="mr-1.5">·</span>}
          {p}
        </span>
      ))}
    </div>
  )
}

// ─── SessionCard ──────────────────────────────────────────────────────

interface SessionCardProps {
  session: LiveSession
  stalledSessions?: Set<string>
  currentTime: number
  /** When provided, renders as a div instead of Link. Used by Kanban for side panel. */
  onClickOverride?: () => void
  /** When true, hide project + branch badges (shown in swimlane header instead) */
  hideProjectBranch?: boolean
  /** When true, show StateBadge pill instead of green pulse dot (used by Harness view) */
  showStateBadge?: boolean
}

export function SessionCard({
  session,
  currentTime,
  onClickOverride,
  hideProjectBranch,
}: SessionCardProps) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const respond = useInteractionResponder(session.id, session.ownership)
  const fullInteraction = useFullInteraction(session.id, session.id.startsWith('codex:') ? null : session.pendingInteraction)
  const rawLastMessage = session.lastUserMessage || ''
  const rawTitle = session.title || ''
  const cleanedLastMessage = rawLastMessage ? cleanPreviewText(rawLastMessage) : ''
  const cleanedTitle = rawTitle ? cleanPreviewText(rawTitle) : ''
  const title = cleanedTitle || cleanedLastMessage || session.projectDisplayName || session.project

  const lastMsg = cleanedLastMessage
  const showLastMsg = lastMsg && lastMsg !== title && !lastMsg.startsWith(title)

  const cardClassName = 'task-card group relative block rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 pb-7 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 cursor-pointer transition-colors'
  const preview = (value: string, limit = 50) => {
    const characters = Array.from(value)
    return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : value
  }
  const activityAt = lastPromptTime(session)
  const status = boardStatus(session)
  const statusLabel = status === 'needs_you' ? 'Need you' : status === 'autonomous' ? 'running' : 'idle'
  const statusDot = status === 'needs_you' ? 'bg-amber-500' : status === 'autonomous' ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-500'
  const age = Math.max(0, Math.floor(currentTime - activityAt))
  const ago = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.floor(age / 60)}m ago` : age < 86400 ? `${Math.floor(age / 3600)}h ago` : `${Math.floor(age / 86400)}d ago`
  const running = session.agentState.group === 'autonomous' && session.status !== 'done'
  const runtimeActivity = running ? session.runtimeActivity : null
  const runtimeText = runtimeActivity?.kind === 'tool' ? `tool: ${runtimeActivity.detail}`
    : runtimeActivity?.kind === 'reasoning' ? `reasoning${runtimeActivity.detail ? `: ${runtimeActivity.detail}` : ''}`
      : runtimeActivity?.kind === 'outputting' ? 'outputting'
        : runtimeActivity?.kind === 'unknown' ? 'proccessing' : 'running'
  const activity = session.status !== 'done' && session.currentActivity !== session.agentState.label ? session.currentActivity : ''
  const lastResponse = session.lastAssistantPreview?.trim()

  const files = session.userFiles ?? []
  const tools = session.toolsUsed ?? []
  const hasLocation = !hideProjectBranch
  const hasFiles = files.length > 0
  const hasTools = tools.length > 0
  const hasTeam = Boolean(session.teamName)
  const hasAgents = session.subAgents && session.subAgents.length > 0
  const hasDetails = hasLocation || hasFiles || hasTools || hasTeam || hasAgents
  const hasInteraction = Boolean(session.pendingQuestion || session.pendingInteraction)
  const sessionUrl = buildSessionUrl(session.id, searchParams)

  const cardContent = (
    <Tooltip.Provider delayDuration={200}>
      {/* ── Goal (the session's pinned /goal directive) ── */}
      {session.goal && <GoalLine goal={session.goal} />}

      <div className="absolute bottom-2 right-3 flex items-center gap-2">
        <SessionContextRing session={session} />
        <span role="img" aria-label={statusLabel} title={statusLabel} className={`session-status h-1.5 w-1.5 rounded-full ${statusDot}`} />
      </div>
      <div className="session-card-meta flex items-start justify-between gap-2 mb-1 text-xs text-zinc-500 dark:text-zinc-400">
        <p title={title} className="session-title min-w-0 flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {hasInteraction ? onClickOverride ? (
            <button type="button" onClick={onClickOverride} className="text-left hover:underline">{preview(title)}</button>
          ) : <Link to={sessionUrl} className="hover:underline">{preview(title)}</Link> : preview(title)}
        </p>
        <time dateTime={new Date(activityAt * 1000).toISOString()} title={`Last prompt: ${new Date(activityAt * 1000).toLocaleString()}`} className="shrink-0 tabular-nums">{ago}</time>
      </div>

      {/* ── Last user message ── */}
      {showLastMsg && (
        <p title={lastMsg} className="session-last-prompt text-md text-zinc-900 dark:text-zinc-100 mb-1">
          <span className="mr-1">→</span>
          {preview(lastMsg, 100)}
        </p>
      )}

      {lastResponse && (
        <p className="session-last-response mt-2 mb-3 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2" title={lastResponse}>{lastResponse}</p>
      )}

      {running ? (
        <RuntimeActivity kind={runtimeActivity?.kind ?? 'unknown'} text={runtimeText} title={runtimeActivity && runtimeActivity.kind !== 'unknown' ? runtimeText : 'Waiting for a live activity event from the existing Codex session'} />
      ) : !lastResponse && activity && <p className="mt-2 mb-3 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2" title={activity}>{activity}</p>}

      {/* ── Pending interaction (permission, question, plan, elicitation) ── */}
      {session.id.startsWith('codex:') && !session.pendingInteraction && !session.pendingQuestion && ['awaiting_input', 'awaiting_approval'].includes(session.agentState.state) && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Open the original Codex client to respond to this request.</p>
      )}
      {session.pendingQuestion && (
        <div data-card-interaction><CodexQuestionCard sessionId={session.id} /></div>
      )}
      {session.pendingInteraction && (
        <div data-card-interaction>
          {session.id.startsWith('codex:') ? <CodexRequestCard sessionId={session.id} requestId={session.pendingInteraction.requestId} /> : (
            <SessionInteractionCard
              sessionId={session.id}
              meta={session.pendingInteraction}
              fullInteraction={fullInteraction}
              respond={respond}
            />
          )}
        </div>
      )}

      {/* ── Task progress ── */}
      {session.progressItems && session.progressItems.length > 0 && (
        <TaskProgressList items={session.progressItems} />
      )}

      {/* ── Duration + lines changed ── */}
      {(session.statuslineTotalDurationMs != null ||
        session.statuslineLinesAdded != null ||
        session.statuslineLinesRemoved != null) && (
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 dark:text-gray-500 font-mono tabular-nums">
            {session.statuslineTotalDurationMs != null && (
              <span>{formatDurationMs(Number(session.statuslineTotalDurationMs))}</span>
            )}
            {(session.statuslineLinesAdded != null || session.statuslineLinesRemoved != null) && (
              <span>
                {session.statuslineLinesAdded != null && (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    +{Number(session.statuslineLinesAdded)}
                  </span>
                )}
                {session.statuslineLinesAdded != null &&
                  session.statuslineLinesRemoved != null &&
                  ' / '}
                {session.statuslineLinesRemoved != null && (
                  <span className="text-red-500 dark:text-red-400">
                    -{Number(session.statuslineLinesRemoved)}
                  </span>
                )}
              </span>
            )}
          </div>
        )}

      {/* Tmux xterm rendering is handled by dockview panels (MonitorView, ChatPageV2),
         not session cards. Cards show the same metadata for all ownership tiers. */}

      {/* ── Detail zone — plain text, labeled lines ── */}
      {hasDetails && (
        <div className="border-t border-gray-100 dark:border-gray-800 mt-2.5 pt-2 space-y-1">
          {hasLocation && <LocationGrouped session={session} />}
          {hasFiles && <FilesLine files={files} />}
          {hasTools && <ToolsLine tools={tools} />}
          {hasTeam && <TeamLine session={session} />}
          {hasAgents && <AgentsLine subAgents={session.subAgents} />}
          <MetaFooter session={session} />
        </div>
      )}
    </Tooltip.Provider>
  )

  // Forms need their own buttons and keyboard input. Keep the session opener
  // separate so answering never activates the card's navigation.
  if (hasInteraction) return (
    <article className={cardClassName} aria-label={title} onClick={event => {
      event.stopPropagation()
      if ((event.target as HTMLElement).closest('[data-card-interaction], a, button, input, textarea, select')) return
      if (onClickOverride) onClickOverride()
      else navigate(sessionUrl)
    }}>
      {cardContent}
    </article>
  )

  if (onClickOverride) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClickOverride()
        }}
        className={`w-full text-left ${cardClassName}`}
      >
        {cardContent}
      </button>
    )
  }

  return (
    <Link
      to={buildSessionUrl(session.id, searchParams)}
      className={cardClassName}
      style={{ cursor: 'pointer' }}
    >
      {cardContent}
    </Link>
  )
}
