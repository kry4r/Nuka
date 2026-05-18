# Cost Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time, env-opt-in TUI cost display + daily totals persistence on top of the existing `src/core/cost/` tracker, completing the B1 port from Nuka-Code's `cost-tracker.ts`/`costHook.ts`.

**Architecture:** This is *additive*. `src/core/cost/{tracker,persist,pricing}.ts` already exist and are wired through `runAgent(deps.costTracker)` and `/cost`. We add (a) `costHistory.ts` for a daily roll-up file at `~/.nuka/cost-history.json` (separate from the existing per-entry `cost.json`), (b) `costHook.ts` for a session-aware formatter + on-exit summary, and (c) a `CostBanner` TUI component in the BOTTOM slot beside `CronMissedBanner`/`EmergencyTipBanner`. All new TUI surface is gated by `NUKA_COST_DISPLAY=1` so default behavior is unchanged.

**Tech Stack:** TypeScript (strict), Vitest, Ink (React for terminal)

---

## File Structure

**Create:**
- `src/core/cost/costHistory.ts` — daily totals roll-up. Reads/writes `~/.nuka/cost-history.json` atomically (tmp+rename). Different file, different shape from the existing `cost.json` (per-entry log).
- `src/core/cost/costHook.ts` — session-aware formatter (`formatSessionCost`) + on-exit summary writer (`installCostExitHook`). Mirrors the role of Nuka-Code's `costHook.ts` but consumes Nuka's `CostTracker` rather than the global-state bootstrap.
- `src/core/cost/displayEnabled.ts` — single env-gate predicate (`isCostDisplayEnabled`). Centralised so all opt-in checks read the same env var.
- `src/tui/Status/CostBanner.tsx` — BOTTOM-slot banner that renders the formatted real-time cost text. Pure presentation; visibility owned by App.tsx.
- `test/core/cost/costHistory.test.ts` — daily roll-up read/write/merge tests.
- `test/core/cost/costHook.test.ts` — formatter + exit-hook installer tests.
- `test/core/cost/displayEnabled.test.ts` — env-gate tests.
- `test/tui/Status/CostBanner.test.tsx` — Ink render test for the new banner.

**Modify:**
- `src/core/cost/persist.ts` — re-export `defaultCostHistoryPath` for callers (one-line tweak; no behaviour change to existing functions).
- `src/cli.tsx` — at boot, load `cost-history.json`; on exit, fold the in-memory tracker's today() into the history file using the costHook's flusher.
- `src/tui/App.tsx` — add a `<CostBanner>` row in the BOTTOM-slot stack, between `EmergencyTipBanner` and `CronMissedBanner`. Banner is gated by `isCostDisplayEnabled()` and reads from `props.costTracker`.

---

## Task 1 — `displayEnabled.ts` (env gate)

**Files**
- Create: `src/core/cost/displayEnabled.ts`
- Test: `test/core/cost/displayEnabled.test.ts`

**Steps**

- [ ] **1.1 Write failing test** — `test/core/cost/displayEnabled.test.ts`:

```ts
// test/core/cost/displayEnabled.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isCostDisplayEnabled, COST_DISPLAY_ENV } from '../../../src/core/cost/displayEnabled'

describe('isCostDisplayEnabled', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env[COST_DISPLAY_ENV]
    delete process.env[COST_DISPLAY_ENV]
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[COST_DISPLAY_ENV]
    else process.env[COST_DISPLAY_ENV] = saved
  })

  it('returns false when the env var is unset', () => {
    expect(isCostDisplayEnabled()).toBe(false)
  })
  it('returns true when the env var is exactly "1"', () => {
    process.env[COST_DISPLAY_ENV] = '1'
    expect(isCostDisplayEnabled()).toBe(true)
  })
  it('returns false for unrelated values (truthy strings, "true", "yes")', () => {
    for (const v of ['true', 'yes', '0', '', 'TRUE', '2']) {
      process.env[COST_DISPLAY_ENV] = v
      expect(isCostDisplayEnabled(), `value=${v}`).toBe(false)
    }
  })
  it('respects an explicit env arg over process.env', () => {
    process.env[COST_DISPLAY_ENV] = '1'
    expect(isCostDisplayEnabled({})).toBe(false)
    expect(isCostDisplayEnabled({ [COST_DISPLAY_ENV]: '1' })).toBe(true)
  })
})
```

