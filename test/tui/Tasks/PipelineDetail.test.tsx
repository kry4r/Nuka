// test/tui/Tasks/PipelineDetail.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { PipelineDetail } from '../../../src/tui/Tasks/PipelineDetail'

describe('PipelineDetail', () => {
  it('renders DAG nodes with status', () => {
    const out = render(<PipelineDetail
      pipelineId="pipe-1"
      nodes={[
        { id: 'r', agentName: 'core:researcher', status: 'completed', parents: [] },
        { id: 'p', agentName: 'core:planner',    status: 'running',   parents: ['r'] },
        { id: 'i', agentName: 'core:implementer', status: 'pending',  parents: ['p'] },
      ]}
    />).lastFrame() ?? ''
    expect(out).toContain('researcher')
    expect(out).toContain('planner')
    expect(out).toContain('implementer')
  })
})
