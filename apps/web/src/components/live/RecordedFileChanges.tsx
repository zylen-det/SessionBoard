import { ChevronRight, FileDiff } from 'lucide-react'
import { useId, useState } from 'react'
import type { SessionFileChange } from '../../hooks/use-file-history'
import { cn } from '../../lib/utils'

export function RecordedFileChange({ file }: { file: SessionFileChange }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const canExpand = !!file.recordedDiffs?.length
  const filename = file.filePath.split('/').pop() || file.filePath
  const row = (
    <>
      {canExpand && <ChevronRight aria-hidden="true" className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')} />}
      <span className="min-w-0 flex-1 truncate text-left text-xs font-mono text-zinc-700 dark:text-zinc-200" title={file.filePath}>{filename}</span>
      <span className="ml-auto flex shrink-0 gap-2 font-mono text-xs tabular-nums" title={file.statsAvailable === false ? 'Complete line counts unavailable' : 'Recorded line changes across edits'}>
        {file.statsAvailable === false ? <span className="text-zinc-400">—</span> : <>
          <span className="text-green-600 dark:text-green-400">+{file.stats.added}</span>
          <span className="text-red-500 dark:text-red-400">−{file.stats.removed}</span>
        </>}
      </span>
    </>
  )
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      {canExpand ? (
        <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-1.5 p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500">
          {row}
        </button>
      ) : <div className="flex items-center gap-1.5 p-2">{row}</div>}
      {expanded && canExpand && (
        <div id={id} className="max-h-96 overflow-auto border-t border-zinc-200 dark:border-zinc-800" role="region" aria-label={`Changes to ${file.filePath}`}>
          {file.recordedDiffs?.map((diff, index) => (
            <div key={index}>
              <div className="sticky left-0 px-2 py-1 text-[10px] text-zinc-500 bg-zinc-50 dark:bg-zinc-900">Recorded edit {index + 1} · {file.filePath}</div>
              <pre className="w-max min-w-full py-1 text-[11px] leading-5 font-mono">{diff.split('\n').map((line, lineIndex) => (
                <span key={lineIndex} className={cn('block px-2', line.startsWith('+') ? 'bg-green-500/10 text-green-700 dark:text-green-300' : line.startsWith('-') ? 'bg-red-500/10 text-red-700 dark:text-red-300' : line.startsWith('@@') ? 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800' : 'text-zinc-600 dark:text-zinc-400')}>{line || '\u00a0'}</span>
              ))}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function RecordedFileChanges({ files }: { files: SessionFileChange[] }) {
  return (
    <section className="min-w-0 space-y-2" aria-label="File changes">
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <FileDiff className="size-3.5" aria-hidden="true" />
        <span>File changes ({files.length})</span>
      </div>
      <p className="text-[11px] text-zinc-500">Recorded edits · counts include repeated changes. — means counts unavailable.</p>
      {files.map((file) => <RecordedFileChange key={file.fileHash} file={file} />)}
    </section>
  )
}
