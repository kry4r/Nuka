// test/skills/installHook.test.ts
//
// M7.T6 — pretest hook contract.
//
// Asserts that package.json has the pretest hook wired to install-skills.mjs.
// Guards against accidental deletion of the pretest field, which would cause
// skill-install to be silently skipped before tests run.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '../..')
const PKG_PATH = path.join(REPO_ROOT, 'package.json')

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as Record<string, unknown>
const scripts = (pkg['scripts'] ?? {}) as Record<string, unknown>

describe('package.json pretest hook', () => {
  it('scripts.pretest exists and is a string', () => {
    expect(typeof scripts['pretest']).toBe('string')
  })

  it('scripts.pretest invokes install-skills.mjs', () => {
    const pretest = scripts['pretest'] as string
    expect(pretest).toContain('install-skills.mjs')
  })
})
