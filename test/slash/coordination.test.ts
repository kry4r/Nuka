// test/slash/coordination.test.ts
//
// T8.2 — /coordination slash command tests.
import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { makeCoordinationCommand } from '../../src/slash/coordination'
import { TaskGraph } from '../../src/core/coordination/taskGraph'
import { saveGraph } from '../../src/core/coordination/persist'

function tmpFile(suffix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-coord-slash-'))
  return path.join(dir, suffix)
}

function fakeRouter(send = vi.fn().mockResolvedValue(true)): { send: typeof send } {
  return { send }
}

describe('/coordination', () => {
  it('without args returns usage', async () => {
    const graphPath = tmpFile('graph.json')
    const subsPath = tmpFile('subs.json')
    const cmd = makeCoordinationCommand({
      graphPath: () => graphPath,
      subsPath: () => subsPath,
      router: fakeRouter() as any,
    })
    const result = await cmd.run('', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/usage/i)
  })

  it('status with no graph file says (no graph yet)', async () => {
    const graphPath = tmpFile('graph.json')
    const subsPath = tmpFile('subs.json')
    const cmd = makeCoordinationCommand({
      graphPath: () => graphPath,
      subsPath: () => subsPath,
      router: fakeRouter() as any,
    })
    const result = await cmd.run('status', {} as any)
    expect(result.type).toBe('text')
    const text = (result as any).text as string
    expect(text).toMatch(/no graph/i)
    expect(text).toMatch(/subscriptions:\s*0/i)
  })

  it('status renders nodes, correlations, and subscriptions when present', async () => {
    const graphPath = tmpFile('graph.json')
    const subsPath = tmpFile('subs.json')
    const g = new TaskGraph({ rootMessage: 'do the thing', difficulty: 'hard' })
    g.add({ id: 't1', title: 'design', profile: 'feature', testStrategy: 'tdd', agentId: null, status: 'done', dependsOn: [], contextFor: ['t2'], result: { summary: 'design ok', artifacts: [] } })
    g.add({ id: 't2', title: 'build',  profile: 'feature', testStrategy: 'tdd', agentId: null, status: 'pending', dependsOn: ['t1'], contextFor: [], result: null })
    g.link('t1', 't2', 'sequential')
    saveGraph(graphPath, g)
    fs.writeFileSync(
      subsPath,
      JSON.stringify([
        { subscriberAgentId: 'agentA', ownsTaskId: 't1', triggersOn: ['t2'], triggerCount: 1, lifecycle: 'until-correlated-tasks-done' },
      ]),
    )

    const cmd = makeCoordinationCommand({
      graphPath: () => graphPath,
      subsPath: () => subsPath,
      router: fakeRouter() as any,
    })
    const result = await cmd.run('status', {} as any)
    const text = (result as any).text as string
    expect(text).toContain('do the thing')
    expect(text).toContain('hard')
    expect(text).toContain('t1')
    expect(text).toContain('t2')
    expect(text).toContain('done')
    expect(text).toContain('pending')
    expect(text).toContain('agentA')
    expect(text).toMatch(/correlations:\s*1/i)
    expect(text).toMatch(/subscriptions:\s*1/i)
  })

  it('a2a-send with too few tokens prints usage', async () => {
    const cmd = makeCoordinationCommand({
      graphPath: () => '/no',
      subsPath: () => '/no',
      router: fakeRouter() as any,
    })
    const result = await cmd.run('a2a-send agentA agentB', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/usage/i)
  })

  it('a2a-send delegates to the router and reports delivery', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const cmd = makeCoordinationCommand({
      graphPath: () => '/no',
      subsPath: () => '/no',
      router: { send } as any,
    })
    const result = await cmd.run('a2a-send agentA agentB hey there bud', {} as any)
    expect(send).toHaveBeenCalledTimes(1)
    const env = send.mock.calls[0]![0]
    expect(env.from).toBe('agentA')
    expect(env.to).toBe('agentB')
    expect(env.message).toContain('hey there bud')
    const text = (result as any).text as string
    expect(text).toMatch(/delivered/i)
  })

  it('a2a-send reports failure when the router cannot deliver', async () => {
    const send = vi.fn().mockResolvedValue(false)
    const cmd = makeCoordinationCommand({
      graphPath: () => '/no',
      subsPath: () => '/no',
      router: { send } as any,
    })
    const result = await cmd.run('a2a-send agentA agentB nope', {} as any)
    expect((result as any).text).toMatch(/not delivered|failed/i)
  })

  it('rejects unknown subcommands', async () => {
    const cmd = makeCoordinationCommand({
      graphPath: () => '/no',
      subsPath: () => '/no',
      router: fakeRouter() as any,
    })
    const result = await cmd.run('purge', {} as any)
    expect((result as any).text).toMatch(/unknown/i)
  })
})
