// test/tui/Tasks/columnReducer.test.ts
import { describe, it, expect } from 'vitest'
import { columnReducer, initialColumns } from '../../../src/tui/Tasks/columnReducer'

describe('columnReducer', () => {
  it('task.created adds row to subagent column when kind=in_process_teammate', () => {
    const s0 = initialColumns()
    const s1 = columnReducer(s0, { topic: 'task', payload: { type: 'task.created', task: { id: 't1', kind: 'in_process_teammate', description: 'd', state: 'running', outputFile: '', spec: {} as never, agentName: 'alice', teamName: 'demo' } as never } })
    expect(s1.subagent.rows.length).toBe(1)
    expect(s1.subagent.rows[0]!.id).toBe('t1')
  })

  it('task.state updates row status', () => {
    const s0 = initialColumns()
    const s1 = columnReducer(s0, { topic: 'task', payload: { type: 'task.created', task: { id: 't1', kind: 'local_bash', description: 'd', state: 'running', outputFile: '', spec: {} as never } as never } })
    const s2 = columnReducer(s1, { topic: 'task', payload: { type: 'task.state', id: 't1', from: 'running', to: 'completed' } })
    expect(s2.background.rows[0]!.status).toBe('completed')
  })

  it('task.evicted removes row', () => {
    const s0 = initialColumns()
    const s1 = columnReducer(s0, { topic: 'task', payload: { type: 'task.created', task: { id: 't1', kind: 'local_bash', description: 'd', state: 'completed', outputFile: '', spec: {} as never } as never } })
    const s2 = columnReducer(s1, { topic: 'task', payload: { type: 'task.evicted', id: 't1' } })
    expect(s2.background.rows.length).toBe(0)
  })

  it('message.sent adds to messages column', () => {
    const s0 = initialColumns()
    const s1 = columnReducer(s0, { topic: 'message', payload: { type: 'message.sent', envelope: { id: 'm1', from: 'lead', to: 'team:demo/alice', summary: 'hi', message: 'hi', sentAt: 0 } } })
    expect(s1.message.rows.length).toBe(1)
    expect(s1.message.rows[0]!.primary).toContain('lead')
  })

  it('caps each column at 16', () => {
    let s = initialColumns()
    for (let i = 0; i < 25; i++) {
      s = columnReducer(s, { topic: 'message', payload: { type: 'message.sent', envelope: { id: `m${i}`, from: 'a', to: 'b', summary: `s${i}`, message: 'x', sentAt: i } } })
    }
    expect(s.message.rows.length).toBe(16)
    expect(s.message.rows[0]!.id).toBe('m24')        // newest first
  })
})
