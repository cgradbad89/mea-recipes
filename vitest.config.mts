import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // Next resolves this marker itself during application builds. Vitest runs
      // in plain Node, so use a repository-owned no-op marker instead of
      // depending on an undeclared machine-local package.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    clearMocks: true,
  },
})
