// test/core/config/statusBarMigration.test.ts
//
// Phase 12 §5.1 — old statusBar.hidden segment ids migrate to the new
// six-segment id set, with collisions deduped.

import { describe, it, expect } from 'vitest'
import { migrateStatusBarHidden } from '../../../src/core/config/load'

describe('migrateStatusBarHidden', () => {
  it('maps every old id to a new id', () => {
    expect(migrateStatusBarHidden(['model'])).toEqual(['model'])
    expect(migrateStatusBarHidden(['git'])).toEqual(['cwd'])
    expect(migrateStatusBarHidden(['ctx'])).toEqual(['context'])
    expect(migrateStatusBarHidden(['cost'])).toEqual(['cost-time'])
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

  it('passes through ids already in the new space', () => {
    const ids = ['mode', 'model', 'cwd', 'context', 'cost-time', 'counts']
    expect(migrateStatusBarHidden(ids)).toEqual(ids)
  })

  it('handles empty / undefined inputs', () => {
    expect(migrateStatusBarHidden([])).toEqual([])
    expect(migrateStatusBarHidden(undefined)).toEqual([])
  })

  it('preserves ordering of first occurrence after mapping', () => {
    expect(migrateStatusBarHidden(['cost', 'cwd', 'git']))
      .toEqual(['cost-time', 'cwd'])
  })
})
