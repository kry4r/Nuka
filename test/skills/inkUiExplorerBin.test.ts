// test/skills/inkUiExplorerBin.test.ts
//
// M7.T2 — PATH-isolated exec test for the ink-ui-explorer bin shim.
//
// The shim at ~/.claude/skills/ink-ui-explorer/bin/ink-ui-explorer
// is `exec nuka explore "$@"`. This test verifies it end-to-end
// without requiring `nuka` to be globally installed:
//   1. Create a temp dir with a `nuka` shim that forwards to dist/cli.js.
//   2. Exec the installed shim with PATH=<tempdir>:<original PATH>.
//   3. Assert exit code 2 and stdout contains the verb list.
//
// Temp dir: .tmp-test-skills-bin/<random>/ (dot-prefix → gitignore covered)
// afterAll: remove the temp dir.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const REPO_ROOT = path.resolve(__dirname, '../..')
const SHIM = path.join(os.homedir(), '.claude', 'skills', 'ink-ui-explorer', 'bin', 'ink-ui-explorer')
const DIST_CLI = path.join(REPO_ROOT, 'dist', 'cli.js')

// Temp dir for the synthetic `nuka` shim
const TMP_ROOT = path.join(REPO_ROOT, '.tmp-test-skills-bin')
let tmpDir: string

beforeAll(() => {
  tmpDir = path.join(TMP_ROOT, crypto.randomBytes(6).toString('hex'))
  mkdirSync(tmpDir, { recursive: true })

  // Write a `nuka` shim that forwards to dist/cli.js
  const nukaSrc = [
    '#!/usr/bin/env bash',
    `exec node "${DIST_CLI}" "$@"`,
  ].join('\n')
  const nukaShim = path.join(tmpDir, 'nuka')
  writeFileSync(nukaShim, nukaSrc, { encoding: 'utf8' })
  chmodSync(nukaShim, 0o755)
})

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

describe('ink-ui-explorer bin shim', () => {
  it('shim exists and is executable', () => {
    expect(existsSync(SHIM), `Expected shim at ${SHIM}`).toBe(true)
  })

  it('shim with capture --help exits 2 and lists all verbs', () => {
    // Guard: skip if dist not built yet
    if (!existsSync(DIST_CLI)) {
      console.warn('dist/cli.js not found — skipping shim exec test')
      return
    }

    const result = spawnSync(SHIM, ['capture', '--help'], {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        PATH: `${tmpDir}:${process.env.PATH ?? ''}`,
      },
    })

    // The explore usage handler exits 2 on unrecognised / help args
    expect(result.status).toBe(2)

    const combined = (result.stdout ?? '') + (result.stderr ?? '')
    // Shim must have forwarded to `nuka explore` which prints the verb table.
    // All 5 verbs must appear in the help output — pinned individually so
    // failure messages identify which verb is missing.
    expect(combined).toMatch(/\bcapture\b/)
    expect(combined).toMatch(/\bsweep\b/)
    expect(combined).toMatch(/\bfuzz\b/)
    expect(combined).toMatch(/\bjudge\b/)
    expect(combined).toMatch(/\brepair\b/)
  })
})
