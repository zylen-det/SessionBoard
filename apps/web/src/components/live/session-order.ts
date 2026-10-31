import type { LiveSession } from './use-live-sessions'

/** Activity events must never change a session's place in the prompt timeline. */
export function lastPromptTime(session: LiveSession): number {
  return session.lastUserMessageAt ?? session.startedAt ?? 0
}
