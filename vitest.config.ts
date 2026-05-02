import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: { reporter: ['text', 'html'] },
    // Ink-testing-library harness tests poll real frames with setImmediate
    // flushes; under heavy worker contention the renders fall behind the
    // default 250ms waitFor budget. Capping fork count keeps the
    // App.tsx-mounting harness tests deterministic without losing all
    // parallelism on the fast unit tests.
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 4, minForks: 1 },
    },
  },
})
