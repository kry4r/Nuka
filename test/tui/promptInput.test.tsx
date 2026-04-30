// test/tui/promptInput.test.tsx
import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { PromptInput } from '../../src/tui/PromptInput/PromptInput'
import { mountApp } from '../../src/tui/testing/harness'
import { SlashRegistry } from '../../src/slash/registry'
import { HelpCommand } from '../../src/slash/help'

const flush = () => new Promise(r => setImmediate(r))
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

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

  it('up arrow after two submits shows most recent prompt', async () => {
    // Use rerender to drive value externally so the controlled component updates correctly
    const { stdin, lastFrame, rerender } = render(
      <PromptInput value="first" onChange={() => {}} onSubmit={() => {}} disabled={false} />,
    )
    // Submit "first"
    stdin.write('\r'); await flush()
    // Now set value to "second" and submit
    rerender(<PromptInput value="second" onChange={() => {}} onSubmit={() => {}} disabled={false} />)
    stdin.write('\r'); await flush()
    // Clear input (post-submit state)
    rerender(<PromptInput value="" onChange={() => {}} onSubmit={() => {}} disabled={false} />)
    await flush()
    // Press up — should restore "second" via history.prev()
    const onChange = vi.fn()
    rerender(<PromptInput value="" onChange={onChange} onSubmit={() => {}} disabled={false} />)
    stdin.write('\u001B[A'); await flush()
    expect(onChange).toHaveBeenCalledWith('second')
  })

  it('up up then down navigates history correctly', async () => {
    const { stdin, rerender } = render(
      <PromptInput value="alpha" onChange={() => {}} onSubmit={() => {}} disabled={false} />,
    )
    stdin.write('\r'); await flush()
    rerender(<PromptInput value="beta" onChange={() => {}} onSubmit={() => {}} disabled={false} />)
    stdin.write('\r'); await flush()
    rerender(<PromptInput value="" onChange={() => {}} onSubmit={() => {}} disabled={false} />)
    await flush()

    // Track onChange calls
    const onChange = vi.fn()
    rerender(<PromptInput value="" onChange={onChange} onSubmit={() => {}} disabled={false} />)

    // up → beta
    stdin.write('\u001B[A'); await flush()
    expect(onChange).toHaveBeenLastCalledWith('beta')

    // Simulate value now shows "beta"; up → alpha
    rerender(<PromptInput value="beta" onChange={onChange} onSubmit={() => {}} disabled={false} />)
    stdin.write('\u001B[A'); await flush()
    expect(onChange).toHaveBeenLastCalledWith('alpha')

    // down → beta
    rerender(<PromptInput value="alpha" onChange={onChange} onSubmit={() => {}} disabled={false} />)
    stdin.write('\u001B[B'); await flush()
    expect(onChange).toHaveBeenLastCalledWith('beta')

    // down → empty string
    rerender(<PromptInput value="beta" onChange={onChange} onSubmit={() => {}} disabled={false} />)
    stdin.write('\u001B[B'); await flush()
    expect(onChange).toHaveBeenLastCalledWith('')
  })
})

describe('Slash hint persistence after submit', () => {
  it('shows the slash card again after submitting a non-slash message', async () => {
    const slash = new SlashRegistry()
    slash.register(HelpCommand)

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      // Type a non-slash message and submit it.
      h.stdin.write('hello')
      await wait()
      h.stdin.write('\r')
      await wait()
      // After submit the input is cleared. Now type '/'. The slash card should reappear.
      h.stdin.write('/')
      await h.waitFor({ contains: '/help' }, 500)
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('/help')
    } finally {
      h.unmount()
    }
  })
})
