// test/tui/PromptInput.vim.test.tsx
//
// Verify the PromptInput vim wiring (Phase 7 — task 7.5.b):
// when `vim={true}`, Esc enters normal mode, basic motions/operators work,
// and behavior is unchanged from the legacy path when `vim={false}`.

import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { PromptInput } from '../../src/tui/PromptInput/PromptInput'

const flush = () => new Promise(r => setImmediate(r))

function Controlled(props: { initial: string; vim: boolean; onSubmit?: (s: string) => void }) {
  const [v, setV] = useState(props.initial)
  return (
    <PromptInput
      value={v}
      onChange={setV}
      onSubmit={s => props.onSubmit?.(s)}
      disabled={false}
      vim={props.vim}
    />
  )
}

describe('PromptInput vim wiring', () => {
  it('shows the [I] mode badge when vim is enabled', async () => {
    const { lastFrame } = render(<Controlled initial="hi" vim={true} />)
    await flush()
    expect(lastFrame()).toMatch(/\[I\]/)
  })

  it('does not show a vim badge when vim is disabled', async () => {
    const { lastFrame } = render(<Controlled initial="hi" vim={false} />)
    await flush()
    expect(lastFrame()).not.toMatch(/\[[INV]\]/)
  })

  it('Esc switches the badge to [N]', async () => {
    const { stdin, lastFrame } = render(<Controlled initial="hello" vim={true} />)
    await flush(); await flush()
    stdin.write('\u001b'); await flush(); await flush()
    expect(lastFrame()).toMatch(/\[N\]/)
  })

  it('in normal mode, dw deletes a word from the value', async () => {
    const { stdin, lastFrame } = render(<Controlled initial="hello world" vim={true} />)
    await flush()
    // Enter normal mode
    stdin.write('\u001b'); await flush()
    // Move to start of line then dw
    stdin.write('0'); await flush()
    stdin.write('d'); await flush()
    stdin.write('w'); await flush()
    expect(lastFrame()).toContain('world')
    expect(lastFrame()).not.toContain('hello world')
  })

  it('with vim disabled, typing still appends', async () => {
    const onChange = vi.fn()
    const { stdin } = render(
      <PromptInput value="" onChange={onChange} onSubmit={() => {}} disabled={false} vim={false} />,
    )
    await flush()
    stdin.write('a'); await flush()
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('Enter from insert mode submits as before', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Controlled initial="hi" vim={true} onSubmit={onSubmit} />)
    await flush()
    stdin.write('\r'); await flush()
    expect(onSubmit).toHaveBeenCalledWith('hi')
  })
})
