// test/build/bundle-size.test.ts
//
// Bundle-size guard.
//
// Runs `npm run build` once and asserts that:
//   1. `dist/cli.js`         ≤ CLI_CEILING_BYTES (see history below).
//   2. `dist/test-runner.js` exists  (so `--test-plan` can lazy-load it).
//   3. `dist/tools-extra.js` exists  (so the heavy text-utility tools
//      can lazy-load on first call — Phase P2 #12).
//
// Neither sidecar bundle has a size cap; they carry features that are
// only loaded on demand. The cap is on `dist/cli.js`, the bytes a user
// pays the moment they invoke `nuka`.
//
// ## Ceiling history
//
//   - Phase 10:    320 KB initial ceiling for the prod split.
//   - Phase 14:    420 → 440 KB (TUI overflow/truncation pass).
//   - Phase P2 #12 (2026-05-17): 440 → 720 KB. Phase 14 + Iter LLLL +
//     the `/loop`-driven feature port (commit 8d2a358 — 96 features
//     across slash, tasks, recap, plugin, coordination, hooks, doctor,
//     plan-mode, ...) pushed the bundle to ~780 KB. P2 #12 introduced
//     a third sidecar bundle (`dist/tools-extra.js`) that holds the
//     heavy text-utility tools (whitespace, truncate, jsonFormat,
//     slug, urlExtract, duration, caseConvert, wordWrap, ansiStyle,
//     textStats, codeBlocks, shellQuote, globMatch) plus the input-
//     dependent permission tools (applyDiff, findReplace) plus the
//     LSPQuery factory tool. Those modules are dynamic-imported via
//     URL specifiers esbuild cannot resolve, so the heavy bytes stay
//     out of `dist/cli.js`. Combined with moving the `nuka init`
//     Wizard to a dynamic import, the prod bundle drops from
//     ~780 KB → ~700 KB. The ceiling is set ~20 KB above that
//     measurement to leave room for incremental UI polish without
//     immediately tripping CI.
//
// Further reduction below ~650 KB requires TUI restructuring (App.tsx,
// PromptInput, StatusPanel etc. render at boot, so lazy-loading them
// doesn't help). That's a separate effort.

import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const CLI_JS = join(ROOT, 'dist', 'cli.js')
const TEST_RUNNER_JS = join(ROOT, 'dist', 'test-runner.js')
const TOOLS_EXTRA_JS = join(ROOT, 'dist', 'tools-extra.js')

const CLI_CEILING_BYTES = 720 * 1024

describe('build: bundle split + size', () => {
  beforeAll(() => {
    // Run the production build with the npm script so we exercise the same
    // path CI/users do. spawnSync is synchronous which keeps the test simple.
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' })
    if (r.status !== 0) {
      throw new Error(`npm run build failed: ${r.stderr || r.stdout}`)
    }
  }, 60_000)

  it(`dist/cli.js stays under the ${CLI_CEILING_BYTES / 1024} KB ceiling`, () => {
    const size = statSync(CLI_JS).size
    expect(size).toBeLessThanOrEqual(CLI_CEILING_BYTES)
  })

  it('dist/test-runner.js exists (lazy-loaded by --test-plan)', () => {
    const size = statSync(TEST_RUNNER_JS).size
    expect(size).toBeGreaterThan(0)
  })

  it('dist/tools-extra.js exists (lazy-loaded by heavy text-utility tools)', () => {
    const size = statSync(TOOLS_EXTRA_JS).size
    expect(size).toBeGreaterThan(0)
  })
})
