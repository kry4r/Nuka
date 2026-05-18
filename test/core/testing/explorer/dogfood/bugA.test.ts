// test/core/testing/explorer/dogfood/bugA.test.ts
//
// M6.T1 — Bug A repair landed. Two assertions:
//   1. The two production patches actually changed the prompt surface
//      (todoWrite description + system prompt block).
//   2. The Bug A regression fixture's assert hooks run clean against the
//      patched source.
//
// See docs/superpowers/runs/2026-05-18-bug-a-repair.md for the
// simulated repair run record.

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { createTodoStore, makeTodoWriteTool } from '../../../../../src/core/tools/todoWrite'
import { buildSystemPrompt } from '../../../../../src/core/agent/systemPrompt'
import bugAFixture from '../../../../ui-auto/fixtures/regression-bug-a.fixtures'

describe('M6.T1 — Bug A repair', () => {
  it('todoWrite description includes "When NOT to use" guidance', () => {
    const store = createTodoStore()
    const tool = makeTodoWriteTool(store)
    expect(tool.description).toContain('When NOT to use')
  })

  it('buildSystemPrompt contains a TodoWrite usage block', () => {
    const prompt = buildSystemPrompt({
      cwd: '/test',
      platform: 'linux',
      shell: 'bash',
      nodeVersion: 'v20.0.0',
      gitBranch: null,
    })
    expect(prompt).toContain('TodoWrite')
  })

  it('Bug A fixture: both assert hooks pass against the patched source', async () => {
    const cases = bugAFixture.cases
    const c1 = cases['tool-description-has-when-not-to-use']
    const c2 = cases['system-prompt-has-todowrite-section']
    expect(c1, 'tool-description case missing').toBeDefined()
    expect(c2, 'system-prompt case missing').toBeDefined()
    // Both assert hooks throw on failure; success = no throw.
    await c1!.assert!({} as never)
    await c2!.assert!({} as never)
  })

  it('seeded dump exists at the expected explorer-dumps path', () => {
    const dumpPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'fixtures',
      'explorer-dumps',
      'regression-bug-a.md',
    )
    // existsSync via fs (avoid extra import; vitest provides process)
    const fs = require('node:fs') as typeof import('node:fs')
    expect(fs.existsSync(dumpPath)).toBe(true)
  })
})
