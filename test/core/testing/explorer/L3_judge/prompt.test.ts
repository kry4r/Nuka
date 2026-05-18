// test/core/testing/explorer/L3_judge/prompt.test.ts
//
// M4.T2 — RED-first tests for the Haiku/Opus prompt builders.
// See locked spec §4.5 prompt requirements.
//
// 2 tests:
//   1. Golden-string assertions on key fragments — component name interpolation,
//      structural-only instruction line, fenced asciiView block, presence of
//      mustContain / expectsHugContent metadata when supplied.
//   2. Byte-size cap: both prompts ≤ 6 KB on a 200×50 stress input.

import { describe, it, expect } from 'vitest'
import {
  buildHaikuPrompt,
  buildOpusPrompt,
} from '../../../../../src/core/testing/explorer/L3_judge/prompt'

const SMALL_GRID = ['+----+', '| hi |', '+----+'].join('\n')

const SMALL_INPUT = {
  componentName: 'PromptInput',
  caseName: 'truncatedSuggestion',
  viewport: { cols: 80, rows: 24 },
  asciiView: SMALL_GRID,
  mustContain: ['hi'],
  expectsHugContent: true,
}

// 200 cols × 50 rows = 10_000 chars + 49 newlines = 10_049 bytes asciiView.
function makeStressInput(): typeof SMALL_INPUT {
  const row = 'x'.repeat(200)
  const grid = new Array(50).fill(row).join('\n')
  return {
    componentName: 'Massive',
    caseName: 'stress',
    viewport: { cols: 200, rows: 50 },
    asciiView: grid,
    mustContain: ['x'],
    expectsHugContent: false,
  }
}

describe('L3_judge/prompt — buildHaikuPrompt', () => {
  it('embeds component + case + viewport, fences asciiView, includes structural-only line', () => {
    const { system, user } = buildHaikuPrompt(SMALL_INPUT)
    expect(typeof system).toBe('string')
    expect(typeof user).toBe('string')
    // Component + case interpolation.
    expect(user).toContain('PromptInput')
    expect(user).toContain('truncatedSuggestion')
    // Viewport interpolation.
    expect(user).toContain('80')
    expect(user).toContain('24')
    // mustContain / expectsHugContent surfaced.
    expect(user).toContain('hi')
    expect(user.toLowerCase()).toContain('hug')
    // asciiView fenced.
    expect(user).toContain('```')
    expect(user).toContain(SMALL_GRID)
    // Structural-only instruction (either system or user; pick system for
    // canonical placement).
    const combined = `${system}\n${user}`.toLowerCase()
    expect(combined).toContain('structural')
    expect(combined).toMatch(/do not consider (color|colour|style)/i)
  })
})

describe('L3_judge/prompt — buildOpusPrompt', () => {
  it('includes invariant taxonomy + fenced asciiView + structural-only line', () => {
    const { system, user } = buildOpusPrompt(SMALL_INPUT)
    // Component name interpolation.
    expect(user).toContain('PromptInput')
    // Fenced view.
    expect(user).toContain('```')
    expect(user).toContain(SMALL_GRID)
    // Invariant / taxonomy terms from spec §4.5.
    const combined = `${system}\n${user}`.toLowerCase()
    expect(combined).toContain('overflow')
    expect(combined).toContain('overlap')
    expect(combined).toContain('border')
    // Structural-only line.
    expect(combined).toContain('structural')
    expect(combined).toMatch(/do not consider (color|colour|style)/i)
  })
})

describe('L3_judge/prompt — byte-size cap (≤ 6 KB at 200×50)', () => {
  it('haiku and opus prompts both ≤ 6144 bytes on 200×50 stress input', () => {
    const stress = makeStressInput()
    const haiku = buildHaikuPrompt(stress)
    const opus = buildOpusPrompt(stress)
    const sizeOf = (p: { system: string; user: string }): number =>
      Buffer.byteLength(p.system, 'utf8') + Buffer.byteLength(p.user, 'utf8')
    // Note: stress asciiView itself is ~10 KB. The cap is satisfied by the
    // builder truncating/abbreviating large asciiViews while preserving the
    // structural cues a judge model needs.
    expect(sizeOf(haiku)).toBeLessThanOrEqual(6 * 1024)
    expect(sizeOf(opus)).toBeLessThanOrEqual(6 * 1024)
  })
})
