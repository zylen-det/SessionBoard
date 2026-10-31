export interface RuntimeInfo {
  mode: 'demo' | 'codex'
  readOnly: boolean
}

// Established before React mounts. Demo installation is explicit and never
// used as a fallback for a failing live backend.
export const runtimeInfo: RuntimeInfo = { mode: 'demo', readOnly: false }

export async function initializeRuntime(): Promise<void> {
  const response = await fetch('/api/runtime', { cache: 'no-store' })
  const contentType = response.headers.get('content-type') ?? ''
  if (response.ok && contentType.includes('application/json')) {
    const data = await response.json()
    if (data.mode !== 'codex' && data.mode !== 'demo') throw new Error('Unknown dashboard data source')
    Object.assign(runtimeInfo, { mode: data.mode, readOnly: data.readOnly === true })
  } else if ((response.ok || response.status === 404) && contentType.includes('text/html')) {
    // A static demo host has no API and returns its index page (or HTML 404).
    Object.assign(runtimeInfo, { mode: 'demo', readOnly: false })
  } else {
    throw new Error(`Could not connect to the dashboard data source (${response.status})`)
  }
  if (runtimeInfo.mode === 'demo') await import('../demo/install')
}
