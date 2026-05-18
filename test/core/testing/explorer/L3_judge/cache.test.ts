// test/core/testing/explorer/L3_judge/cache.test.ts
//
// M4.T3 — RED-first tests for the directory-sharded JudgeCache.
//
// Deliberate divergence from locked spec §4.5: spec specifies a single
// `.ink-explorer/judge-cache.json` file; we use a directory-sharded layout
// `<root>/<componentHash[0..2]>/<fullHash>.json` to scale past 10k entries
// and avoid lock contention. The divergence is documented in cache.ts and
// in the plan deviation block.
//
// 3 tests:
//   1. put/get round-trip — store + retrieve a verdict by gridHash key.
//   2. miss on different viewportKey — same gridHash + same component but
//      different viewportKey returns null.
//   3. survives process restart — instantiate two JudgeCache pointing at
//      the same root; put via #1, get via #2.

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  JudgeCache,
  type JudgeVerdict,
} from '../../../../../src/core/testing/explorer/L3_judge/cache'

// ---------------------------------------------------------------------------
// Tmp scratch dir — dot-prefixed + .gitignored. afterEach + afterAll both
// call cleanup per the test-temp-cleanup memory rule.
// ---------------------------------------------------------------------------
const TMP_DIR = path.join(process.cwd(), '.tmp-judge-cache-test')

function ensureTmp(): string {
  const root = path.join(TMP_DIR, `run-${process.pid}-${Date.now()}`)
  fs.mkdirSync(root, { recursive: true })
  return root
}

function cleanup(): void {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
}

afterEach(cleanup)
afterAll(cleanup)

function makeVerdict(by: 'haiku' | 'opus' = 'haiku'): JudgeVerdict {
  return {
    ok: true,
    judgedBy: by,
    judgedAt: 1_700_000_000_000,
  }
}

describe('JudgeCache — round-trip + miss + restart', () => {
  it('put/get round-trip returns the same verdict instance shape', () => {
    const root = ensureTmp()
    const cache = new JudgeCache(root)
    const key = { gridHash: 'h0', component: 'PromptInput', viewportKey: '80x24' }
    const verdict = makeVerdict('haiku')
    cache.put(key, verdict)
    const got = cache.get(key)
    expect(got).not.toBeNull()
    expect(got!.ok).toBe(true)
    expect(got!.judgedBy).toBe('haiku')
    expect(got!.judgedAt).toBe(1_700_000_000_000)
  })

  it('returns null for a different viewportKey (collision avoidance)', () => {
    const root = ensureTmp()
    const cache = new JudgeCache(root)
    const baseKey = { gridHash: 'h0', component: 'PromptInput', viewportKey: '80x24' }
    cache.put(baseKey, makeVerdict('haiku'))
    const missKey = { ...baseKey, viewportKey: '160x50' }
    expect(cache.get(missKey)).toBeNull()
  })

  it('survives process restart — second JudgeCache instance reads entry written by the first', () => {
    const root = ensureTmp()
    const writer = new JudgeCache(root)
    const key = { gridHash: 'h-restart', component: 'Welcome', viewportKey: '120x36' }
    const verdict: JudgeVerdict = {
      ok: false,
      issues: [{ invariant: 'noBorderBleed', description: 'leak at col 0' }],
      judgedBy: 'opus',
      judgedAt: 1_700_000_001_234,
    }
    writer.put(key, verdict)

    // Simulate process restart with a fresh instance pointing at the same root.
    const reader = new JudgeCache(root)
    const got = reader.get(key)
    expect(got).not.toBeNull()
    expect(got!.ok).toBe(false)
    expect(got!.issues).toEqual([{ invariant: 'noBorderBleed', description: 'leak at col 0' }])
    expect(got!.judgedBy).toBe('opus')
    expect(got!.judgedAt).toBe(1_700_000_001_234)
  })
})