- [ ] **1.2 Run failing test** — `npx vitest run test/core/cost/displayEnabled.test.ts`
  Expected: "Cannot find module './displayEnabled'" / file does not exist.

- [ ] **1.3 Implement** — `src/core/cost/displayEnabled.ts`:

```ts
// src/core/cost/displayEnabled.ts
//
// Single env-gate predicate for the real-time cost display. Centralised so
// every callsite (CLI bootstrap, TUI banner, exit summary) reads the same
// env var with the same parsing rules.
//
// Strict literal `'1'` semantics match the rest of the codebase
// (NUKA_RECENT_FILES_NO_PERSIST, NUKA_JSON_FORMAT_HOOK, etc.). We deliberately
// do not accept 'true'/'yes' to keep the on/off contract unambiguous.

export const COST_DISPLAY_ENV = 'NUKA_COST_DISPLAY'

/**
 * Returns `true` iff the cost-display env var is set to exactly `'1'`.
 *
 * @param env Optional environment map; defaults to `process.env`. Useful for
 *            tests that need to override without mutating the real env.
 */
export function isCostDisplayEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env[COST_DISPLAY_ENV] === '1'
}
```

- [ ] **1.4 Run passing test** — `npx vitest run test/core/cost/displayEnabled.test.ts`
  Expected: `Test Files  1 passed (1)` with 4 passing tests.

- [ ] **1.5 Commit** — `git add src/core/cost/displayEnabled.ts test/core/cost/displayEnabled.test.ts && git commit -m "feat(cost): add NUKA_COST_DISPLAY env gate"`

---

## Task 2 — `costHistory.ts` (daily totals persistence)

**Files**
- Create: `src/core/cost/costHistory.ts`
- Test: `test/core/cost/costHistory.test.ts`

**Steps**

- [ ] **2.1 Write failing test** — `test/core/cost/costHistory.test.ts`:

```ts
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
```

- [ ] **2.2 Run failing test** — `npx vitest run test/core/cost/costHistory.test.ts`
  Expected: import error for `costHistory`.

- [ ] **2.3 Implement** — `src/core/cost/costHistory.ts`:

