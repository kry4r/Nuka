// test/integration/phase14b-monitor.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { TasksPanelNew } from '../../src/tui/Tasks/TasksPanelNew'
import { columnReducer, initialColumns } from '../../src/tui/Tasks/columnReducer'

describe('phase14b end-to-end', () => {
  it('synthetic events → 5-column render', () => {
    let s = initialColumns()
    s = columnReducer(s, { topic: 'task', payload: { type: 'task.created', task: { id: 't1', kind: 'in_process_teammate', description: 'd', state: 'running', outputFile: '', spec: {} as never, agentName: 'alice', teamName: 'demo' } as never } })
    s = columnReducer(s, { topic: 'task', payload: { type: 'task.created', task: { id: 't2', kind: 'local_bash', description: 'echo', state: 'completed', outputFile: '', spec: {} as never } as never } })
    s = columnReducer(s, { topic: 'message', payload: { type: 'message.sent', envelope: { id: 'm1', from: 'lead', to: 'team:demo/alice', summary: 'go', message: 'go', sentAt: 0 } } })
    const out = render(<TasksPanelNew state={s} focus={{ kind: 'prompt' }} cols={120} />).lastFrame() ?? ''
    expect(out).toContain('alice')
    expect(out).toContain('echo')
    expect(out).toContain('lead')
  })
})
