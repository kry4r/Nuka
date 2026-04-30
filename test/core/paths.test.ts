import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ensureNukaLayout, teamsDir, recapsDir, forksDir, eventsDir } from '../../src/core/paths'

describe('ensureNukaLayout', () => {
  let home: string
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-paths-')) })

  it('creates all 5 dirs idempotently', () => {
    ensureNukaLayout(home)
    ensureNukaLayout(home)
    expect(fs.existsSync(teamsDir(home))).toBe(true)
    expect(fs.existsSync(recapsDir(home))).toBe(true)
    expect(fs.existsSync(forksDir(home))).toBe(true)
    expect(fs.existsSync(eventsDir(home))).toBe(true)
  })
})
