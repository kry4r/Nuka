// test/tui/Tasks/SubagentDetail.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import stripAnsi from 'strip-ansi'
import { SubagentDetail } from '../../../src/tui/Tasks/SubagentDetail'

// Strip ANSI escape codes for reliable string matching
function strip(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

describe('SubagentDetail', () => {
  it('renders header + activity rail', () => {
    const out = strip(render(<SubagentDetail
      taskId="t1" agentName="alice" teamName="demo" status="running"
      conversation={[{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]}
      activities={[{ toolName: 'Read', input: { file: 'x.ts' }, activityDescription: 'Reading x.ts' }]}
      planAwaitingApproval={undefined}
      onInjectMessage={vi.fn()} onPause={vi.fn()} onKill={vi.fn()} onShutdown={vi.fn()}
      onApprovePlan={vi.fn()} onRejectPlan={vi.fn()}
    />).lastFrame() ?? '')
    expect(out).toContain('alice')
    expect(out).toContain('demo')
    expect(out).toContain('Reading x.ts')
  })

  it('shows plan-approval prompt when present', () => {
    const out = strip(render(<SubagentDetail
      taskId="t1" agentName="alice" teamName="demo" status="idle"
      conversation={[]} activities={[]}
      planAwaitingApproval={{ plan: 'do A then B', requestId: 'r1' }}
      onInjectMessage={() => {}} onPause={() => {}} onKill={() => {}} onShutdown={() => {}}
      onApprovePlan={() => {}} onRejectPlan={() => {}}
    />).lastFrame() ?? '')
    expect(out.toLowerCase()).toContain('approve')
    expect(out.toLowerCase()).toContain('do a then b')
  })

  it('contains long conversation/activity/plan content within column-aware width', () => {
    const orig = process.stdout.columns
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
    try {
      const huge = 'x'.repeat(5000)
      const url = 'https://example.com/' + 'a'.repeat(300)
      const out = stripAnsi(render(<SubagentDetail
        taskId="t1" agentName="alice-with-a-very-long-name" teamName={huge.slice(0, 200)} status="running"
        conversation={[
          { role: 'user', content: huge },
          { role: 'assistant', content: url },
        ]}
        activities={[
          { toolName: 'Read', input: {}, activityDescription: huge },
          { toolName: 'Bash', input: {}, activityDescription: url },
        ]}
        planAwaitingApproval={{ plan: url + '\n' + huge, requestId: 'r1' }}
        onInjectMessage={vi.fn()} onPause={vi.fn()} onKill={vi.fn()} onShutdown={vi.fn()}
        onApprovePlan={vi.fn()} onRejectPlan={vi.fn()}
      />).lastFrame() ?? '')
      const maxLine = Math.max(...out.split('\n').map(s => s.length))
      expect(maxLine).toBeLessThanOrEqual(60)
    } finally {
      Object.defineProperty(process.stdout, 'columns', { value: orig, configurable: true })
    }
  })
})
