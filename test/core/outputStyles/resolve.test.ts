// test/core/outputStyles/resolve.test.ts
//
// Coverage for the output-style resolver + applier. The loader has its
// own dedicated test file (loader.test.ts) so this suite focuses on:
//
//   1. `selectActiveStyleName` — env wins over config, both blank →
//      undefined, whitespace-only values are treated as unset.
//   2. `resolveActiveOutputStyle` — unknown name → null, exact-name
//      match returns the loaded entry.
//   3. `applyOutputStyle` — APPEND vs REPLACE semantics driven by
//      `keepCodingInstructions`, empty body collapses to base.
//   4. End-to-end through `buildSystemPrompt`: unset → unchanged,
//      keep=true → appended, keep=false → replaced.

import { describe, it, expect } from 'vitest'
import {
  OUTPUT_STYLE_ENV_VAR,
  OUTPUT_STYLE_SECTION_HEADER,
  selectActiveStyleName,
  resolveActiveOutputStyle,
  applyOutputStyle,
} from '../../../src/core/outputStyles/resolve'
import type { OutputStyle } from '../../../src/core/outputStyles/types'
import { buildSystemPrompt } from '../../../src/core/agent/systemPrompt'

const mkStyle = (over: Partial<OutputStyle> & Pick<OutputStyle, 'name' | 'prompt'>): OutputStyle => ({
  description: over.description ?? `desc for ${over.name}`,
  source: over.source ?? 'global',
  path: over.path ?? `/tmp/${over.name}.md`,
  ...over,
})

const BASE_INPUT = {
  cwd: '/tmp/proj',
  platform: 'linux',
  shell: '/bin/bash',
  nodeVersion: 'v20.10.0',
  gitBranch: null,
} as const

describe('selectActiveStyleName', () => {
  it('returns undefined when both env and config are unset', () => {
    expect(selectActiveStyleName({})).toBeUndefined()
  })

  it('returns the env var when set', () => {
    const env = { [OUTPUT_STYLE_ENV_VAR]: 'explanatory' }
    expect(selectActiveStyleName(env)).toBe('explanatory')
  })

  it('treats empty / whitespace-only env as unset', () => {
    expect(selectActiveStyleName({ [OUTPUT_STYLE_ENV_VAR]: '' })).toBeUndefined()
    expect(selectActiveStyleName({ [OUTPUT_STYLE_ENV_VAR]: '   ' })).toBeUndefined()
  })

  it('falls back to config.outputStyle when env is unset', () => {
    expect(selectActiveStyleName({}, { outputStyle: 'concise' })).toBe('concise')
  })

  it('env wins over config', () => {
    const env = { [OUTPUT_STYLE_ENV_VAR]: 'env-style' }
    expect(selectActiveStyleName(env, { outputStyle: 'cfg-style' })).toBe('env-style')
  })

  it('trims surrounding whitespace from valid names', () => {
    expect(
      selectActiveStyleName({ [OUTPUT_STYLE_ENV_VAR]: '  explanatory  ' }),
    ).toBe('explanatory')
  })
})

describe('resolveActiveOutputStyle', () => {
  const styles: OutputStyle[] = [
    mkStyle({ name: 'a', prompt: 'aaa' }),
    mkStyle({ name: 'b', prompt: 'bbb' }),
  ]

  it('returns null when name is undefined', () => {
    expect(resolveActiveOutputStyle(styles, undefined)).toBeNull()
  })

  it('returns null when name does not match any loaded style', () => {
    expect(resolveActiveOutputStyle(styles, 'missing')).toBeNull()
  })

  it('returns the matching style', () => {
    const found = resolveActiveOutputStyle(styles, 'b')
    expect(found?.name).toBe('b')
    expect(found?.prompt).toBe('bbb')
  })

  it('is case-sensitive', () => {
    expect(resolveActiveOutputStyle(styles, 'A')).toBeNull()
  })
})

describe('applyOutputStyle', () => {
  it('appends under the section header when keepCodingInstructions is undefined (default)', () => {
    const style = mkStyle({ name: 's', prompt: 'Speak like a pirate.' })
    const out = applyOutputStyle('BASE PROMPT', style)
    expect(out.startsWith('BASE PROMPT')).toBe(true)
    expect(out).toContain(OUTPUT_STYLE_SECTION_HEADER)
    expect(out).toContain('Speak like a pirate.')
  })

  it('appends when keepCodingInstructions is true', () => {
    const style = mkStyle({ name: 's', prompt: 'Body.', keepCodingInstructions: true })
    const out = applyOutputStyle('BASE', style)
    expect(out).toBe(`BASE\n\n${OUTPUT_STYLE_SECTION_HEADER}\n\nBody.`)
  })

  it('replaces entirely when keepCodingInstructions is false', () => {
    const style = mkStyle({ name: 's', prompt: 'Only this.', keepCodingInstructions: false })
    const out = applyOutputStyle('SHOULD BE DROPPED', style)
    expect(out).toBe('Only this.')
    expect(out).not.toContain('SHOULD BE DROPPED')
  })

  it('empty body collapses to base regardless of mode', () => {
    const blank1 = mkStyle({ name: 'blank-keep', prompt: '   \n\n  ', keepCodingInstructions: true })
    const blank2 = mkStyle({ name: 'blank-replace', prompt: '', keepCodingInstructions: false })
    expect(applyOutputStyle('BASE', blank1)).toBe('BASE')
    expect(applyOutputStyle('BASE', blank2)).toBe('BASE')
  })

  it('does not produce doubled blank lines when base ends with whitespace', () => {
    const style = mkStyle({ name: 's', prompt: 'X' })
    const out = applyOutputStyle('BASE\n\n', style)
    expect(out).toBe(`BASE\n\n${OUTPUT_STYLE_SECTION_HEADER}\n\nX`)
  })
})

// ── Integration: buildSystemPrompt × outputStyle ─────────────────────
//
// These are the three "verification" tests called out in the task
// spec — they assert the visible behaviour at the system-prompt
// assembly boundary, where every other call-site reads from.
describe('buildSystemPrompt × outputStyle', () => {
  it('unset → base prompt unchanged (default behaviour preserved)', () => {
    const withoutStyle = buildSystemPrompt({ ...BASE_INPUT })
    const withNull = buildSystemPrompt({ ...BASE_INPUT, outputStyle: null })
    expect(withNull).toBe(withoutStyle)
    expect(withNull).not.toContain(OUTPUT_STYLE_SECTION_HEADER)
  })

  it('set with keepCodingInstructions=true → appended after the base', () => {
    const style = mkStyle({
      name: 'explanatory',
      prompt: 'Explain every decision.',
      keepCodingInstructions: true,
    })
    const base = buildSystemPrompt({ ...BASE_INPUT })
    const merged = buildSystemPrompt({ ...BASE_INPUT, outputStyle: style })
    expect(merged.startsWith(base.replace(/\s+$/, ''))).toBe(true)
    expect(merged).toContain(OUTPUT_STYLE_SECTION_HEADER)
    expect(merged).toContain('Explain every decision.')
    expect(merged).toMatch(/You are Nuka/)
  })

  it('set with keepCodingInstructions=false → replaces base entirely', () => {
    const style = mkStyle({
      name: 'research-only',
      prompt: 'You are a research assistant. Do not edit files.',
      keepCodingInstructions: false,
    })
    const merged = buildSystemPrompt({ ...BASE_INPUT, outputStyle: style })
    expect(merged).toBe('You are a research assistant. Do not edit files.')
    expect(merged).not.toMatch(/You are Nuka/)
    expect(merged).not.toContain('Environment:')
  })
})
