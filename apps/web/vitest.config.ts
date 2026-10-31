import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    testTimeout: 10_000,
    hookTimeout: 10_000,
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.claude/**', '**/.worktrees/**'],
    server: {
      deps: {
        // Inline LobeHub and Emoji Mart so Vite resolves directory imports
        // and JSON imports that Node's ESM loader rejects.
        inline: [/\/@lobehub\//, /\/@emoji-mart\//],
      },
    },
  },
})