```ts
// src/core/cost/costHistory.ts
//
// Daily totals roll-up for the cost tracker.
//
// File layout: `~/.nuka/cost-history.json` (separate from the per-entry
// `cost.json`):
//   { "version": 1, "days": { "YYYY-MM-DD": DailyTotal, ... } }
//
// Why separate? The entry log (`cost.json`) is bounded by MAX_ENTRIES and
// can drop oldest rows; daily totals must persist indefinitely so the user
// can see "what did I spend last week / last month". Folding tracker
// entries into the history at exit time gives us crash-tolerant long-term
// stats without paying per-record write cost.
//
// Day keying is **local time** so the same wall-clock day on a user's
// machine maps to the same bucket as `CostTracker.today()`.
//
// Atomic writes: tmp+rename like recent-files.json and cost.json.
//
// Pricing fold: we resolve USD per entry at fold time using `findPricing`.
// Cost per *aggregated* row is stored per-model so price changes don't
// retroactively rewrite history (each entry was priced at fold time).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { CostEntry } from './tracker'
import { findPricing } from './pricing'

const SCHEMA_VERSION = 1

/** Daily totals: pre-pricing tokens + per-model USD breakdown. */
export type DailyTotal = {
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  /** Number of recorded assistant turns folded into this day. */
  turns: number
  /** USD per model, computed at fold time. Unknown models => 0. */
  usdByModel: Record<string, number>
}

export type CostHistory = {
  version: 1
  days: Record<string, DailyTotal>
}

const EMPTY_HISTORY: CostHistory = { version: SCHEMA_VERSION, days: {} }

/** Default location: `~/.nuka/cost-history.json`. */
export function defaultCostHistoryPath(home: string = os.homedir()): string {
  return path.join(home, '.nuka', 'cost-history.json')
}

/** Format a timestamp as a `YYYY-MM-DD` key in local time. */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

function emptyDay(): DailyTotal {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    turns: 0,
    usdByModel: {},
  }
}

function isDailyTotalShape(v: unknown): v is DailyTotal {
  if (!v || typeof v !== 'object') return false
  const o = v as Partial<DailyTotal>
  return (
    typeof o.inputTokens === 'number' &&
    typeof o.outputTokens === 'number' &&
    typeof o.cacheCreateTokens === 'number' &&
    typeof o.cacheReadTokens === 'number' &&
    typeof o.turns === 'number' &&
    !!o.usdByModel &&
    typeof o.usdByModel === 'object'
  )
}

/**
 * Read the history file. Returns an empty history if missing, malformed, or
 * a version we don't understand.
 */
export async function readCostHistory(filePath: string): Promise<CostHistory> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...EMPTY_HISTORY, days: {} }
    }
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...EMPTY_HISTORY, days: {} }
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_HISTORY, days: {} }
  const obj = parsed as Partial<CostHistory>
  if (obj.version !== SCHEMA_VERSION) return { ...EMPTY_HISTORY, days: {} }
  if (!obj.days || typeof obj.days !== 'object') return { ...EMPTY_HISTORY, days: {} }
  const days: Record<string, DailyTotal> = {}
  for (const [key, val] of Object.entries(obj.days)) {
    if (!isDailyTotalShape(val)) continue
    // Clone usdByModel so callers can't mutate the source object via reference.
    days[key] = {
      inputTokens: val.inputTokens,
      outputTokens: val.outputTokens,
      cacheCreateTokens: val.cacheCreateTokens,
      cacheReadTokens: val.cacheReadTokens,
      turns: val.turns,
      usdByModel: { ...val.usdByModel },
    }
  }
  return { version: SCHEMA_VERSION, days }
}

/**
 * Atomically write the history to `filePath`. Creates the parent dir if it
 * doesn't exist. The tmp suffix carries pid+ts so concurrent writers don't
 * clobber each other's tmp file.
 */
export async function writeCostHistory(
  filePath: string,
  history: CostHistory,
): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, JSON.stringify(history), 'utf8')
  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * Fold a batch of tracker entries into an existing history. Returns a new
 * history (pure / immutable). Pricing is resolved per-entry via
 * {@link findPricing}; unknown models contribute `0` USD.
 */
export function foldEntriesIntoHistory(
  history: CostHistory,
  entries: readonly CostEntry[],
): CostHistory {
  if (entries.length === 0) return history
  // Deep-clone the days map so we never mutate the input.
  const days: Record<string, DailyTotal> = {}
  for (const [k, v] of Object.entries(history.days)) {
    days[k] = { ...v, usdByModel: { ...v.usdByModel } }
  }
  for (const e of entries) {
    const key = dayKey(e.ts)
    const cur = days[key] ?? emptyDay()
    cur.inputTokens += e.inputTokens
    cur.outputTokens += e.outputTokens
    cur.cacheCreateTokens += e.cacheCreateTokens
    cur.cacheReadTokens += e.cacheReadTokens
    cur.turns += 1
    const p = findPricing(e.model)
    let usd = 0
    if (p) {
      usd += (e.inputTokens  / 1_000_000) * p.input
      usd += (e.outputTokens / 1_000_000) * p.output
      if (p.cacheCreate) usd += (e.cacheCreateTokens / 1_000_000) * p.cacheCreate
      if (p.cacheRead)   usd += (e.cacheReadTokens   / 1_000_000) * p.cacheRead
    }
    cur.usdByModel[e.model] = (cur.usdByModel[e.model] ?? 0) + usd
    days[key] = cur
  }
  return { version: SCHEMA_VERSION, days }
}
```

- [ ] **2.4 Run passing test** — `npx vitest run test/core/cost/costHistory.test.ts`
  Expected: `Test Files  1 passed (1)` with 11 passing tests.

- [ ] **2.5 Commit** — `git add src/core/cost/costHistory.ts test/core/cost/costHistory.test.ts && git commit -m "feat(cost): add daily totals roll-up (cost-history.json)"`

---

## Task 3 — `costHook.ts` (formatter + on-exit summary)

**Files**
- Create: `src/core/cost/costHook.ts`
- Test: `test/core/cost/costHook.test.ts`

**Steps**

