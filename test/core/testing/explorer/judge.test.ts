// test/core/testing/explorer/judge.test.ts
//
// M4.T4 — RED-first tests for the two-tier judge() orchestrator.
// See locked spec §4.5 (two-tier flow + cost guards).
//
// 3 tests + 1 CLI smoke:
//   1. Haiku says "clean" → no Opus call; verdict persisted in cache;
//      verdict.judgedBy === 'haiku'; verdict.ok === true.
//   2. Haiku says "issues" → Opus call → verdict.judgedBy === 'opus' with
//      issues[] enumerated.
//   3. 201st failure → no Haiku call (cap hit), budgetHit.haiku === true,
//      warning logged, partial verdicts (the first 200) flushed.
//   4. CLI smoke — `nuka explore judge --re-judge` propagates the flag.

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { judge } from '../../../../src/core/testing/explorer/judge'
import { JudgeCache } from '../../../../src/core/testing/explorer/L3_judge/cache'
import type { FailureRecord } from '../../../../src/core/testing/explorer/types'

// ---------------------------------------------------------------------------
// Tmp scratch dir — dot-prefixed + .gitignored. afterEach + afterAll both
// call cleanup per the test-temp-cleanup memory rule.
// ---------------------------------------------------------------------------
const TMP_DIR = path.join(process.cwd(), '.tmp-judge-test')

function ensureTmpRoot(): string {
  const root = path.join(TMP_DIR, `run-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(root, { recursive: true })
  return root
}

function cleanup(): void {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
}

afterEach(cleanup)
afterAll(cleanup)

// ---------------------------------------------------------------------------
// FailureRecord factory — minimal shape needed for the judge contract.
// ---------------------------------------------------------------------------
function makeFailure(i: number): FailureRecord {
  return {
    id: `fail-${i}`,
    component: 'PromptInput',
    fixtureCase: 'truncated',
    viewport: { cols: 80, rows: 24 },
    violations: [
      {
        rule: 'noLossyTruncation',
        severity: 'error',
        message: `missing mustContain #${i}`,
      },
    ],
    asciiView: `grid-${i}`,
    gridHash: `hash-${i}`,
    timestamp: '2026-05-18T00:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// Mock client factory. Returns a stub callMessages + the call log so each
// test can assert haiku-only / haiku+opus / no-call behaviour.
// ---------------------------------------------------------------------------
type CallLog = Array<{ model: string; user: string }>

function makeMockClient(behaviour: {
  haikuClean?: boolean
  haikuIssues?: boolean
  opusIssues?: { invariant: string; description: string }[]
}): { client: typeof import('../../../../src/core/testing/explorer/L3_judge/client').callMessages; calls: CallLog } {
  const calls: CallLog = []
  const client = vi.fn(async (opts: { model: string; system: string; user: string }) => {
    calls.push({ model: opts.model, user: opts.user })
    if (opts.model === 'claude-haiku-4-5-20251001') {
      if (behaviour.haikuClean) {
        return {
          text: JSON.stringify({ issues: false, why: '' }),
          usage: { inTok: 1, outTok: 1 },
        }
      }
      if (behaviour.haikuIssues) {
        return {
          text: JSON.stringify({ issues: true, why: 'border bleed suspected' }),
          usage: { inTok: 1, outTok: 1 },
        }
      }
    }
    if (opts.model === 'claude-opus-4-7') {
      return {
        text: JSON.stringify({ issues: behaviour.opusIssues ?? [] }),
        usage: { inTok: 1, outTok: 1 },
      }
    }
    return { text: '', usage: { inTok: 0, outTok: 0 } }
  }) as unknown as typeof import('../../../../src/core/testing/explorer/L3_judge/client').callMessages
  return { client, calls }
}

// ---------------------------------------------------------------------------
let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warnSpy.mockRestore()
})

