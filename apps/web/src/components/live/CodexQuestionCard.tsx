import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useViewportShimmer } from '@claude-view/shared/components/conversation/blocks/shared/useViewportShimmer'
import { runtimeInfo } from '../../lib/runtime'

type PendingQuestion = {
  id: string
  questions: { title: string; options?: string[] | null }[]
  canAnswer: boolean
}

/** Question replies go to the existing Codex thread, without taking it over. */
export function CodexQuestionCard({ sessionId }: { sessionId: string }) {
  const { data, isError } = useQuery({
    queryKey: ['codex-question', sessionId],
    enabled: runtimeInfo.mode === 'codex' && runtimeInfo.questionReplies === true && sessionId.startsWith('codex:'),
    queryFn: async (): Promise<PendingQuestion | null> => {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/question`)
      if (!response.ok) throw new Error('Could not load the pending question')
      return response.json()
    },
    refetchInterval: 1000,
  })
  if (isError) return <p role="alert" className="py-2 text-xs text-red-700 dark:text-red-400">Could not refresh the pending question. Check the connection before answering.</p>
  return data ? <QuestionForm key={data.id} sessionId={sessionId} question={data} /> : null
}

function QuestionForm({ sessionId, question }: { sessionId: string; question: PendingQuestion }) {
  const client = useQueryClient()
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const shimmer = useViewportShimmer<HTMLElement>()
  const complete = question.questions.every((_, i) => answers[i]?.trim())

  return (
    <section ref={shimmer.ref} aria-label="Question from Codex" className={`${shimmer.className} my-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm`}>
      <h3 className="mb-2 font-medium text-zinc-800 dark:text-zinc-200">Codex needs your answer</h3>
      <form onSubmit={async event => {
        event.preventDefault()
        if (!complete || sending || !question.canAnswer) return
        setSending(true)
        setError('')
        try {
          const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/question/answer`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: question.id, answers: question.questions.map((_, i) => answers[i].trim()) }),
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Could not deliver your answer')
          await client.invalidateQueries({ queryKey: ['codex-question', sessionId] })
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not deliver your answer')
        } finally { setSending(false) }
      }} className="space-y-3">
        {question.questions.map((item, i) => (
          <fieldset key={i} disabled={sending || !question.canAnswer} className="space-y-2">
            <legend className="mb-2 font-medium text-zinc-900 dark:text-zinc-100">{item.title}</legend>
            {item.options?.map(option => (
              <button key={option} type="button" aria-pressed={answers[i] === option}
                onClick={() => setAnswers(previous => ({ ...previous, [i]: option }))}
                className={`block w-full rounded-md border px-3 py-2 text-left text-zinc-800 dark:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-50 ${answers[i] === option ? 'border-zinc-500 bg-zinc-200 dark:border-zinc-400 dark:bg-zinc-700' : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-500'}`}>
                {option}
              </button>
            ))}
            <label className="block text-xs text-zinc-600 dark:text-zinc-400">
              Your answer{question.questions.length > 1 ? ` (${i + 1})` : ''}
              <textarea value={answers[i] ?? ''} maxLength={8000} rows={2}
                onChange={event => setAnswers(previous => ({ ...previous, [i]: event.target.value }))}
                placeholder="Choose an option or type your answer"
                className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500" />
            </label>
          </fieldset>
        ))}
        {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        {question.canAnswer ? (
          <button type="submit" disabled={!complete || sending} className="rounded-md bg-zinc-800 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-50">
            {sending ? 'Sending…' : 'Send answer'}
          </button>
        ) : <p className="text-xs text-zinc-600 dark:text-zinc-400">Answer in the original Codex client. Session Board can send replies when this session is connected.</p>}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Your answer is sent as a message to this Codex session.</p>
      </form>
    </section>
  )
}
