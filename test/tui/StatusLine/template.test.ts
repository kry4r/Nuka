// test/tui/StatusLine/template.test.ts
import { describe, it, expect } from 'vitest'
import { template, DEFAULT_FORMAT } from '../../../src/tui/StatusLine/template'
import type { StatusLineCtx } from '../../../src/tui/StatusLine/template'

const ctx: StatusLineCtx = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  ctxPct: 42.5,
  cost: 0.0042,
  plugins: 3,
  tasks: 1,
  branch: 'main',
}

describe('template()', () => {
  it('substitutes {provider}', () => {
    expect(template('{provider}', ctx)).toBe('anthropic')
  })

  it('substitutes {model}', () => {
    expect(template('{model}', ctx)).toBe('claude-sonnet-4-6')
  })

  it('substitutes {ctxPct} with 1 decimal', () => {
    expect(template('{ctxPct}', ctx)).toBe('42.5')
  })

  it('substitutes {cost} with 4 decimals', () => {
    expect(template('{cost}', ctx)).toBe('0.0042')
  })

  it('substitutes {plugins}', () => {
    expect(template('{plugins}', ctx)).toBe('3')
  })

  it('substitutes {tasks}', () => {
    expect(template('{tasks}', ctx)).toBe('1')
  })

  it('substitutes {branch}', () => {
    expect(template('{branch}', ctx)).toBe('main')
  })

  it('substitutes {branch} with — when null', () => {
    expect(template('{branch}', { ...ctx, branch: null })).toBe('—')
  })

  it('replaces multiple tokens in one format string', () => {
    const out = template('{provider}/{model} · ctx {ctxPct}% · ${cost}', ctx)
    expect(out).toBe('anthropic/claude-sonnet-4-6 · ctx 42.5% · $0.0042')
  })

  it('uses default format when fmt is undefined', () => {
    const out = template(undefined, ctx)
    expect(out).toContain('anthropic')
    expect(out).toContain('claude-sonnet-4-6')
  })

  it('DEFAULT_FORMAT is a non-empty string', () => {
    expect(typeof DEFAULT_FORMAT).toBe('string')
    expect(DEFAULT_FORMAT.length).toBeGreaterThan(0)
  })

  it('leaves unknown tokens intact', () => {
    expect(template('{unknown}', ctx)).toBe('{unknown}')
  })

  it('replaces all occurrences of a token', () => {
    const out = template('{model}-{model}', ctx)
    expect(out).toBe('claude-sonnet-4-6-claude-sonnet-4-6')
  })
})
