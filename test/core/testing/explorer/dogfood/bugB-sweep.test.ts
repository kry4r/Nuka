// test/core/testing/explorer/dogfood/bugB-sweep.test.ts
//
// M6.T2 — Bug B reproduction via sweep across the 4 narrow profiles.
//
// Per plan §593, this test stays a SNAPSHOT of failure dumps that the
// pre-patch behavior produces. M6.T3 fixes the real Welcome/Messages
// code paths; the BugB-Snapshot fixture bakes the pre-patch symptoms
// into its render tree so this test continues to assert reproducible
// failure dumps even after the fix lands.
//
// Symptom coverage (per task: each failure cites B1 or B2):
//   - B1 (logo-overflow): noLossyTruncation at cols ∈ {60, 70, 79}.
//   - B2 (prologue-in-static): noStaticWrites at all 4 narrow profiles
//                              {60, 70, 79, 100}.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { sweep } from '../../../../../src/core/testing/explorer/sweep'

const FIXTURES_DIR = path.join(__dirname, '..', '..', '..', '..', 'ui-auto', 'fixtures')

// Use a dot-prefixed scratch root under /tmp so concurrent vitest workers
// don't collide (and so the .gitignore doesn't need a new pattern).
let SCRATCH: string

describe('M6.T2 — Bug B sweep snapshot', () => {
  beforeAll(() => {
    SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-bugb-sweep-'))
  })
  afterAll(() => {
    if (SCRATCH && fs.existsSync(SCRATCH)) {
      try { fs.rmSync(SCRATCH, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
  })

  it('produces failure records at all 4 narrow profiles for BugB-Snapshot', async () => {
    const result = await sweep({
      cwd: SCRATCH,
      fixturesGlob: FIXTURES_DIR,
    })

    const snapshotFailures = result.records.filter(
      (r) => r.component === 'BugB-Snapshot',
    )

    // We expect at least one failure per narrow profile.
    const narrowProfiles = [
      { cols: 60, rows: 30, name: 'narrow-compact' },
      { cols: 70, rows: 30, name: 'narrow-edge' },
      { cols: 79, rows: 24, name: 'pre-normal' },
      { cols: 100, rows: 30, name: 'normal' },
    ]

    for (const p of narrowProfiles) {
      const atProfile = snapshotFailures.filter(
        (r) => r.viewport.cols === p.cols && r.viewport.rows === p.rows,
      )
      expect(
        atProfile.length,
        `expected sweep to produce a failure at ${p.name} (${p.cols}x${p.rows}) ` +
          `but found ${atProfile.length}`,
      ).toBeGreaterThan(0)
    }
  })

  it('each failure cites either B1 (noLossyTruncation) or B2 (noStaticWrites)', async () => {
    const result = await sweep({
      cwd: SCRATCH,
      fixturesGlob: FIXTURES_DIR,
    })

    const snapshotFailures = result.records.filter(
      (r) => r.component === 'BugB-Snapshot',
    )
    expect(snapshotFailures.length).toBeGreaterThan(0)

    for (const rec of snapshotFailures) {
      const rules = rec.violations.map((v) => v.rule)
      const citesB1 = rules.includes('noLossyTruncation')
      const citesB2 = rules.includes('noStaticWrites')
      expect(
        citesB1 || citesB2,
        `failure ${rec.id} @ ${rec.viewport.cols}x${rec.viewport.rows} cites neither ` +
          `B1 (noLossyTruncation) nor B2 (noStaticWrites); rules: ${rules.join(',')}`,
      ).toBe(true)
    }
  })

  it('failure dumps land on disk and are readable as Markdown', async () => {
    await sweep({ cwd: SCRATCH, fixturesGlob: FIXTURES_DIR })

    const failuresDir = path.join(SCRATCH, '.ink-explorer', 'failures')
    expect(fs.existsSync(failuresDir)).toBe(true)

    const dumps = fs
      .readdirSync(failuresDir)
      .filter((f) => f.startsWith('bugb-snapshot-') && f.endsWith('.md'))
    expect(dumps.length).toBeGreaterThan(0)

    // Probe one dump for the canonical header (writer shape from M2/M5).
    const probe = fs.readFileSync(path.join(failuresDir, dumps[0]!), 'utf8')
    expect(probe).toMatch(/^# Failure dump:/m)
    expect(probe).toContain('BugB-Snapshot')
  })
})
