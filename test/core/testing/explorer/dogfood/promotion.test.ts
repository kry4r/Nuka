// test/core/testing/explorer/dogfood/promotion.test.ts
//
// M6.T4 — assert the M6.T1 promoted regression fixture exists at the
// expected path AND re-runs cleanly under sweep.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { sweep } from '../../../../../src/core/testing/explorer/sweep'

const PROMOTED_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'ui-auto',
  'fixtures',
  'BugA-TodoWritePromptSurface',
  'regression-bug-a-001.fixtures.tsx',
)

const PROMOTED_DIR = path.dirname(PROMOTED_PATH)

let SCRATCH: string

describe('M6.T4 — promotion check', () => {
  beforeAll(() => {
    SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-promotion-'))
  })
  afterAll(() => {
    if (SCRATCH && fs.existsSync(SCRATCH)) {
      try { fs.rmSync(SCRATCH, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
  })

  it('promoted Bug A regression fixture exists on disk', () => {
    expect(fs.existsSync(PROMOTED_PATH)).toBe(true)
  })

  it('promoted fixture re-runs cleanly under sweep', async () => {
    const result = await sweep({
      cwd: SCRATCH,
      // Point fixturesGlob at just the promoted-fixture subdir so this
      // test doesn't drag in the BugB-Snapshot failure noise from M6.T2.
      fixturesGlob: PROMOTED_DIR,
    })
    expect(result.totalRuns).toBeGreaterThan(0)
    expect(result.failed).toBe(0)
  })
})