- [ ] **3.1 Write failing test** — `test/core/cost/costHook.test.ts`:

```ts
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
```

- [ ] **3.2 Run failing test** — `npx vitest run test/core/cost/costHook.test.ts`
  Expected: module not found.

- [ ] **3.3 Implement** — `src/core/cost/costHook.ts`:

```ts
// src/core/cost/costHook.ts
//
// Cost "hook" surface. Mirrors the role of Nuka-Code's `costHook.ts` —
// it knows how to (a) format current cost for a HUD line and (b) flush
// session totals into a long-lived history file when the process exits.
//
// We deliberately do *not* expose a React hook here: Nuka's CostTracker is
// a per-process singleton injected via `props.costTracker`, so the TUI
// banner reads it directly. The React side lives in
// `src/tui/Status/CostBanner.tsx`; this module provides the pure helpers
// it (and the CLI) call.
//
// `flushHistoryNow` is idempotent in shape: empty tracker -> no-op write
// avoidance, non-empty -> read+fold+write the history file.

import { writeFileSync } from 'node:fs'
import type { CostTracker } from './tracker'
import {
  defaultCostHistoryPath,
  readCostHistory,
  writeCostHistory,
  foldEntriesIntoHistory,
} from './costHistory'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

/**
 * Render a one-line summary for the *current* session. Used by both the
 * exit-summary printer and the TUI banner. Empty string when the session
 * has no recorded turns yet.
 */
export function formatSessionCost(
  tracker: CostTracker,
  sessionId: string,
  model: string,
): string {
  const cur = tracker.current(sessionId)
  if (cur.turns === 0) return ''
  const usd = tracker.toUsd(model, cur)
  const tokens = `in ${fmtTokens(cur.inputTokens)} · out ${fmtTokens(cur.outputTokens)}`
  const cache = cur.cacheReadTokens > 0 || cur.cacheCreateTokens > 0
    ? ` · cache ${fmtTokens(cur.cacheReadTokens)}/${fmtTokens(cur.cacheCreateTokens)}`
    : ''
  if (usd === undefined) return `${tokens}${cache}`
  return `${tokens}${cache} · $${usd.toFixed(4)}`
}

/**
 * TUI banner-friendly version: prefixed with `cost ` for grepability in
 * logs and screenshots.
 */
export function formatBannerLine(
  tracker: CostTracker,
  sessionId: string,
  model: string,
): string {
  const body = formatSessionCost(tracker, sessionId, model)
  return body ? `cost ${body}` : ''
}

/**
 * Fold all tracker entries into the cost-history file. Safe to call
 * repeatedly — duplicates would double-count, so callers should fold at
 * shutdown only (or after explicit boundary events).
 */
export async function flushHistoryNow(
  tracker: CostTracker,
  filePath: string = defaultCostHistoryPath(),
): Promise<void> {
  const entries = tracker.snapshot()
  if (entries.length === 0) return
  const cur = await readCostHistory(filePath)
  const next = foldEntriesIntoHistory(cur, entries)
  await writeCostHistory(filePath, next)
}

/**
 * Install a synchronous exit listener that folds the tracker into the
 * history file on `process.on('exit')`. We pre-bind `filePath` so the
 * listener has no async I/O dependency — at exit time we have a single
 * synchronous tick to run before the event loop dies.
 *
 * Implementation note: `process.on('exit')` cannot await Promises, so we
 * use `writeFileSync` directly via a synchronous read-modify-write. This
 * is a narrow exception to "async fs everywhere"; the function is only
 * ever invoked once per process at shutdown.
 *
 * Returns an `uninstall` function for tests.
 */
export function installCostExitHook(
  tracker: CostTracker,
  filePath: string = defaultCostHistoryPath(),
): () => void {
  const handler = (): void => {
    const entries = tracker.snapshot()
    if (entries.length === 0) return
    try {
      // Read sync via a small helper rather than pulling in fs.readFileSync
      // at the top of the module — keeps the async path fully async.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
      const path = require('node:path') as typeof import('node:path')
      let raw = ''
      try { raw = readFileSync(filePath, 'utf8') } catch { /* missing */ }
      let cur: Awaited<ReturnType<typeof readCostHistory>>
      try {
        const parsed = raw ? JSON.parse(raw) : null
        if (parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1) {
          cur = parsed as Awaited<ReturnType<typeof readCostHistory>>
        } else {
          cur = { version: 1, days: {} }
        }
      } catch {
        cur = { version: 1, days: {} }
      }
      const next = foldEntriesIntoHistory(cur, entries)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(next), 'utf8')
    } catch {
      // Best-effort — never throw out of an exit handler.
    }
  }
  process.on('exit', handler)
  return () => {
    process.off('exit', handler)
  }
}
```

