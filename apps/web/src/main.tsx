import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from './hooks/use-auth'
import { PostHogTelemetryProvider } from './providers/PostHogTelemetryProvider'
import { router } from './router'
import { initializeRuntime } from './lib/runtime'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

async function bootstrap() {
  await initializeRuntime()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <PostHogTelemetryProvider>
            <RouterProvider router={router} />
            <Toaster
              position="bottom-right"
              richColors
              toastOptions={{
                style: { fontFamily: 'var(--font-sans)' },
              }}
            />
          </PostHogTelemetryProvider>
        </QueryClientProvider>
      </AuthProvider>
    </StrictMode>,
  )
}

bootstrap().catch((error: unknown) => {
  const root = document.getElementById('root')!
  root.textContent = error instanceof Error ? error.message : 'Unable to connect to the dashboard data source.'
  root.setAttribute('role', 'alert')
  root.style.cssText = 'padding:32px;color:#e4e4e7;font-family:system-ui'
})
