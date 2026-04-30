// test/tui/Tasks/SubagentDetail.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
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
})
