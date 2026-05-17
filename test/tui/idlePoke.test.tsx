// test/tui/idlePoke.test.tsx
//
// Iter MMMM — TUI-side integration tests for the awaySummary idle
// watcher wiring. Verifies that `PromptInput.onUserInput` fires on
// real keystrokes (typing, submit, arrows, backspace) and that the
// prop is optional (PromptInput works fine without it).
//
// Wiring shape under test:
//   useInput keystroke  → PromptInput handler → props.onUserInput?.()
//
// In production, `onUserInput` is `useIdlePoke(props.idleHook)` from
// App.tsx, which calls `idleHook.poke()`. Here we pass a vi.fn()
// directly so the test asserts the call surface without needing the
// idle watcher in the loop.

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'

import { PromptInput } from '../../src/tui/PromptInput/PromptInput'

const flush = (): Promise<void> => new Promise(r => setImmediate(r))

describe('PromptInput onUserInput (Iter MMMM)', () => {
  it('fires onUserInput on a typed character', async () => {
    const onUserInput = vi.fn()
    const { stdin } = render(
      <PromptInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={false}
        onUserInput={onUserInput}
      />,
    )
    stdin.write('a')
    await flush()
    expect(onUserInput).toHaveBeenCalled()
    expect(onUserInput.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('fires onUserInput on Enter (submit)', async () => {
    const onUserInput = vi.fn()
    const { stdin } = render(
      <PromptInput
        value="hi"
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={false}
        onUserInput={onUserInput}
      />,
    )
    stdin.write('\r')
    await flush()
    expect(onUserInput).toHaveBeenCalled()
  })

  it('fires onUserInput on arrow keys (history navigation)', async () => {
    const onUserInput = vi.fn()
    const { stdin } = render(
      <PromptInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={false}
        onUserInput={onUserInput}
      />,
    )
    stdin.write('[A') // up arrow
    await flush()
    expect(onUserInput).toHaveBeenCalled()
  })

  it('fires onUserInput on backspace', async () => {
    const onUserInput = vi.fn()
    const { stdin } = render(
      <PromptInput
        value="abc"
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={false}
        onUserInput={onUserInput}
      />,
    )
    stdin.write('') // DEL — interpreted as backspace by Ink
    await flush()
    expect(onUserInput).toHaveBeenCalled()
  })

  it('does not fire onUserInput when disabled', async () => {
    const onUserInput = vi.fn()
    const { stdin } = render(
      <PromptInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={true}
        onUserInput={onUserInput}
      />,
    )
    stdin.write('a')
    stdin.write('\r')
    await flush()
    expect(onUserInput).not.toHaveBeenCalled()
  })

  it('omitting onUserInput does not throw when typing', async () => {
    const onChange = vi.fn()
    const { stdin } = render(
      <PromptInput
        value=""
        onChange={onChange}
        onSubmit={() => {}}
        disabled={false}
      />,
    )
    // Just typing a character must not throw despite the prop being absent.
    expect(() => stdin.write('a')).not.toThrow()
    await flush()
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('fires multiple times for a burst of keystrokes', async () => {
    const onUserInput = vi.fn()
    const { stdin } = render(
      <PromptInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={false}
        onUserInput={onUserInput}
      />,
    )
    stdin.write('a')
    await flush()
    stdin.write('b')
    await flush()
    stdin.write('c')
    await flush()
    expect(onUserInput.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})
