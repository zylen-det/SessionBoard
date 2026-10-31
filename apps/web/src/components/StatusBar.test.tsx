import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectSummary } from '../hooks/use-projects'
import { useLiveSessionStore } from '../store/live-session-store'
import { StatusBar } from './StatusBar'

const mockProjects: ProjectSummary[] = [
  {
    name: 'project1',
    displayName: 'Project 1',
    path: '/project1',
    sessionCount: 10,
    activeCount: 0,
    lastActivityAt: Math.floor(Date.now() / 1000),
    isArchived: false,
  },
  {
    name: 'project2',
    displayName: 'Project 2',
    path: '/project2',
    sessionCount: 5,
    activeCount: 0,
    lastActivityAt: Math.floor(Date.now() / 1000),
    isArchived: false,
  },
]

describe('StatusBar', () => {
  beforeEach(() => useLiveSessionStore.setState({ connectionState: 'connected', isInitialized: true, lastUpdateTs: Date.now() }))

  it('shows live connection and session coverage', () => {
    render(<StatusBar projects={mockProjects} />)
    expect(screen.getByText('Live updates')).toBeInTheDocument()
    expect(screen.getByText('2 projects · 15 sessions')).toBeInTheDocument()
    expect(screen.getByText('Demo · Simulated sessions')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
  })

  it('shows reconnection instead of live status after disconnect', () => {
    useLiveSessionStore.setState({ connectionState: 'disconnected' })
    render(<StatusBar projects={mockProjects} />)
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
    expect(screen.queryByText('Live updates')).not.toBeInTheDocument()
  })

  it('shows stale updates when events stop arriving', () => {
    useLiveSessionStore.setState({ lastUpdateTs: Date.now() - 120_000 })
    render(<StatusBar projects={mockProjects} />)
    expect(screen.getByText('Updates delayed')).toBeInTheDocument()
    expect(screen.getByText('Last event 2m ago')).toBeInTheDocument()
  })

  it('has an accessible data freshness status', () => {
    render(<StatusBar projects={mockProjects} />)
    expect(screen.getByRole('contentinfo')).toHaveAttribute('aria-label', 'Data freshness status')
    expect(screen.getByRole('status')).toHaveTextContent('Live updates')
  })
})
