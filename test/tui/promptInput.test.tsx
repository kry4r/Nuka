// test/tui/promptInput.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { PromptInput } from '../../src/tui/PromptInput/PromptInput'

describe('PromptInput', () => {
  it('renders the prompt marker and initial value', () => {
    const { lastFrame } = render(
      <PromptInput value="hello" onChange={() => {}} onSubmit={() => {}} disabled={false} />,
    )
    expect(lastFrame()).toContain('>')
    expect(lastFrame()).toContain('hello')
  })

  it('typed characters call onChange', () => {
    const onChange = vi.fn()
    const { stdin } = render(
      <PromptInput value="" onChange={onChange} onSubmit={() => {}} disabled={false} />,
    )
    stdin.write('a')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('enter submits non-empty value', () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      <PromptInput value="hi" onChange={() => {}} onSubmit={onSubmit} disabled={false} />,
    )
    stdin.write('\r')
    expect(onSubmit).toHaveBeenCalledWith('hi')
  })
})