- [ ] **3.4 Run passing test** — `npx vitest run test/core/cost/costHook.test.ts`
  Expected: `Test Files  1 passed (1)` with 7 passing tests.

- [ ] **3.5 Commit** — `git add src/core/cost/costHook.ts test/core/cost/costHook.test.ts && git commit -m "feat(cost): add session formatter + exit-time history flush"`

---

## Task 4 — `CostBanner.tsx` (TUI BOTTOM-slot row)

**Files**
- Create: `src/tui/Status/CostBanner.tsx`
- Test: `test/tui/Status/CostBanner.test.tsx`

**Steps**

- [ ] **4.1 Write failing test** — `test/tui/Status/CostBanner.test.tsx`:

```tsx
// test/tui/Status/CostBanner.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { CostBanner } from '../../../src/tui/Status/CostBanner'
import { CostTracker } from '../../../src/core/cost/tracker'

describe('CostBanner', () => {
  it('renders nothing when enabled=false', () => {
    const tracker = new CostTracker()
    tracker.record('claude-haiku-4-5', 's1', { input: 100, output: 50 })
    const { lastFrame } = render(
      <CostBanner enabled={false} tracker={tracker} sessionId="s1" model="claude-haiku-4-5" />,
    )
    expect(lastFrame()?.trim() ?? '').toBe('')
  })

  it('renders nothing when the tracker has no entries for this session', () => {
    const tracker = new CostTracker()
    const { lastFrame } = render(
      <CostBanner enabled={true} tracker={tracker} sessionId="empty" model="claude-haiku-4-5" />,
    )
    expect(lastFrame()?.trim() ?? '').toBe('')
  })

  it('renders nothing when tracker is undefined', () => {
    const { lastFrame } = render(
      <CostBanner enabled={true} sessionId="s1" model="claude-haiku-4-5" />,
    )
    expect(lastFrame()?.trim() ?? '').toBe('')
  })

  it('renders the formatted banner line when enabled and entries exist', () => {
    const tracker = new CostTracker()
    tracker.record('claude-haiku-4-5', 's1', { input: 1000, output: 500 })
    const { lastFrame } = render(
      <CostBanner enabled={true} tracker={tracker} sessionId="s1" model="claude-haiku-4-5" />,
    )
    const out = lastFrame() ?? ''
    expect(out).toMatch(/cost/i)
    expect(out).toContain('1k')
  })

  it('renders tokens-only line when model has no pricing', () => {
    const tracker = new CostTracker()
    tracker.record('made-up-model', 's1', { input: 100, output: 50 })
    const { lastFrame } = render(
      <CostBanner enabled={true} tracker={tracker} sessionId="s1" model="made-up-model" />,
    )
    const out = lastFrame() ?? ''
    expect(out).toContain('100')
    expect(out).not.toContain('$')
  })
})
```

- [ ] **4.2 Run failing test** — `npx vitest run test/tui/Status/CostBanner.test.tsx`
  Expected: module not found.

- [ ] **4.3 Implement** — `src/tui/Status/CostBanner.tsx`:

