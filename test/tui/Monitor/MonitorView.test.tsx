// test/tui/Monitor/MonitorView.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { MonitorView } from '../../../src/tui/Monitor/MonitorView'

describe('MonitorView', () => {
  it('renders DAG tab by default', () => {
    const out = render(<MonitorView events={[]} dagNodes={[]} />).lastFrame() ?? ''
    expect(out).toContain('DAG')
  })
  it('shows "terminal too narrow" below 80 cols', () => {
    const out = render(<MonitorView events={[]} dagNodes={[]} cols={70} />).lastFrame() ?? ''
    expect(out.toLowerCase()).toContain('too narrow')
  })
})
