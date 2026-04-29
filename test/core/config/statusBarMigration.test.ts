// test/core/config/statusBarMigration.test.ts
//
// Phase 13 §5.1 — statusBar.hidden segment id migration.
// Old ids (Phase 11 and earlier) migrate to the current six-segment id
// set; Phase 12 `cost-time` migrates to Phase 13 `cost`.

import { describe, it, expect } from 'vitest'
import { migrateStatusBarHidden } from '../../../src/core/config/load'

describe('migrateStatusBarHidden', () => {
  it('maps every old id to a new id', () => {
    expect(migrateStatusBarHidden(['model'])).toEqual(['model'])
    expect(migrateStatusBarHidden(['git'])).toEqual(['cwd'])
    expect(migrateStatusBarHidden(['ctx'])).toEqual(['context'])
    // old 'cost' → current 'cost' (direct pass-through)
    expect(migrateStatusBarHidden(['cost'])).toEqual(['cost'])
    // Phase 12 'cost-time' → Phase 13 'cost'
    expect(migrateStatusBarHidden(['cost-time'])).toEqual(['cost'])
    expect(migrateStatusBarHidden(['auto'])).toEqual(['counts'])
    expect(migrateStatusBarHidden(['queue'])).toEqual(['counts'])
    expect(migrateStatusBarHidden(['tasks'])).toEqual(['counts'])
    expect(migrateStatusBarHidden(['plugins'])).toEqual(['counts'])
    expect(migrateStatusBarHidden(['hint'])).toEqual(['counts'])
  })

  it('dedupes collisions (cwd + git both map to cwd)', () => {
    expect(migrateStatusBarHidden(['cwd', 'git'])).toEqual(['cwd'])
    // Multiple legacy ids fold into single `counts`.
    expect(migrateStatusBarHidden(['auto', 'queue', 'tasks', 'plugins'])).toEqual(['counts'])
  })

  it('dedupes cost-time + cost collision', () => {
    // Both Phase 12 cost-time and old cost map to current cost — should dedupe.
    expect(migrateStatusBarHidden(['cost-time', 'cost'])).toEqual(['cost'])
    expect(migrateStatusBarHidden(['cost', 'cost-time'])).toEqual(['cost'])
  })

  it('passes through ids already in the current space', () => {
    const ids = ['mode', 'model', 'cwd', 'context', 'cost', 'counts']
    expect(migrateStatusBarHidden(ids)).toEqual(ids)
  })

  it('handles empty / undefined inputs', () => {
    expect(migrateStatusBarHidden([])).toEqual([])
    expect(migrateStatusBarHidden(undefined)).toEqual([])
  })

  it('preserves ordering of first occurrence after mapping', () => {
    expect(migrateStatusBarHidden(['cost', 'cwd', 'git']))
      .toEqual(['cost', 'cwd'])
  })
})