// ---------------------------------------------------------------------------
// 1. Haiku says "clean" → no Opus call; verdict persisted; judgedBy=haiku.
// ---------------------------------------------------------------------------
describe('judge — Haiku clean path', () => {
  it('emits clean verdict, no Opus call, writes to cache', async () => {
    const cacheRoot = ensureTmpRoot()
    const { client, calls } = makeMockClient({ haikuClean: true })
    const failures = [makeFailure(0)]

    const result = await judge({
      failures,
      apiKey: 'sk-test',
      cacheRoot,
      _client: client,
    } as Parameters<typeof judge>[0])

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]!.ok).toBe(true)
    expect(result.verdicts[0]!.judgedBy).toBe('haiku')
    expect(result.budgetHit).toEqual({ haiku: false, opus: false })

    // No Opus call.
    const opusCalls = calls.filter((c) => c.model === 'claude-opus-4-7')
    expect(opusCalls).toHaveLength(0)

    // Cache populated — second invocation should hit cache (zero new calls).
    const cache = new JudgeCache(cacheRoot)
    const cached = cache.get({
      gridHash: failures[0]!.gridHash!,
      component: failures[0]!.component,
      viewportKey: '80x24',
    })
    expect(cached).not.toBeNull()
    expect(cached!.judgedBy).toBe('haiku')

    // forceReJudge bypasses the cache: re-invoke with same failure +
    // forceReJudge=true and observe a fresh Haiku call.
    const callsBefore = calls.length
    await judge({
      failures,
      apiKey: 'sk-test',
      cacheRoot,
      forceReJudge: true,
      _client: client,
    } as Parameters<typeof judge>[0])
    expect(calls.length).toBeGreaterThan(callsBefore)
  })
})

