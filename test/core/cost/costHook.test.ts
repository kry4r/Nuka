// test/core/cost/costHook.test.ts
import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CostTracker } from '../../../src/core/cost/tracker'
import {
  formatSessionCost,
  formatBannerLine,
  flushHistoryNow,
  installCostExitHook,
} from '../../../src/core/cost/costHook'
import {
  readCostHistory,
  defaultCostHistoryPath,
} from '../../../src/core/cost/costHistory'

async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuka-cost-hook-'))
  return path.join(dir, 'cost-history.json')
}

describe('formatSessionCost', () => {
  it('renders tokens-only when the model is unknown', () => {
    const t = new CostTracker()
    t.record('made-up-model', 's1', { input: 1000, output: 500 })
    const out = formatSessionCost(t, 's1', 'made-up-model')
    expect(out).toContain('1k')
    expect(out).toContain('500')
    expect(out).not.toContain('$')
  })
  it('renders both tokens and USD when pricing is available', () => {
    const t = new CostTracker()
    t.record('claude-haiku-4-5', 's1', { input: 1_000_000, output: 0 })
    const out = formatSessionCost(t, 's1', 'claude-haiku-4-5')
    expect(out).toContain('$')
    expect(out.toLowerCase()).toContain('in')
  })
  it('returns empty for a session with no recorded turns', () => {
    const t = new CostTracker()
    expect(formatSessionCost(t, 'no-such', 'claude-haiku-4-5')).toBe('')
  })
})

describe('formatBannerLine', () => {
  it('starts with "cost" so it is grep-able in transcripts', () => {
    const t = new CostTracker()
    t.record('claude-haiku-4-5', 's1', { input: 100, output: 50 })
    expect(formatBannerLine(t, 's1', 'claude-haiku-4-5').toLowerCase()).toMatch(/^cost\b/)
  })
})

describe('flushHistoryNow', () => {
  it('writes the tracker snapshot into cost-history.json', async () => {
    const file = await tmpFile()
    const t = new CostTracker()
    t.record('claude-haiku-4-5', 's1', { input: 1000, output: 500 })
    await flushHistoryNow(t, file)
    const h = await readCostHistory(file)
    const keys = Object.keys(h.days)
    expect(keys.length).toBe(1)
    expect(h.days[keys[0]!]!.turns).toBe(1)
  })
  it('is a no-op when the tracker is empty', async () => {
    const file = await tmpFile()
    const t = new CostTracker()
    await flushHistoryNow(t, file)
    // file may or may not exist; readCostHistory tolerates both.
    const h = await readCostHistory(file)
    expect(h.days).toEqual({})
  })
})

describe('installCostExitHook', () => {
  it('registers an exit listener and returns an uninstall fn', () => {
    const t = new CostTracker()
    const on = vi.spyOn(process, 'on')
    const off = vi.spyOn(process, 'off')
    const uninstall = installCostExitHook(t, '/tmp/never-used-cost-history.json')
    expect(on).toHaveBeenCalledWith('exit', expect.any(Function))
    uninstall()
    expect(off).toHaveBeenCalledWith('exit', expect.any(Function))
    on.mockRestore()
    off.mockRestore()
  })
  it('defaults to ~/.nuka/cost-history.json when no path is given', () => {
    const t = new CostTracker()
    const on = vi.spyOn(process, 'on')
    const uninstall = installCostExitHook(t)
    expect(on).toHaveBeenCalled()
    uninstall()
    on.mockRestore()
    // smoke: defaultCostHistoryPath resolves to the same canonical path
    expect(defaultCostHistoryPath(os.homedir())).toContain('cost-history.json')
  })
})
