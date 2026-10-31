import { Navigate, createBrowserRouter, useParams } from 'react-router-dom'
import App from './App'
import { ConversationView } from './components/ConversationView'
import { HistoryView } from './components/HistoryView'
import { SearchResults } from './components/SearchResults'
import { SettingsPage } from './components/SettingsPage'
import { sessionIdFromSlug } from './lib/url-slugs'
import { LiveMonitorPage } from './pages/LiveMonitorPage'

/** Redirect old /project/:projectId/session/:slug to flat /sessions/:sessionId */
function OldSessionRedirect() {
  const { slug } = useParams()
  const sessionId = slug ? sessionIdFromSlug(slug) : ''
  return <Navigate to={`/sessions/${sessionId}`} replace />
}

/** Redirect legacy /session/:projectId/:sessionId to flat /sessions/:sessionId */
function LegacySessionRedirect() {
  const { sessionId } = useParams()
  return <Navigate to={`/sessions/${sessionId}`} replace />
}

/** Redirect old singular /session/:sessionId to new /sessions/:sessionId */
function SingularSessionRedirect() {
  const { sessionId } = useParams()
  return <Navigate to={`/sessions/${sessionId}`} replace />
}

/** Redirect old /project/:projectId to flat /?project=... */
function OldProjectRedirect() {
  const { projectId } = useParams()
  const project = projectId ? decodeURIComponent(projectId) : ''
  return <Navigate to={`/?project=${encodeURIComponent(project)}`} replace />
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <LiveMonitorPage /> },
      { path: 'sessions', element: <HistoryView /> },
      { path: 'sessions/:sessionId', element: <ConversationView /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'system', element: <Navigate to="/settings" replace /> },
      {
        path: 'project/:projectId',
        children: [
          { index: true, element: <OldProjectRedirect /> },
          // Redirect old nested session URLs to flat structure
          { path: 'session/:slug', element: <OldSessionRedirect /> },
        ],
      },
      { path: 'search', element: <SearchResults /> },
      { path: 'mission-control', element: <Navigate to="/" replace /> },
      // Redirects for old URLs
      { path: 'history', element: <Navigate to="/sessions" replace /> },
      // Redirect old singular /session/:id to /sessions/:id
      { path: 'session/:sessionId', element: <SingularSessionRedirect /> },
      // Unknown and retired routes return to the board.
      { path: '*', element: <Navigate to="/" replace /> },
      { path: 'session/:projectId/:sessionId', element: <LegacySessionRedirect /> },
    ],
  },
])