// ---------------------------------------------------------------------------
// 2. Haiku says "issues" → Opus call → verdict with structured issues[].
// ---------------------------------------------------------------------------
describe('judge — Haiku-issues escalates to Opus', () => {
  it('emits opus verdict with structured issues[]', async () => {
    const cacheRoot = ensureTmpRoot()
    const { client, calls } = makeMockClient({
      haikuIssues: true,
      opusIssues: [
        { invariant: 'noBorderBleed', description: 'leak at row 0 col 80' },
      ],
    })
    const failures = [makeFailure(0)]

    const result = await judge({
      failures,
      apiKey: 'sk-test',
      cacheRoot,
      _client: client,
    } as Parameters<typeof judge>[0])

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]!.judgedBy).toBe('opus')
    expect(result.verdicts[0]!.ok).toBe(false)
    expect(result.verdicts[0]!.issues).toEqual([
      { invariant: 'noBorderBleed', description: 'leak at row 0 col 80' },
    ])

    // Both Haiku + Opus were called.
    const haikuCalls = calls.filter((c) => c.model === 'claude-haiku-4-5-20251001')
    const opusCalls = calls.filter((c) => c.model === 'claude-opus-4-7')
    expect(haikuCalls).toHaveLength(1)
    expect(opusCalls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 3. Budget cap: 201st failure → no Haiku call, budgetHit.haiku=true,
//    warning logged, verdicts 1..200 still returned.
// ---------------------------------------------------------------------------
describe('judge — Haiku budget cap', () => {
  it('201st failure short-circuits with budgetHit.haiku=true + warning', async () => {
    const cacheRoot = ensureTmpRoot()
    const { client, calls } = makeMockClient({ haikuClean: true })
    const failures: FailureRecord[] = []
    for (let i = 0; i < 201; i++) failures.push(makeFailure(i))

    const result = await judge({
      failures,
      apiKey: 'sk-test',
      cacheRoot,
      maxHaiku: 200,
      maxOpus: 20,
      _client: client,
    } as Parameters<typeof judge>[0])

    // 200 Haiku calls total — 201st is skipped.
    const haikuCalls = calls.filter((c) => c.model === 'claude-haiku-4-5-20251001')
    expect(haikuCalls).toHaveLength(200)

    // Budget hit reported.
    expect(result.budgetHit.haiku).toBe(true)
    // Opus never called (Haiku said clean for all 200).
    expect(result.budgetHit.opus).toBe(false)

    // Partial verdicts returned — exactly the 200 we processed.
    expect(result.verdicts).toHaveLength(200)

    // Warning logged.
    expect(warnSpy).toHaveBeenCalled()
    const warnMsg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warnMsg.toLowerCase()).toContain('haiku')
    expect(warnMsg.toLowerCase()).toMatch(/cap|budget|limit/)
  })
})

// ---------------------------------------------------------------------------
// 4. Opus budget cap: 21 failures, maxOpus=20 → 21st gets a marker verdict
//    (opus_cap_exhausted), persisted to cache, warning logged.
// ---------------------------------------------------------------------------
describe('judge — Opus budget cap', () => {
  it('opus cap exhausted → marker verdict persisted to cache', async () => {
    const cacheRoot = ensureTmpRoot()
    // Haiku always says "issues" so every failure escalates to Opus.
    const { client, calls } = makeMockClient({
      haikuIssues: true,
      opusIssues: [{ invariant: 'noBorderBleed', description: 'test' }],
    })
    const failures: FailureRecord[] = []
    for (let i = 0; i < 21; i++) failures.push(makeFailure(i))

    const result = await judge({
      failures,
      apiKey: 'test',
      cacheRoot,
      maxHaiku: 50,
      maxOpus: 20,
      _client: client,
    } as Parameters<typeof judge>[0])

    // All 21 verdicts returned (no early break on opus cap).
    expect(result.verdicts.length).toBe(21)
    expect(result.budgetHit.opus).toBe(true)

    // The 21st verdict (index 20) is the marker — judgedBy haiku with sentinel.
    expect(result.verdicts[20]!.judgedBy).toBe('haiku')
    expect(result.verdicts[20]!.issues?.[0]?.invariant).toBe('opus_cap_exhausted')

    // Sentinel verdict WAS persisted to cache — verify via fresh JudgeCache.
    const cache2 = new JudgeCache(cacheRoot)
    const persisted = cache2.get({
      gridHash: failures[20]!.gridHash!,
      component: failures[20]!.component,
      viewportKey: '80x24',
    })
    expect(persisted).not.toBeNull()
    expect(persisted!.issues?.[0]?.invariant).toBe('opus_cap_exhausted')

    // Warning was logged containing 'opus'.
    expect(warnSpy).toHaveBeenCalled()
    const warnMsg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warnMsg.toLowerCase()).toContain('opus')
  })
})

// ---------------------------------------------------------------------------
// 5. CLI smoke — `nuka explore judge --re-judge --dump=<path>` parses the flag
//    and propagates it through to judge() so a pre-populated cache entry is
//    bypassed. Exercises the runExploreCli argv → judge() wiring end-to-end.
// ---------------------------------------------------------------------------
describe('judge — CLI parses --re-judge and propagates to judge()', () => {
  it('runExploreCli judge --re-judge bypasses an existing cache entry', async () => {
    const explorerBase = ensureTmpRoot()
    const failuresDir = path.join(explorerBase, 'failures')
    fs.mkdirSync(failuresDir, { recursive: true })

    // Write a minimal failures JSON the CLI's --dump=<path> branch reads.
    const failure = makeFailure(0)
    const dumpPath = path.join(failuresDir, 'dump.json')
    fs.writeFileSync(dumpPath, JSON.stringify([failure]), 'utf8')

    // Pre-populate cache with a stale Opus verdict — re-judge must ignore it.
    const cache = new JudgeCache(path.join(explorerBase, 'judge-cache'))
    cache.put(
      {
        gridHash: failure.gridHash!,
        component: failure.component,
        viewportKey: '80x24',
      },
      {
        ok: false,
        judgedBy: 'opus',
        judgedAt: 1,
        issues: [{ invariant: 'stale-cached', description: 'should be ignored' }],
      },
    )

    const { client, calls } = makeMockClient({ haikuClean: true })
    const { __setJudgeClientForTest, judge: _judge } = await import(
      '../../../../src/core/testing/explorer/judge'
    )
    _judge // keep import live (also confirms the export name)
    __setJudgeClientForTest(client)

    const prevKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-cli-test'

    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)

    const { runExploreCli } = await import(
      '../../../../src/core/testing/explorer/index'
    )
    const code = await runExploreCli([
      'judge',
      '--re-judge',
      `--dump=${dumpPath}`,
      `--out=${explorerBase}`,
    ])

    stdoutSpy.mockRestore()
    __setJudgeClientForTest(null)
    if (prevKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = prevKey
    }

    expect(code).toBe(0)
    // Cache was bypassed → at least one Haiku call was issued.
    const haikuCalls = calls.filter(
      (c) => c.model === 'claude-haiku-4-5-20251001',
    )
    expect(haikuCalls.length).toBeGreaterThanOrEqual(1)
  })
})

