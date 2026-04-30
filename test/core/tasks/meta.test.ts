import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeMeta, readMeta } from '../../../src/core/tasks/meta'

describe('task meta sidecar', () => {
  let home: string
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-meta-')) })

  it('round-trips a meta record', () => {
    fs.mkdirSync(path.join(home, '.nuka', 'tasks'), { recursive: true })
    writeMeta(home, {
      id: 'a1', kind: 'local_bash', state: 'completed', startedAt: 1, finishedAt: 2,
    })
    const back = readMeta(home, 'a1')
    expect(back?.id).toBe('a1')
    expect(back?.state).toBe('completed')
  })

  it('returns undefined when the meta file is missing', () => {
    expect(readMeta(home, 'nope')).toBeUndefined()
  })

  it('returns undefined when the meta file is corrupt JSON', () => {
    const dir = path.join(home, '.nuka', 'tasks')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'corrupt.meta.json'), '{not json')
    expect(readMeta(home, 'corrupt')).toBeUndefined()
  })
})
