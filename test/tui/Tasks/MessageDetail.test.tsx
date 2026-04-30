// test/tui/Tasks/MessageDetail.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { MessageDetail } from '../../../src/tui/Tasks/MessageDetail'

describe('MessageDetail', () => {
  it('renders envelope inspector', () => {
    const out = render(<MessageDetail envelope={{
      id: 'm1', from: 'lead', to: 'team:demo/alice', summary: 'kickoff', message: 'do thing', sentAt: 0,
    }} />).lastFrame() ?? ''
    expect(out).toContain('lead')
    expect(out).toContain('alice')
    expect(out).toContain('do thing')
  })
})
