// test/core/testing/explorer/sweep/fixtureLoader.test.ts
//
// M2.T1 — RED-first tests for fixtureLoader + viewportMatrix.
// These test four things:
//   1. loadFixtures discovers the regression fixtures in test/ui-auto/fixtures
//   2. resolveViewports returns the 7-profile default when fixture says 'default'
//   3. resolveViewports honours per-fixture viewport override
//   4. Empty directory returns empty array; non-fixture files are skipped

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'path'
import fs from 'fs'
import type { FixtureDef, Viewport } from '../../../../../src/core/testing/explorer/types'
import {
  loadFixtures,
  resolveViewports,
  type LoadedFixture,
} from '../../../../../src/core/testing/explorer/sweep/fixtureLoader'
import { VIEWPORT_PROFILES } from '../../../../../src/core/testing/explorer/sweep/viewportMatrix'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FIXTURES_DIR = path.join(__dirname, '../../../../ui-auto/fixtures')
const TMP_DIR = path.join(__dirname, '../../../../../.tmp-fixture-loader-test')

function ensureTmp() {
  fs.mkdirSync(TMP_DIR, { recursive: true })
}

function cleanTmp() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 1. discovers both M1 regression fixtures
// ---------------------------------------------------------------------------
describe('loadFixtures — discovery', () => {
  it('discovers both regression fixtures in test/ui-auto/fixtures', async () => {
    const loaded = await loadFixtures(FIXTURES_DIR)
    const names = loaded.map((f) => path.basename(f.path))
    expect(names).toContain('regression-bug-a.fixtures.tsx')
    expect(names).toContain('regression-bug-b.fixtures.tsx')
    expect(loaded.length).toBeGreaterThanOrEqual(2)
  })

  it('loaded FixtureDefs have component + cases', async () => {
    const loaded = await loadFixtures(FIXTURES_DIR)
    for (const { fixture } of loaded) {
      expect(typeof fixture.component).toBe('string')
      expect(fixture.component.length).toBeGreaterThan(0)
      expect(typeof fixture.cases).toBe('object')
      expect(Object.keys(fixture.cases).length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. per-fixture viewport override is honoured
// ---------------------------------------------------------------------------
describe('resolveViewports — override', () => {
  it('returns the 7 default profiles when viewports is "default"', () => {
    const fakeDef: FixtureDef = {
      component: 'Test',
      cases: {},
      viewports: 'default',
    }
    const vps = resolveViewports(fakeDef)
    expect(vps).toHaveLength(VIEWPORT_PROFILES.length)
    expect(vps).toHaveLength(7)
    // spot-check one profile
    const narrow = vps.find((v) => v.cols === 60 && v.rows === 30)
    expect(narrow).toBeDefined()
  })

  it('returns per-fixture override when viewports is an array', () => {
    const customViewports: Viewport[] = [
      { cols: 42, rows: 10 },
      { cols: 200, rows: 50 },
    ]
    const fakeDef: FixtureDef = {
      component: 'Test',
      cases: {},
      viewports: customViewports,
    }
    const vps = resolveViewports(fakeDef)
    expect(vps).toHaveLength(2)
    expect(vps[0]).toEqual({ cols: 42, rows: 10 })
  })
})

// ---------------------------------------------------------------------------
// 3. glob boundaries
// ---------------------------------------------------------------------------
describe('loadFixtures — glob boundaries', () => {
  beforeAll(() => {
    ensureTmp()
  })

  afterAll(() => {
    cleanTmp()
  })

  it('returns empty array for an empty directory', async () => {
    const loaded = await loadFixtures(TMP_DIR)
    expect(loaded).toHaveLength(0)
  })

  it('ignores non-fixture files (e.g. .ts files, README.md)', async () => {
    const nonFixture = path.join(TMP_DIR, 'helper.ts')
    fs.writeFileSync(nonFixture, 'export const x = 1\n', 'utf8')
    const mdFile = path.join(TMP_DIR, 'README.md')
    fs.writeFileSync(mdFile, '# hello\n', 'utf8')

    const loaded = await loadFixtures(TMP_DIR)
    expect(loaded).toHaveLength(0)
  })
})