```tsx
// src/tui/Status/CostBanner.tsx
//
// Real-time cost display, BOTTOM-slot row beside CronMissedBanner /
// EmergencyTipBanner. Visibility is gated by `enabled` (App.tsx wires this
// to `isCostDisplayEnabled()` so default behaviour is unchanged).
//
// Visual contract mirrors the sibling banners:
//   - rounded border in fgMuted (accent uses warn/error semantics already)
//   - paddingX={1}
//   - flexShrink={0} so vertical layout never squeezes the row
//   - returns null when there's nothing to show (no tracker, empty session,
//     env gate off) so the slot collapses cleanly.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import type { CostTracker } from '../../core/cost/tracker'
import { formatBannerLine } from '../../core/cost/costHook'

export type CostBannerProps = {
  /**
   * Env-opt-in gate. Owned by App.tsx (resolves
   * `isCostDisplayEnabled()` once at boot). When false the component
   * returns null regardless of tracker contents.
   */
  enabled: boolean
  /**
   * Shared CostTracker — same instance the agent loop writes into. When
   * omitted (e.g. tests without a tracker) the banner is invisible.
   */
  tracker?: CostTracker
  /** Current session id; used to scope the displayed totals. */
  sessionId: string
  /** Current model id; used to resolve pricing for USD display. */
  model: string
}

export function CostBanner(props: CostBannerProps): React.JSX.Element | null {
  if (!props.enabled) return null
  if (!props.tracker) return null
  const line = formatBannerLine(props.tracker, props.sessionId, props.model)
  if (!line) return null
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={P.fgMuted}
      paddingX={1}
      flexShrink={0}
    >
      <Text color={P.fgMuted}>{line}</Text>
    </Box>
  )
}
```

- [ ] **4.4 Run passing test** — `npx vitest run test/tui/Status/CostBanner.test.tsx`
  Expected: `Test Files  1 passed (1)` with 5 passing tests.

- [ ] **4.5 Commit** — `git add src/tui/Status/CostBanner.tsx test/tui/Status/CostBanner.test.tsx && git commit -m "feat(tui): add opt-in CostBanner row in BOTTOM slot"`

---

## Task 5 — Wire `CostBanner` into `App.tsx`

**Files**
- Modify: `src/tui/App.tsx`

**Steps**

- [ ] **5.1 Write failing test** — extend `test/tui/Status/CostBanner.test.tsx` with an App-level integration check (append to the existing file):

```tsx
// Appended to test/tui/Status/CostBanner.test.tsx — verifies App renders
// the banner only when both the env gate AND a tracker with entries are
// present.
import { describe as describe2, it as it2, expect as expect2, beforeEach, afterEach } from 'vitest'
import { COST_DISPLAY_ENV } from '../../../src/core/cost/displayEnabled'
import { renderApp } from '../../../src/tui/testing/harness'

describe2('App integration — CostBanner gating', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env[COST_DISPLAY_ENV]
    delete process.env[COST_DISPLAY_ENV]
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[COST_DISPLAY_ENV]
    else process.env[COST_DISPLAY_ENV] = saved
  })

  it2('does not render the banner when env gate is off, even with tracker entries', async () => {
    const { instance, deps } = await renderApp()
    const sid = deps.sessions.active()!.id
    deps.costTracker.record('claude-haiku-4-5', sid, { input: 1000, output: 500 })
    instance.rerender(instance.lastFrame ? undefined as never : undefined as never) // force a re-render
    expect2(instance.lastFrame() ?? '').not.toMatch(/^cost\b/m)
    instance.unmount()
  })

  it2('renders the banner when env gate is on and tracker has entries', async () => {
    process.env[COST_DISPLAY_ENV] = '1'
    const { instance, deps } = await renderApp()
    const sid = deps.sessions.active()!.id
    deps.costTracker.record('claude-haiku-4-5', sid, { input: 1000, output: 500 })
    // Force a re-render by submitting a benign keypress (harness convention).
    instance.stdin.write('\x00')
    const frame = instance.lastFrame() ?? ''
    expect2(frame.toLowerCase()).toMatch(/cost/)
    instance.unmount()
  })
})
```

> **Note on `renderApp` shape:** `src/tui/testing/harness.ts` already constructs `costTracker` and passes it into `<App>` (see lines 142/156/202). Verify the public export name when implementing — the test relies on it returning `{ instance, deps }` where `deps.costTracker` is the same instance App receives. If the harness export shape differs, adjust the destructuring; do **not** change the harness.

- [ ] **5.2 Run failing test** — `npx vitest run test/tui/Status/CostBanner.test.tsx`
  Expected: integration block fails because App doesn't render `<CostBanner>` yet.

