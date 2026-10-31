import { useQuery } from '@tanstack/react-query'
import type { PlanDocument } from '../types/generated/PlanDocument'
import { runtimeInfo } from '../lib/runtime'

async function fetchPlanDocuments(sessionId: string): Promise<PlanDocument[]> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/plans`)
  if (!response.ok) {
    throw new Error(`Failed to fetch plan documents: ${response.status}`)
  }
  return response.json()
}

export function usePlanDocuments(sessionId: string | null, enabled = true, version?: number) {
  return useQuery({
    queryKey: ['plan-documents', sessionId, version ?? 0],
    queryFn: () => {
      if (!sessionId) throw new Error('sessionId is required')
      return fetchPlanDocuments(sessionId)
    },
    enabled: !!sessionId && enabled,
    refetchInterval: runtimeInfo.mode === 'codex' && sessionId && enabled ? 3000 : false,
  })
}
