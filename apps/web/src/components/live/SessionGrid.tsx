import { SessionCard } from './SessionCard'
import { boardStatus, type KanbanGroupBy } from './types'
import type { LiveSession } from './use-live-sessions'

interface SessionGridProps {
  sessions: LiveSession[]
  groupBy: KanbanGroupBy
  selectedId: string | null
  onSelect: (id: string) => void
  currentTime: number
}

export function SessionGrid({ sessions, selectedId, onSelect, currentTime, groupBy }: SessionGridProps) {
  const cards = (rows: LiveSession[]) => (
    <div className="session-grid">
      {rows.map((session) => (
        <div key={session.id} data-session-id={session.id} data-session-status={boardStatus(session)} className={`min-w-0 rounded-xl ${session.id === selectedId ? 'ring-2 ring-zinc-400' : ''}`}>
          <SessionCard session={session} currentTime={currentTime} onClickOverride={() => onSelect(session.id)} hideProjectBranch={groupBy === 'project-branch'} />
        </div>
      ))}
    </div>
  )
  // Input is already sorted by prompt time; insertion order preserves recency
  // for projects, branches, and the cards inside each branch.
  const projects = new Map<string, { name: string; path: string; branches: Map<string | null, LiveSession[]> }>()
  if (groupBy === 'project-branch') {
    for (const session of sessions) {
      const key = session.projectPath || session.project
      if (!projects.has(key)) projects.set(key, { name: session.projectDisplayName || session.project, path: session.projectPath, branches: new Map() })
      const project = projects.get(key)!
      const branch = session.effectiveBranch ?? null
      if (!project.branches.has(branch)) project.branches.set(branch, [])
      project.branches.get(branch)!.push(session)
    }
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-1">
      {sessions.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">No sessions match your filters</p>
      ) : groupBy === 'project-branch' ? (
        <div className="space-y-6">
          {[...projects].map(([key, project]) => (
            <section key={key} data-project-group={key}>
              <h2 title={project.path} className="sticky top-0 z-20 mb-3 h-10 truncate border-b border-zinc-200 dark:border-zinc-800 bg-gray-50 dark:bg-gray-950 py-2 text-base leading-6 font-medium text-zinc-800 dark:text-zinc-200">{project.path ? project.path.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, '~') : project.name}</h2>
              <div className="space-y-4">
                {[...project.branches].map(([branch, rows]) => (
                  <section key={branch ?? '__no_branch__'} data-branch-group={branch ?? ''}>
                    <h3 className="sticky top-10 z-10 mb-2 bg-gray-50 dark:bg-gray-950 py-2 text-xs font-mono text-zinc-500 dark:text-zinc-400 break-all">{branch ?? 'No branch'}</h3>
                    {cards(rows)}
                  </section>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : cards(sessions)}
    </div>
  )
}
