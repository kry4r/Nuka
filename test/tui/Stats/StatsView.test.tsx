// test/tui/Stats/StatsView.test.tsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import { StatsView } from '../../../src/tui/Stats/StatsView'
import type { StatsResult } from '../../../src/core/stats/aggregate'

// ---------------------------------------------------------------------------
// Mock aggregate to avoid real filesystem access
// ---------------------------------------------------------------------------
vi.mock('../../../src/core/stats/aggregate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/stats/aggregate')>()
  return {
    ...actual,
    aggregate: vi.fn(),
  }
})

import { aggregate } from '../../../src/core/stats/aggregate'

const EMPTY_STATS: StatsResult = {
  sessions: 0,
  tokens: 0,
  costUsd: 0,
  byModel: new Map(),
  activeDays: 0,
  streakDays: 0,
  peakHour: null,
}

const RICH_STATS: StatsResult = {
  sessions: 42,
  tokens: 3_200_000,
  costUsd: 12.41,
  byModel: new Map([
    ['claude-opus-4-7',   { tokens: 2_100_000, usd: 9.20 }],
    ['claude-sonnet-4-6', { tokens: 800_000,   usd: 2.40 }],
    ['gpt-4o',            { tokens: 300_000,   usd: 0.81 }],
  ]),
  activeDays: 18,
  streakDays: 7,
  peakHour: 14,
}

describe('StatsView', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows "(no data yet)" when stats are empty', async () => {
    vi.mocked(aggregate).mockResolvedValue(EMPTY_STATS)
    const { lastFrame } = render(<StatsView onExit={() => {}} home="/tmp/fake" />)
    // Wait for async effect
    await new Promise(r => setTimeout(r, 50))
    const f = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(f).toContain('no data yet')
  })

  it('renders Overview tab with session count', async () => {
    vi.mocked(aggregate).mockResolvedValue(RICH_STATS)
    const { lastFrame } = render(<StatsView onExit={() => {}} home="/tmp/fake" />)
    await new Promise(r => setTimeout(r, 50))
    const f = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(f).toContain('42')
    expect(f).toContain('3.2M')
  })

  it('renders tab selector', async () => {
    vi.mocked(aggregate).mockResolvedValue(RICH_STATS)
    const { lastFrame } = render(<StatsView onExit={() => {}} home="/tmp/fake" />)
    await new Promise(r => setTimeout(r, 50))
    const f = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(f).toMatch(/Overview/)
    expect(f).toMatch(/Models/)
  })

  it('shows range tabs', async () => {
    vi.mocked(aggregate).mockResolvedValue(EMPTY_STATS)
    const { lastFrame } = render(<StatsView onExit={() => {}} home="/tmp/fake" />)
    await new Promise(r => setTimeout(r, 50))
    const f = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(f).toContain('All time')
    expect(f).toContain('Last 7 days')
    expect(f).toContain('Last 30 days')
  })

  it('shows keyboard hint', async () => {
    vi.mocked(aggregate).mockResolvedValue(EMPTY_STATS)
    const { lastFrame } = render(<StatsView onExit={() => {}} home="/tmp/fake" />)
    await new Promise(r => setTimeout(r, 50))
    const f = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(f).toMatch(/Tab/)
    expect(f).toMatch(/Esc/)
  })
})