- [ ] **5.3 Modify** — `src/tui/App.tsx`. Three concrete edits:

  **5.3.a — Add the import beside existing Status-banner imports.** Find the existing line near the top of `App.tsx` that imports `CronMissedBanner` (`from './Status/CronMissedBanner'`) and add directly after it:

  ```tsx
  import { CostBanner } from './Status/CostBanner'
  import { isCostDisplayEnabled } from '../core/cost/displayEnabled'
  ```

  **5.3.b — Resolve the env gate once per render** — in the App function body, near where `cronMissed` / `emergencyTip` are derived (around the persistent-banner block, currently `const emergencyTip = props.emergencyTip ?? null`):

  ```tsx
  // B1 — env-opt-in real-time cost row. Gate resolves once per render so
  // toggling NUKA_COST_DISPLAY mid-session takes effect on the next paint
  // without forcing a remount.
  const costDisplayOn = isCostDisplayEnabled()
  ```

  **5.3.c — Render the banner inside the BOTTOM-slot stack.** Find the existing block that renders `CronMissedBanner` (currently around line 921):

  ```tsx
  {!submenuInline && promptVisible && (
    <CronMissedBanner notice={cronMissed} dismissed={cronBannerDismissed} />
  )}
  ```

  Insert directly *above* that block (so cost sits between EmergencyTip and CronMissed in source order, matching the file-structure plan):

  ```tsx
  {!submenuInline && promptVisible && (
    <CostBanner
      enabled={costDisplayOn}
      tracker={props.costTracker}
      sessionId={session.id}
      model={session.model}
    />
  )}
  ```

  The existing `<StatusPanel cost={cost} ... />` row at the bottom of the visible block stays unchanged — the legacy cost segment continues to render for non-opted users; the new banner is the env-gated addition.

- [ ] **5.4 Run passing test** — `npx vitest run test/tui/Status/CostBanner.test.tsx`
  Expected: `Test Files  1 passed (1)` (all 7 tests pass: 5 unit + 2 integration).

- [ ] **5.5 Typecheck** — `npx tsc --noEmit`
  Expected: no errors.

- [ ] **5.6 Commit** — `git add src/tui/App.tsx && git commit -m "feat(tui): wire CostBanner into App BOTTOM slot (opt-in)"`

---

## Task 6 — Wire history flush into `cli.tsx`

**Files**
- Modify: `src/cli.tsx`

**Steps**

- [ ] **6.1 Locate the existing cost wiring** — `src/cli.tsx` currently:
  - imports `CostTracker` at line ~128 (`import { CostTracker } from './core/cost/tracker'`)
  - constructs the tracker at line ~926 (`const costTracker = new CostTracker()`)
  - hydrates from `cost.json` at line ~929 (`if (entries.length > 0) costTracker.hydrate(entries)`)
  - schedules a flush at line ~1125 (`const costFlush = writeCostFile(defaultCostPath(), costTracker.snapshot()).catch(() => {})`)

- [ ] **6.2 Modify** — three concrete edits.

  **6.2.a — Add imports** alongside the existing CostTracker import (after line ~128):

  ```ts
  import { installCostExitHook } from './core/cost/costHook'
  import { defaultCostHistoryPath } from './core/cost/costHistory'
  ```

  **6.2.b — Install the exit hook directly after the tracker is constructed and hydrated.** The block currently looks roughly like:

  ```ts
  const costTracker = new CostTracker()
  try {
    const entries = await readCostFile(defaultCostPath())
    if (entries.length > 0) costTracker.hydrate(entries)
  } catch { /* best-effort */ }
  ```

  Append (immediately after the try/catch above):

  ```ts
  // B1 — fold session entries into the long-lived daily-totals file
  // (`~/.nuka/cost-history.json`) when the process exits. Synchronous by
  // necessity (process.on('exit') doesn't await Promises). Safe to install
  // unconditionally — when the tracker is empty at exit the handler no-ops.
  const uninstallCostExit = installCostExitHook(costTracker, defaultCostHistoryPath())
  ```

  **6.2.c — Cleanup on graceful shutdown.** Find the existing graceful-shutdown block that awaits `costFlush` (around line ~1125). Add the uninstall just before that block so the exit handler doesn't double-fire during clean shutdown:

  ```ts
  uninstallCostExit()
  ```

  Place it on the line *before* `const costFlush = writeCostFile(...)`. The synchronous flush from `installCostExitHook` was for *abrupt* exits; the graceful path already writes via `writeCostFile` for the per-entry log, and the history fold runs once on either path.

  > **Why not also call `flushHistoryNow()` here?** The graceful-path `costFlush` writes the per-entry log; the exit hook handles the daily roll-up. Doing both async here would race the exit handler. We keep responsibilities split: graceful = per-entry log, exit = daily fold.

