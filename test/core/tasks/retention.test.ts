import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runRetentionSweep } from '../../../src/core/tasks/retention'

describe('runRetentionSweep', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-ret-'))
    fs.mkdirSync(path.join(home, '.nuka', 'tasks'), { recursive: true })
    fs.mkdirSync(path.join(home, '.nuka', 'forks', 'parent-1'), { recursive: true })
  })

  it('deletes task .log + .meta.json older than 14 days', () => {
    const tasks = path.join(home, '.nuka', 'tasks')
    const oldLog = path.join(tasks, 'old.log')
    const oldMeta = path.join(tasks, 'old.meta.json')
    fs.writeFileSync(oldLog, 'x'); fs.writeFileSync(oldMeta, '{}')
    const oldT = Date.now() - 30 * 24 * 60 * 60 * 1000
    fs.utimesSync(oldLog, oldT / 1000, oldT / 1000)
    fs.utimesSync(oldMeta, oldT / 1000, oldT / 1000)
    const fresh = path.join(tasks, 'fresh.log')
    fs.writeFileSync(fresh, 'x')
    runRetentionSweep(home, { now: Date.now() })
    expect(fs.existsSync(oldLog)).toBe(false)
    expect(fs.existsSync(oldMeta)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
  })

  it('deletes forks/<parent>/<id>.json older than 24h', () => {
    const f = path.join(home, '.nuka', 'forks', 'parent-1', 'old.json')
    fs.writeFileSync(f, '{}')
    fs.utimesSync(f, (Date.now() - 48 * 3600 * 1000) / 1000, (Date.now() - 48 * 3600 * 1000) / 1000)
    runRetentionSweep(home, { now: Date.now() })
    expect(fs.existsSync(f)).toBe(false)
  })
})
