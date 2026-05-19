// test/docs/superpowers.test.ts
//
// M7.T3 — Cross-reference integrity for docs/superpowers/index.md.
//
// Asserts:
//   1. docs/superpowers/index.md exists.
//   2. It references each of the canonical spec/plan/run filenames.
//   3. README.md mentions "ink-ui-explorer" (phase pointer).
//
// Uses plain node:fs + string matching. No markdown parser.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(__dirname, '../..')
const INDEX = path.join(REPO, 'docs', 'superpowers', 'index.md')
const README = path.join(REPO, 'README.md')

const EXPECTED_REFS = [
  '2026-05-02-ink-ui-explorer-design.md',
  '2026-05-18-ink-ui-explorer-bringup-design.md',
  '2026-05-18-ink-ui-explorer-bringup-plan.md',
  '2026-05-18-bug-a-repair.md',
]

describe('docs/superpowers/index.md', () => {
  it('index.md exists', () => {
    expect(existsSync(INDEX), `Expected ${INDEX} to exist`).toBe(true)
  })

  for (const ref of EXPECTED_REFS) {
    it(`index.md references ${ref}`, () => {
      const content = readFileSync(INDEX, 'utf8')
      expect(content).toContain(ref)
    })
  }
})

describe('README.md phase pointer', () => {
  it('README mentions ink-ui-explorer', () => {
    const content = readFileSync(README, 'utf8')
    expect(content).toContain('ink-ui-explorer')
  })
})
