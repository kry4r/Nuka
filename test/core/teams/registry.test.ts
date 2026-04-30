import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TeamRegistry } from '../../../src/core/teams/registry'

describe('TeamRegistry', () => {
  let home: string
  let r: TeamRegistry
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-team-'))
    r = new TeamRegistry({ home })
  })

  it('create persists to disk and returns a Team', async () => {
    const t = await r.create('demo', 'demo team')
    expect(t.name).toBe('demo')
    expect(t.taskListId).toBeTruthy()
    expect(t.members.length).toBe(0)
    const file = path.join(home, '.nuka', 'teams', 'demo', 'config.json')
    expect(fs.existsSync(file)).toBe(true)
  })

  it('rejects duplicate name', async () => {
    await r.create('demo', '')
    await expect(r.create('demo', '')).rejects.toThrow(/already exists/)
  })

  it('addMember persists and roundtrips', async () => {
    await r.create('demo', '')
    await r.addMember('demo', { agentName: 'alice', agentDefRef: 'plug:alice', spawnedAt: 1 })
    const r2 = new TeamRegistry({ home })
    const t = r2.find('demo')!
    expect(t.members.map(m => m.agentName)).toEqual(['alice'])
  })

  it('removeMember persists', async () => {
    await r.create('demo', '')
    await r.addMember('demo', { agentName: 'alice', agentDefRef: 'plug:alice', spawnedAt: 1 })
    await r.addMember('demo', { agentName: 'bob', agentDefRef: 'plug:bob', spawnedAt: 2 })
    await r.removeMember('demo', 'alice')
    expect(r.find('demo')!.members.map(m => m.agentName)).toEqual(['bob'])
  })

  it('delete removes config file', async () => {
    await r.create('demo', '')
    await r.delete('demo')
    expect(r.find('demo')).toBeUndefined()
    const file = path.join(home, '.nuka', 'teams', 'demo', 'config.json')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('rejects invalid name', async () => {
    await expect(r.create('Bad Name', '')).rejects.toThrow()
  })
})
