// test/core/stats/aggregate.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { aggregate } from '../../../src/core/stats/aggregate'
import type { CostEntry } from '../../../src/core/cost/tracker'

// ---------------------------------------------------------------------------
// Mock the filesystem helpers to avoid touching real disk
// ---------------------------------------------------------------------------
vi.mock('../../../src/core/cost/persist', () => ({
  defaultCostPath: (home: string) => `${home}/.nuka/cost.json`,
  readCostFile: vi.fn(),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  }
})

import { readCostFile } from '../../../src/core/cost/persist'

const NOW = new Date('2026-04-25T15:00:00Z').getTime()

function makeEntry(model: string, daysAgo: number, tokens = 1000): CostEntry {
  return {
    model,
    sessionId: `s-${model}-${daysAgo}`,
    ts: NOW - daysAgo * 24 * 3600 * 1000,
    inputTokens: Math.floor(tokens * 0.7),
    outputTokens: Math.floor(tokens * 0.3),
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
  }
}

describe('aggregate()', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns zero stats when cost.json is empty', async () => {
    vi.mocked(readCostFile).mockResolvedValue([])
    const result = await aggregate({ home: '/tmp/fake', now: NOW })
    expect(result.tokens).toBe(0)
    expect(result.costUsd).toBe(0)
    expect(result.byModel.size).toBe(0)
    expect(result.activeDays).toBe(0)
    expect(result.sessions).toBe(0)
  })

  it('aggregates tokens from entries', async () => {
    vi.mocked(readCostFile).mockResolvedValue([
      makeEntry('claude-sonnet-4-6', 0, 2000),
      makeEntry('claude-sonnet-4-6', 1, 1000),
    ])
    const result = await aggregate({ home: '/tmp/fake', now: NOW })
    expect(result.tokens).toBe(3000)
    expect(result.byModel.has('claude-sonnet-4-6')).toBe(true)
    expect(result.byModel.get('claude-sonnet-4-6')!.tokens).toBe(3000)
  })

  it('separates tokens by model', async () => {
    vi.mocked(readCostFile).mockResolvedValue([
      makeEntry('claude-opus-4-7', 0, 1000),
      makeEntry('gpt-4o', 0, 500),
    ])
    const result = await aggregate({ home: '/tmp/fake', now: NOW })
    expect(result.byModel.size).toBe(2)
    expect(result.byModel.get('claude-opus-4-7')!.tokens).toBe(1000)
    expect(result.byModel.get('gpt-4o')!.tokens).toBe(500)
  })

  it('filters entries by 7d range', async () => {
    vi.mocked(readCostFile).mockResolvedValue([
      makeEntry('claude-sonnet-4-6', 3, 1000),   // within 7d
      makeEntry('claude-sonnet-4-6', 10, 9999),  // outside 7d
    ])
    const result = await aggregate({ home: '/tmp/fake', now: NOW, range: '7d' })
    expect(result.tokens).toBe(1000)
  })

  it('filters entries by 30d range', async () => {
    vi.mocked(readCostFile).mockResolvedValue([
      makeEntry('claude-sonnet-4-6', 20, 1000),  // within 30d
      makeEntry('claude-sonnet-4-6', 35, 9999),  // outside 30d
    ])
    const result = await aggregate({ home: '/tmp/fake', now: NOW, range: '30d' })
    expect(result.tokens).toBe(1000)
  })

  it('computes activeDays correctly', async () => {
    vi.mocked(readCostFile).mockResolvedValue([
      makeEntry('claude-sonnet-4-6', 0, 100),
      makeEntry('claude-sonnet-4-6', 0, 200),   // same day — one active day
      makeEntry('claude-sonnet-4-6', 2, 100),   // different day
    ])
    const result = await aggregate({ home: '/tmp/fake', now: NOW })
    expect(result.activeDays).toBe(2)
  })

  it('computes streakDays from consecutive days', async () => {
    vi.mocked(readCostFile).mockResolvedValue([
      makeEntry('claude-sonnet-4-6', 0),
      makeEntry('claude-sonnet-4-6', 1),
      makeEntry('claude-sonnet-4-6', 2),
      // gap at day 3
      makeEntry('claude-sonnet-4-6', 5),
    ])
    const result = await aggregate({ home: '/tmp/fake', now: NOW })
    expect(result.streakDays).toBe(3) // today + 2 prior days
  })

  it('identifies peakHour from entries', async () => {
    // All entries at hour 14 local time would be 14:00 UTC if NOW is 15:00 UTC
    const entries: CostEntry[] = []
    for (let i = 0; i < 5; i++) {
      entries.push({ ...makeEntry('claude-sonnet-4-6', 0), ts: new Date('2026-04-25T14:00:00Z').getTime() + i * 60000 })
    }
    entries.push({ ...makeEntry('claude-sonnet-4-6', 0), ts: new Date('2026-04-25T09:00:00Z').getTime() })
    vi.mocked(readCostFile).mockResolvedValue(entries)
    const result = await aggregate({ home: '/tmp/fake', now: NOW })
    expect(result.peakHour).not.toBeNull()
  })

  it('computes non-zero costUsd for known models', async () => {
    vi.mocked(readCostFile).mockResolvedValue([makeEntry('claude-opus-4-7', 0, 1_000_000)])
    const result = await aggregate({ home: '/tmp/fake', now: NOW })
    expect(result.costUsd).toBeGreaterThan(0)
  })
})
