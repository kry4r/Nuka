// test/skills/installHook.test.ts
//
// M7.T6 — pretest hook contract.
//
// Asserts that package.json has the pretest hook wired to install-skills.mjs.
// Guards against accidental deletion of the pretest field, which would cause
// skill-install to be silently skipped before tests run.

import { afterAll, describe, it, expect } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const REPO_ROOT = path.resolve(__dirname, '../..')
const PKG_PATH = path.join(REPO_ROOT, 'package.json')
const NUKA_BIN_SHIM = path.join(os.homedir(), '.nuka', 'bin', 'ink-ui-explorer')

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as Record<string, unknown>
const scripts = (pkg['scripts'] ?? {}) as Record<string, unknown>
const bin = (pkg['bin'] ?? {}) as Record<string, unknown>

afterAll(() => {
  rmSync(path.join(REPO_ROOT, '.tmp-test-skills-bin'), { recursive: true, force: true })
})

describe('package.json pretest hook', () => {
  it('scripts.pretest exists and is a string', () => {
    expect(typeof scripts['pretest']).toBe('string')
  })

  it('scripts.pretest invokes install-skills.mjs', () => {
    const pretest = scripts['pretest'] as string
    expect(pretest).toContain('install-skills.mjs')
  })

  it('package bin exposes ink-ui-explorer for npm link/global installs', () => {
    expect(bin['ink-ui-explorer']).toBe('skills/ink-ui-explorer/bin/ink-ui-explorer')
  })

  it('install-skills links ink-ui-explorer into ~/.nuka/bin for PATH usage', () => {
    const result = spawnSync(process.execPath, ['scripts/install-skills.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 15000,
    })

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(NUKA_BIN_SHIM), `Expected ${NUKA_BIN_SHIM} to exist`).toBe(true)
  })
})