- [ ] **6.3 Smoke test** — `npx tsc --noEmit`
  Expected: no errors.

- [ ] **6.4 Run the whole cost suite** — `npx vitest run test/core/cost test/tui/Status/CostBanner.test.tsx`
  Expected: all suites green.

- [ ] **6.5 Commit** — `git add src/cli.tsx && git commit -m "feat(cli): install cost-history exit-flush hook"`

---

## Task 7 — Re-export helpers + final sweep

**Files**
- Modify: `src/core/cost/persist.ts`

**Steps**

- [ ] **7.1 Add a barrel re-export so callers can do `import { defaultCostHistoryPath } from '.../cost/persist'` symmetrically with `defaultCostPath`.** Open `src/core/cost/persist.ts`. At the very bottom of the file, append:

```ts
// Re-export of the daily-totals helpers so consumers can import the whole
// cost persistence surface from one location (matches `defaultCostPath`).
export { defaultCostHistoryPath } from './costHistory'
```

- [ ] **7.2 Typecheck + full test pass** — run in sequence:

```
npx tsc --noEmit
npx vitest run test/core/cost test/tui/Status/CostBanner.test.tsx
```

Both must finish green. Expected: `Test Files` total includes `displayEnabled`, `costHistory`, `costHook`, `CostBanner`, plus the pre-existing `tracker` + `persist` suites.

- [ ] **7.3 Run the *whole* repo test suite to catch any indirect breakage** —

```
npx vitest run
```

Expected: all tests pass (the touched modules are additive; no existing behaviour should regress).

- [ ] **7.4 Lint** — `npx eslint src/core/cost src/tui/Status/CostBanner.tsx test/core/cost test/tui/Status/CostBanner.test.tsx`
  Expected: no errors.

- [ ] **7.5 Commit** — `git add src/core/cost/persist.ts && git commit -m "chore(cost): re-export defaultCostHistoryPath from persist barrel"`

---

## Acceptance Criteria

When all tasks are complete:

1. With `NUKA_COST_DISPLAY` **unset**: TUI looks identical to before (StatusPanel still shows `cost:$X.XXXX` via legacy `computeCost`). No new banner row. Default behaviour unchanged.
2. With `NUKA_COST_DISPLAY=1`: a new `cost in Xk · out Yk · $Z.ZZZZ` row renders between EmergencyTipBanner and CronMissedBanner in the BOTTOM slot, updating every time the agent loop records a turn (because the tracker is the same instance and React re-renders on session-state updates).
3. On exit (including SIGTERM / EOF / Ctrl+D): `~/.nuka/cost-history.json` exists and contains an entry under today's `YYYY-MM-DD` key with the session's tokens and per-model USD. Atomic write — no `.tmp-*` siblings.
4. `npx vitest run` is green; `npx tsc --noEmit` is clean.

---

## Notes for the implementer

- The existing `core/cost/{tracker,persist,pricing}.ts` are NOT to be rewritten. Read them before editing anything else so you understand the `CostTracker` shape — especially `snapshot()` (the entry list we fold into history) and `current(sessionId)` (per-session aggregate used in the banner).
- The legacy `StatusPanel` cost segment driven by `computeCost(pc, model, totalUsage)` is intentionally untouched. Per the "additive over replace" invariant, the env-opt-in banner is the new surface; the legacy segment stays as the always-on fallback.
- `installCostExitHook` uses synchronous fs inside the `'exit'` handler because Node guarantees only synchronous I/O completes during exit. The corresponding `flushHistoryNow` is async for callers (like `cli.tsx` graceful shutdown) that have a real event-loop tick to spend.
- No new npm dependencies. Everything uses `node:fs`, `node:os`, `node:path`, `ink`, `react`, and `vitest` — all already in `package.json`.
- Commit messages: imperative, no `Co-Authored-By:` line.
