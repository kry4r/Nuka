// test/core/cost/persist.test.ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readCostFile,
  writeCostFile,
  capEntries,
  MAX_ENTRIES,
  defaultCostPath,
} from '../../../src/core/cost/persist'
import type { CostEntry } from '../../../src/core/cost/tracker'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-cost-persist-'))
}

const entry = (over: Partial<CostEntry> = {}): CostEntry => ({
  model: 'claude-haiku-4-5',
  sessionId: 's1',
  inputTokens: 10,
  outputTokens: 5,
  cacheCreateTokens: 0,
  cacheReadTokens: 0,
  ts: 1_700_000_000_000,
  ...over,
})

describe('cost persist', () => {
  it('readCostFile on missing file returns []', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost.json')
    expect(await readCostFile(file)).toEqual([])
  })

  it('write then read round-trips entries', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'sub', 'cost.json')
    const entries = [entry({ ts: 1 }), entry({ ts: 2, sessionId: 's2' })]
    await writeCostFile(file, entries)
    const read = await readCostFile(file)
    expect(read).toHaveLength(2)
    expect(read[0]!.sessionId).toBe('s1')
    expect(read[1]!.sessionId).toBe('s2')
  })

  it('write is atomic — leaves no .tmp- file behind', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost.json')
    await writeCostFile(file, [entry()])
    const listing = await fs.readdir(dir)
    expect(listing).toContain('cost.json')
    expect(listing.some(n => n.startsWith('cost.json.tmp-'))).toBe(false)
  })

  it('readCostFile tolerates malformed JSON', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost.json')
    await fs.writeFile(file, '{not json', 'utf8')
    expect(await readCostFile(file)).toEqual([])
  })

  it('readCostFile tolerates wrong version', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost.json')
    await fs.writeFile(file, JSON.stringify({ version: 99, entries: [entry()] }), 'utf8')
    expect(await readCostFile(file)).toEqual([])
  })

  it('readCostFile drops malformed entries but keeps good siblings', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost.json')
    const payload = {
      version: 1,
      entries: [
        entry({ ts: 1 }),
        { not: 'a real entry' },
        null,
        entry({ ts: 2 }),
      ],
    }
    await fs.writeFile(file, JSON.stringify(payload), 'utf8')
    const read = await readCostFile(file)
    expect(read).toHaveLength(2)
  })

  it('capEntries drops oldest by ts when over MAX_ENTRIES', () => {
    const oversized: CostEntry[] = []
    for (let i = 0; i < MAX_ENTRIES + 17; i++) oversized.push(entry({ ts: i }))
    const capped = capEntries(oversized)
    expect(capped).toHaveLength(MAX_ENTRIES)
    // The newest MAX_ENTRIES survived; the oldest 17 were dropped.
    expect(capped[0]!.ts).toBe(17)
    expect(capped[capped.length - 1]!.ts).toBe(MAX_ENTRIES + 16)
  })

  it('writeCostFile applies the cap on disk', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'cost.json')
    const oversized: CostEntry[] = []
    for (let i = 0; i < MAX_ENTRIES + 5; i++) oversized.push(entry({ ts: i }))
    await writeCostFile(file, oversized)
    const read = await readCostFile(file)
    expect(read).toHaveLength(MAX_ENTRIES)
  })

  it('defaultCostPath sits inside ~/.nuka', () => {
    const p = defaultCostPath('/fake/home')
    expect(p).toBe(path.join('/fake/home', '.nuka', 'cost.json'))
  })
})
