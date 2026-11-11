import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// `base: './'` keeps every asset URL relative, so the build works under any
// GitHub Pages path (username.github.io/<repo>/) without knowing the repo name.
// Routing is hash-based, so relative asset paths are always resolved from index.html.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The Monte Carlo tests run thousands of races: quick, but not on a busy machine.
    testTimeout: 30_000,
  },
})
