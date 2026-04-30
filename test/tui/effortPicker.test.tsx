// test/tui/effortPicker.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { EffortPicker } from '../../src/tui/dialogs/EffortPicker'

const flush = () => new Promise(r => setImmediate(r))

describe('EffortPicker', () => {
  it('renders the three effort levels', () => {
    const { lastFrame } = render(
      <EffortPicker current={undefined} onSelect={() => {}} onCancel={() => {}} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Low')
    expect(f).toContain('Medium')
    expect(f).toContain('High')
  })

  it('marks the current value with a filled circle', () => {
    const { lastFrame } = render(
      <EffortPicker current="medium" onSelect={() => {}} onCancel={() => {}} />,
    )
    const f = lastFrame() ?? ''
    // The line containing "Medium" should also contain the active marker
    const medLine = f.split('\n').find(l => l.includes('Medium')) ?? ''
    expect(medLine).toContain('●')
  })

  it('Enter triggers onSelect with the highlighted level', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <EffortPicker current="medium" onSelect={onSelect} onCancel={() => {}} />,
    )
    // Cursor starts at current ('medium'). Press Enter → 'medium'.
    stdin.write('\r')
    await flush()
    expect(onSelect).toHaveBeenCalledWith('medium')
  })

  it('arrow down then Enter selects the next level', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <EffortPicker current="low" onSelect={onSelect} onCancel={() => {}} />,
    )
    // Cursor starts at 'low'. Down → 'medium'. Enter → 'medium'.
    stdin.write('\u001B[B') // down arrow
    await flush()
    await flush()
    stdin.write('\r')
    await flush()
    await flush()
    expect(onSelect).toHaveBeenCalledWith('medium')
  })

  it('Esc fires onCancel', async () => {
    const onCancel = vi.fn()
    const { stdin } = render(
      <EffortPicker current="low" onSelect={() => {}} onCancel={onCancel} />,
    )
    stdin.write('\u001B') // Esc
    await flush()
    expect(onCancel).toHaveBeenCalled()
  })
})
