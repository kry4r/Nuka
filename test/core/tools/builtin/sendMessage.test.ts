import { describe, it, expect, beforeEach } from 'vitest'
import { createEventBus } from '../../../../src/core/events/bus'
import { MessageRouter } from '../../../../src/core/messaging/router'
import { InProcessBackend } from '../../../../src/core/messaging/inProcessBackend'
import { TeamRegistry } from '../../../../src/core/teams/registry'
import { makeSendMessageTool } from '../../../../src/core/tools/builtin/sendMessage'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'

describe('send_message', () => {
  let home: string; let teams: TeamRegistry; let backend: InProcessBackend
  let router: MessageRouter; let tool: ReturnType<typeof makeSendMessageTool>
  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-sm-'))
    teams = new TeamRegistry({ home })
    await teams.create('demo', '')
    await teams.addMember('demo', { agentName: 'bob', agentDefRef: 'core:bob', spawnedAt: 1 })
    backend = new InProcessBackend()
    router = new MessageRouter({ backends: [backend], bus: createEventBus() })
    tool = makeSendMessageTool({ router, teams })
  })

  it('delivers to bare name resolved against caller team', async () => {
    let got = 0; backend.subscribe('team:demo/bob', () => got++)
    const ctx = { session: { teamName: 'demo', agentName: 'alice' } } as never
    const r = await tool.run({ to: 'bob', summary: 'hi', message: 'hey' }, ctx)
    expect(r.isError).toBe(false)
    expect(got).toBe(1)
  })

  it('rejects bare name with no team context', async () => {
    const ctx = { session: {} } as never
    const r = await tool.run({ to: 'bob', summary: 'hi', message: 'hey' }, ctx)
    expect(r.isError).toBe(true)
  })

  it('broadcasts with *', async () => {
    let n = 0; backend.subscribe('team:demo/bob', () => n++)
    const ctx = { session: { teamName: 'demo', agentName: 'alice' } } as never
    const r = await tool.run({ to: '*', summary: 'all', message: 'broadcast' }, ctx)
    expect(r.isError).toBe(false)
    expect(n).toBeGreaterThanOrEqual(1)
  })

  it('broadcasts with team:X/* coordinator form to all team members', async () => {
    // Add a second member to demo team
    await teams.addMember('demo', { agentName: 'carol', agentDefRef: 'core:carol', spawnedAt: 2 })
    let bobCount = 0; let carolCount = 0
    backend.subscribe('team:demo/bob', () => bobCount++)
    backend.subscribe('team:demo/carol', () => carolCount++)
    // Lead coordinator (no teamName context) uses qualified team:demo/* address
    const ctx = { session: { agentName: 'lead' } } as never
    const r = await tool.run({ to: 'team:demo/*', summary: 'broadcast all', message: 'hello all' }, ctx)
    expect(r.isError).toBe(false)
    const result = JSON.parse(r.output as string)
    expect(result.delivered).toBe(true)
    expect(result.count).toBeGreaterThanOrEqual(2)
    expect(bobCount).toBe(1)
    expect(carolCount).toBe(1)
  })
})
