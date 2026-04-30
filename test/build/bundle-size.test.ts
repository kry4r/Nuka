// test/build/bundle-size.test.ts
//
// Phase 10 §4.1 — bundle-size guard.
//
// Runs `npm run build` once and asserts that:
//   1. `dist/cli.js`         ≤ 400 KB (raised from 360 KB to accommodate
//      phase14a swarm additions; plan budget is ≤460 KB total for phase14).
//   2. `dist/test-runner.js` exists  (so `--test-plan` can lazy-load it).
//
// The test-runner bundle has no size cap; it carries all of the testing
// helpers (parser, mock provider, harness, runner, reporter) and is only
// loaded when the user invokes `nuka --test-plan`.

import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const CLI_JS = join(ROOT, 'dist', 'cli.js')
const TEST_RUNNER_JS = join(ROOT, 'dist', 'test-runner.js')

const CLI_CEILING_BYTES = 400 * 1024

describe('build: bundle split + size', () => {
  beforeAll(() => {
    // Run the production build with the npm script so we exercise the same
    // path CI/users do. spawnSync is synchronous which keeps the test simple.
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' })
    if (r.status !== 0) {
      throw new Error(`npm run build failed: ${r.stderr || r.stdout}`)
    }
  }, 60_000)

  it('dist/cli.js stays under the 400 KB ceiling', () => {
    const size = statSync(CLI_JS).size
    expect(size).toBeLessThanOrEqual(CLI_CEILING_BYTES)
  })

  it('dist/test-runner.js exists (lazy-loaded by --test-plan)', () => {
    const size = statSync(TEST_RUNNER_JS).size
    expect(size).toBeGreaterThan(0)
  })
})
