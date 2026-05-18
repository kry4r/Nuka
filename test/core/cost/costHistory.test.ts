// test/core/cost/costHistory.test.ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  defaultCostHistoryPath,
  readCostHistory,
  writeCostHistory,
  foldEntriesIntoHistory,
  dayKey,
  type CostHistory,
  type DailyTotal,
} from '../../../src/core/cost/costHistory'
import type { CostEntry } from '../../../src/core/cost/tracker'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-cost-history-'))
}

const baseEntry = (over: Partial<CostEntry> = {}): CostEntry => ({
  model: 'claude-haiku-4-5',
  sessionId: 's1',
  inputTokens: 100,
  outputTokens: 50,
  cacheCreateTokens: 0,
  cacheReadTokens: 0,
  ts: new Date('2026-05-18T10:00:00').getTime(),
  ...over,
})

describe('defaultCostHistoryPath', () => {
  it('sits inside ~/.nuka and is named cost-history.json', () => {
    const p = defaultCostHistoryPath('/fake/home')
    expect(p).toBe(path.join('/fake/home', '.nuka', 'cost-history.json'))
  })
})

describe('dayKey', () => {
  it('produces a YYYY-MM-DD key for a given timestamp', () => {
    const ts = new Date(2026, 4, 18, 13, 45).getTime() // local time, month 0-indexed
    expect(dayKey(ts)).toBe('2026-05-18')
  })
  it('pads month and day to two digits', () => {
    const ts = new Date(2026, 0, 3, 0, 0).getTime()
    expect(dayKey(ts)).toBe('2026-01-03')
  })
})

describe('readCostHistory / writeCostHistory', () => {
  it('readCostHistory on a missing file returns an empty history', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost-history.json')
    const h = await readCostHistory(file)
    expect(h.version).toBe(1)
    expect(h.days).toEqual({})
  })

  it('write then read round-trips', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'sub', 'cost-history.json')
    const day: DailyTotal = {
      inputTokens: 10,
      outputTokens: 5,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      turns: 1,
      usdByModel: { 'claude-haiku-4-5': 0.0001 },
    }
    const hist: CostHistory = { version: 1, days: { '2026-05-18': day } }
    await writeCostHistory(file, hist)
    const read = await readCostHistory(file)
    expect(read.days['2026-05-18']).toEqual(day)
  })

  it('write is atomic — leaves no .tmp- file behind', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost-history.json')
    await writeCostHistory(file, { version: 1, days: {} })
    const listing = await fs.readdir(dir)
    expect(listing).toContain('cost-history.json')
    expect(listing.some(n => n.startsWith('cost-history.json.tmp-'))).toBe(false)
  })

  it('readCostHistory tolerates malformed JSON', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost-history.json')
    await fs.writeFile(file, '{not json', 'utf8')
    const h = await readCostHistory(file)
    expect(h.days).toEqual({})
  })

  it('readCostHistory tolerates wrong schema version', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost-history.json')
    await fs.writeFile(file, JSON.stringify({ version: 99, days: {} }), 'utf8')
    const h = await readCostHistory(file)
    expect(h.days).toEqual({})
  })
})

describe('foldEntriesIntoHistory', () => {
  it('groups entries by local day key', () => {
    const day1 = new Date(2026, 4, 18, 9, 0).getTime()
    const day2 = new Date(2026, 4, 19, 1, 0).getTime()
    const entries: CostEntry[] = [
      baseEntry({ ts: day1, inputTokens: 100, outputTokens: 50 }),
      baseEntry({ ts: day1, inputTokens: 10,  outputTokens: 5 }),
      baseEntry({ ts: day2, inputTokens: 1,   outputTokens: 1 }),
    ]
    const h = foldEntriesIntoHistory({ version: 1, days: {} }, entries)
    expect(h.days['2026-05-18']!.inputTokens).toBe(110)
    expect(h.days['2026-05-18']!.outputTokens).toBe(55)
    expect(h.days['2026-05-18']!.turns).toBe(2)
    expect(h.days['2026-05-19']!.turns).toBe(1)
  })

  it('merges into existing day totals additively', () => {
    const day = new Date(2026, 4, 18, 9, 0).getTime()
    const seed: CostHistory = {
      version: 1,
      days: {
        '2026-05-18': {
          inputTokens: 1000, outputTokens: 200,
          cacheCreateTokens: 0, cacheReadTokens: 0,
          turns: 5, usdByModel: { 'claude-haiku-4-5': 0.001 },
        },
      },
    }
    const h = foldEntriesIntoHistory(seed, [baseEntry({ ts: day, inputTokens: 50, outputTokens: 25 })])
    expect(h.days['2026-05-18']!.inputTokens).toBe(1050)
    expect(h.days['2026-05-18']!.turns).toBe(6)
  })

  it('accumulates usdByModel per-model using provided pricing', () => {
    const day = new Date(2026, 4, 18, 9, 0).getTime()
    const entries: CostEntry[] = [
      baseEntry({ ts: day, model: 'claude-haiku-4-5', inputTokens: 1_000_000, outputTokens: 0 }),
      baseEntry({ ts: day, model: 'gpt-4o',            inputTokens: 1_000_000, outputTokens: 0 }),
    ]
    const h = foldEntriesIntoHistory({ version: 1, days: {} }, entries)
    const totals = h.days['2026-05-18']!
    // claude-haiku-4-5: input=$0.25/M; gpt-4o: input=$2.50/M
    expect(totals.usdByModel['claude-haiku-4-5']).toBeCloseTo(0.25, 4)
    expect(totals.usdByModel['gpt-4o']).toBeCloseTo(2.5, 4)
  })

  it('records 0 USD for unknown models without crashing', () => {
    const day = new Date(2026, 4, 18, 9, 0).getTime()
    const h = foldEntriesIntoHistory(
      { version: 1, days: {} },
      [baseEntry({ ts: day, model: 'made-up-model', inputTokens: 1000, outputTokens: 1000 })],
    )
    expect(h.days['2026-05-18']!.usdByModel['made-up-model']).toBe(0)
  })

  it('returns the seed unchanged when entries is empty', () => {
    const seed: CostHistory = { version: 1, days: {} }
    const h = foldEntriesIntoHistory(seed, [])
    expect(h).toEqual(seed)
  })
})
