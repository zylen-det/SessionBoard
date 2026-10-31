import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./App', async () => {
  const { Outlet } = await import('react-router-dom')
  return {
    default: () => <Outlet />,
  }
})

vi.mock('./components/ConversationView', () => ({
  ConversationView: () => <div>Conversation View</div>,
}))

vi.mock('./components/HistoryView', () => ({
  HistoryView: () => <div>History View</div>,
}))

vi.mock('./components/SearchResults', () => ({
  SearchResults: () => <div>Search Results</div>,
}))

vi.mock('./components/SettingsPage', () => ({
  SettingsPage: () => <div>Settings Page</div>,
}))

vi.mock('./pages/LiveMonitorPage', () => ({
  LiveMonitorPage: () => <div>Live Monitor Page</div>,
}))

async function renderAt(path: string) {
  const { router } = await import('./router')
  const memoryRouter = createMemoryRouter(router.routes, {
    initialEntries: [path],
  })

  render(<RouterProvider router={memoryRouter} />)
  return memoryRouter
}

describe('router', () => {
  it.each(['/analytics', '/activity', '/reports', '/prompts', '/teams', '/workflows', '/claude-home', '/plugins', '/memory', '/monitor', '/chat', '/insights'])(
    'returns retired route %s to the board', async (path) => {
      const memoryRouter = await renderAt(path)
      expect(await screen.findByText('Live Monitor Page')).toBeInTheDocument()
      expect(memoryRouter.state.location.pathname).toBe('/')
    },
  )

  it('retains session detail deep links', async () => {
    const memoryRouter = await renderAt('/sessions/demo-session-001')
    expect(await screen.findByText('Conversation View')).toBeInTheDocument()
    expect(memoryRouter.state.location.pathname).toBe('/sessions/demo-session-001')
  })
})
