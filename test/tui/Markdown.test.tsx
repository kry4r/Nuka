import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { Markdown } from '../../src/tui/Messages/Markdown'

describe('Markdown', () => {
  it('renders GFM task checkboxes as quiet progress rows', () => {
    const { lastFrame } = render(
      <Markdown source={'Plan\n- [ ] Wire tests\n- [x] Keep output compact\n  - [ ] Nested follow-up'} />,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('Plan')
    expect(frame).toContain('[ ] Wire tests')
    expect(frame).toContain('[x] Keep output compact')
    expect(frame).toContain('  [ ] Nested follow-up')
    expect(frame).not.toContain('- [ ] Wire tests')
    expect(frame).not.toContain('- [x] Keep output compact')
  })

  it('leaves ordinary markdown text untouched', () => {
    const source = 'Use `npm test` before claiming completion.\n\nPlain paragraph.'
    const { lastFrame } = render(<Markdown source={source} />)

    expect(lastFrame() ?? '').toContain(source)
  })
})
