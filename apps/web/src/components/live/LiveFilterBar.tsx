import * as Popover from '@radix-ui/react-popover'
import { Filter, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LiveSessionFilters } from './live-filter'
import type { KanbanGroupBy } from './types'

interface LiveFilterBarProps {
  filters: LiveSessionFilters
  onStatusChange: (statuses: string[]) => void
  onProjectChange: (projects: string[]) => void
  onBranchChange: (branches: string[]) => void
  onSearchChange: (query: string) => void
  onClear: () => void
  availableProjects: string[]
  availableBranches: string[]
  searchInputRef?: React.RefObject<HTMLInputElement | null>
  groupByValue: KanbanGroupBy
  onGroupByChange: (value: KanbanGroupBy) => void

}

export function LiveFilterBar({ filters, onStatusChange, onProjectChange, onBranchChange, onSearchChange, onClear, availableProjects, availableBranches, searchInputRef, groupByValue, onGroupByChange }: LiveFilterBarProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(filters.search)
  useEffect(() => { setSearch(filters.search) }, [filters.search])
  useEffect(() => {
    const timer = setTimeout(() => { if (search !== filters.search) onSearchChange(search) }, 200)
    return () => clearTimeout(timer)
  }, [search, filters.search, onSearchChange])

  const toggle = (values: string[], value: string, change: (next: string[]) => void) => change(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  const projectOptions = [...new Set([...availableProjects, ...filters.projects])].sort()
  const branchOptions = [...new Set([...availableBranches, ...filters.branches])].sort()
  const inputClass = 'accent-zinc-500 h-3.5 w-3.5 shrink-0 rounded'
  const rowClass = 'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" data-board-filter-trigger aria-label="Filters" className="inline-flex items-center justify-center rounded-md p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <Filter className="h-4 w-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content onOpenAutoFocus={(event) => { if (searchInputRef?.current) { event.preventDefault(); searchInputRef.current.focus() } }} aria-label="Board filters" align="end" sideOffset={8} collisionPadding={12} className="z-50 w-72 max-w-[calc(100vw-24px)] max-h-[min(75dvh,640px)] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 shadow-xl">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Filters</h2>
            <Popover.Close aria-label="Close filters" className="p-1 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-3.5 w-3.5" /></Popover.Close>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <input ref={searchInputRef} aria-label="Search sessions" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sessions…" className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent pl-8 pr-2 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500" />
          </div>
          <fieldset className="pb-2 mb-2 border-b border-zinc-200 dark:border-zinc-800">
            <legend className="px-2 text-xs text-zinc-500 dark:text-zinc-400 mb-1">Status</legend>
            {[['autonomous', 'running'], ['idle', 'idle']].map(([value, label]) => (
              <label key={value} className={rowClass}><input type="checkbox" className={inputClass} checked={filters.statuses.includes(value)} onChange={() => toggle(filters.statuses, value, onStatusChange)} />{label}</label>
            ))}
          </fieldset>
          <fieldset className="pb-2 mb-2 border-b border-zinc-200 dark:border-zinc-800">
            <legend className="px-2 text-xs text-zinc-500 dark:text-zinc-400 mb-1">Project</legend>
            <div className="max-h-40 overflow-y-auto">
              {projectOptions.map((project) => <label key={project} className={rowClass} title={project}><input type="checkbox" className={inputClass} checked={filters.projects.includes(project)} onChange={() => toggle(filters.projects, project, onProjectChange)} /><span className="truncate">{project}</span></label>)}
              {projectOptions.length === 0 && <p className="px-2 py-1 text-xs text-zinc-500">No projects</p>}
            </div>
          </fieldset>
          <fieldset className="pb-2 mb-2 border-b border-zinc-200 dark:border-zinc-800">
            <legend className="px-2 text-xs text-zinc-500 dark:text-zinc-400 mb-1">Branch</legend>
            <div className="max-h-32 overflow-y-auto">
              {branchOptions.map((branch) => <label key={branch} className={rowClass}><input type="checkbox" className={inputClass} checked={filters.branches.includes(branch)} onChange={() => toggle(filters.branches, branch, onBranchChange)} /><span className="truncate">{branch}</span></label>)}
              {branchOptions.length === 0 && <p className="px-2 py-1 text-xs text-zinc-500">No branches</p>}
            </div>
          </fieldset>
          <label className="flex items-center justify-between px-2 py-2 text-sm text-zinc-700 dark:text-zinc-300">
            Group
            <select aria-label="Group" value={groupByValue} onChange={(event) => onGroupByChange(event.target.value as KanbanGroupBy)} className="max-w-44 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs">
              <option value="none">None</option>
              <option value="project-branch">Project + Branch</option>
            </select>
          </label>
          <button type="button" onClick={() => { setSearch(''); onClear() }} className="mt-2 w-full px-2 py-2 text-left text-sm text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md">Clear filters</button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
