// test/build/lazyTestRunner.test.ts
//
// Phase 10 §4.1 — end-to-end check that the production cli.js bundle:
//   1. does NOT statically embed any of the testing helpers
//      (mockProvider, harness, runner, assertions);
//   2. successfully lazy-loads dist/test-runner.js when
//      `nuka --test-plan test-plans/01-offline-boot.yaml` is invoked.
//
// This complements bundle-size.test.ts: the size guard catches "regression
// on the bundle" cases, but it would NOT catch a slip where someone moves
// testing logic into a different file that still ships in cli.js. The grep
// here makes that slip visible.

import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const CLI_JS = join(ROOT, 'dist', 'cli.js')

describe('production bundle: lazy-loads test-runner', () => {
  beforeAll(() => {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' })
    if (r.status !== 0) {
      throw new Error(`npm run build failed: ${r.stderr || r.stdout}`)
    }
  }, 60_000)

  it('dist/cli.js omits testing-only module content', () => {
    expect(statSync(CLI_JS).size).toBeGreaterThan(0)
    const text = readFileSync(CLI_JS, 'utf8')
    // Module-banner sentinels we expect to be ABSENT from the prod bundle.
    expect(text).not.toContain('src/core/testing/mockProvider')
    expect(text).not.toContain('src/core/testing/runner')
    expect(text).not.toContain('src/core/testing/assertions')
    expect(text).not.toContain('src/tui/testing/harness')
    // Check a function name unique to the testing surface.
    expect(text).not.toContain('class MockProvider')
  })

  it('nuka --test-plan test-plans/01-offline-boot.yaml exits 0', () => {
    const r = spawnSync('node', [CLI_JS, '--test-plan', 'test-plans/01-offline-boot.yaml'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15_000,
    })
    if (r.status !== 0) {
      // Surface stderr for easier diagnosis.
      throw new Error(`nuka --test-plan exited ${r.status}\nSTDERR:\n${r.stderr}\nSTDOUT:\n${r.stdout}`)
    }
    expect(r.status).toBe(0)
  }, 30_000)
})
