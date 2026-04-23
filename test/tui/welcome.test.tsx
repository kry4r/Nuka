import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Welcome } from '../../src/tui/Welcome/Welcome'

describe('Welcome', () => {
  it('renders NUKA brand and cwd', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/workspace/proj"
        gitBranch={{ branch: 'main', dirty: false }}
        model="claude-sonnet-4-6"
        version="0.1.0"
        tip="Which bug are we slicing today?"
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('NUKA')
    expect(frame).toContain('/workspace/proj')
    expect(frame).toContain('main')
    expect(frame).toContain('claude-sonnet-4-6')
    expect(frame).toContain('Which bug are we slicing')
  })
})
