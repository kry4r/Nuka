import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: { reporter: ['text', 'html'] },
    // Scrub API-key env vars so test workers never accidentally make billed
    // Anthropic API calls even if the developer's shell has the key set.
    // The judge path requires an explicit INK_EXPLORER_JUDGE=1 opt-in; the
    // empty ANTHROPIC_API_KEY prevents any fetch from reaching the network.
    env: {
      ANTHROPIC_API_KEY: '',
      INK_EXPLORER_JUDGE: '0',
    },
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
