import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useViewportShimmer } from '@claude-view/shared/components/conversation/blocks/shared/useViewportShimmer'
import { useState } from 'react'
import { runtimeInfo } from '../../lib/runtime'

type Value = string | number | boolean | string[]
type Field = {
  id: string; label: string; description?: string; type: string; required: boolean; secret?: boolean; allowOther?: boolean
  options?: { value: string; label: string; description?: string }[] | null
  minLength?: number; maxLength?: number; minimum?: number; maximum?: number; format?: string
}
type Request = {
  requestId: string; title: string; preview: string; kind: string; detail: unknown; fields: Field[] | null
  url: string | null; serverName?: string; unsupported: boolean; canRespond: boolean
  actions: { value: string; label: string }[]
}

export function CodexRequestCard({ sessionId, requestId }: { sessionId: string; requestId?: string }) {
  const { data, isError } = useQuery({
    queryKey: ['codex-request', sessionId, requestId],
    enabled: runtimeInfo.mode === 'codex' && runtimeInfo.requestReplies === true && sessionId.startsWith('codex:'),
    queryFn: async (): Promise<Request | null> => {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/interaction`)
      if (!response.ok) throw new Error('Could not load this Codex request')
      return response.json()
    },
    refetchInterval: 1000,
  })
  if (isError) return <p role="alert" className="py-2 text-xs text-red-700 dark:text-red-400">Could not refresh the Codex request. Check the connection.</p>
  return data ? <RequestForm key={data.requestId} sessionId={sessionId} request={data} /> : null
}

function RequestForm({ sessionId, request }: { sessionId: string; request: Request }) {
  const client = useQueryClient()
  const shimmer = useViewportShimmer<HTMLElement>()
  const [values, setValues] = useState<Record<string, Value>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const disabled = sending || !request.canRespond
  const setValue = (id: string, value: Value) => setValues(previous => ({ ...previous, [id]: value }))
  const control = 'mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500'

  async function respond(action: string) {
    if (disabled) return
    setSending(true); setError('')
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/interact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: request.requestId, action, values }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not confirm your response')
      await client.invalidateQueries({ queryKey: ['codex-request', sessionId] })
      await client.invalidateQueries({ queryKey: ['codex-question', sessionId] })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not confirm your response') }
    finally { setSending(false) }
  }

  return (
    <section ref={shimmer.ref} aria-label="Request from Codex" className={`${shimmer.className} my-3 min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm text-zinc-800 dark:text-zinc-200`}>
      <h3 className="font-medium">{request.title}</h3>
      {request.serverName && <p className="mt-1 text-xs text-zinc-500">{request.serverName}</p>}
      <p className="my-2 whitespace-pre-wrap break-words text-xs">{request.preview}</p>
      {request.detail != null && <pre className="my-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white dark:bg-zinc-950 p-2 text-xs">{JSON.stringify(request.detail, null, 2)}</pre>}
      {request.url && <a href={request.url} target="_blank" rel="noopener noreferrer" className="my-2 block break-all underline">Open requested page</a>}
      <form onSubmit={event => { event.preventDefault(); void respond('accept') }}>
        <fieldset disabled={disabled} className="min-w-0 space-y-3">
          {request.fields?.map(field => (
            <label key={field.id} className="block text-xs">
              {field.label}{field.required ? ' *' : ''}
              {field.description && <span className="mt-1 block text-zinc-500 dark:text-zinc-400">{field.description}</span>}
              {field.type === 'boolean' ? (
                <select required={field.required} className={control} value={values[field.id] === undefined ? '' : String(values[field.id])} onChange={event => setValue(field.id, event.target.value === '' ? '' : event.target.value === 'true')}>
                  <option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option>
                </select>
              ) : field.type === 'array' ? (
                <select multiple required={field.required} className={control} value={[values[field.id]].flat().filter((value): value is string => typeof value === 'string')} onChange={event => setValue(field.id, Array.from(event.target.selectedOptions, option => option.value))}>
                  {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : field.options?.length && !field.allowOther ? (
                <select required={field.required} className={control} value={String(values[field.id] ?? '')} onChange={event => setValue(field.id, event.target.value)}>
                  <option value="">Choose…</option>
                  {field.options.map(option => <option key={option.value} value={option.value}>{option.label}{option.description ? ` — ${option.description}` : ''}</option>)}
                </select>
              ) : (
                <>
                  {field.allowOther && field.options?.map(option => <button key={option.value} type="button" className="mt-2 mr-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1" onClick={() => setValue(field.id, option.value)}>{option.label}</button>)}
                  <input className={control} required={field.required} value={String(values[field.id] ?? '')}
                    type={field.secret ? 'password' : ['number', 'integer'].includes(field.type) ? 'number' : field.format === 'email' ? 'email' : field.format === 'date' ? 'date' : 'text'}
                    autoComplete="off" minLength={field.minLength} maxLength={field.maxLength ?? 8000} min={field.minimum} max={field.maximum} step={field.type === 'integer' ? 1 : 'any'}
                    onChange={event => setValue(field.id, ['number', 'integer'].includes(field.type) && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />
                </>
              )}
            </label>
          ))}
          {request.unsupported && <p className="text-xs text-zinc-500 dark:text-zinc-400">Complete this request in the original Codex client. This form is not supported here.</p>}
          <div className="flex flex-wrap gap-2">
            {request.actions.map(action => <button key={action.value} type={action.value === 'accept' ? 'submit' : 'button'}
              disabled={request.unsupported && ['accept', 'acceptForSession'].includes(action.value)}
              onClick={action.value === 'accept' ? undefined : () => { void respond(action.value) }}
              className={`rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50 ${action.value === 'accept' ? 'border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-800'}`}>
              {action.label}
            </button>)}
          </div>
        </fieldset>
        {(sending || !request.canRespond) && <p role="status" className="mt-2 text-xs text-zinc-500">Waiting for Codex confirmation…</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
      </form>
    </section>
  )
}
