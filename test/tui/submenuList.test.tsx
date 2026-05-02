// test/tui/submenuList.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { SubmenuList, type SubmenuListItem } from '../../src/tui/Submenu/SubmenuList'

const flush = () => new Promise(r => setImmediate(r))
const flushAll = async () => {
  for (let i = 0; i < 4; i++) await flush()
}

const baseItems: SubmenuListItem[] = [
  { id: 'a', label: 'Alpha', description: 'first letter' },
  { id: 'b', label: 'Bravo', description: 'second letter', value: 'on' },
  { id: 'c', label: 'Charlie', disabled: true, description: 'disabled item' },
  { id: 'd', label: 'Delta' },
]

describe('SubmenuList', () => {
  it('renders all items with cursor sigil on first row', () => {
    const { lastFrame } = render(
      <SubmenuList items={baseItems} onSelect={() => {}} onCancel={() => {}} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Alpha')
    expect(f).toContain('Bravo')
    expect(f).toContain('Charlie')
    expect(f).toContain('Delta')

    // First (selected) row carries the ▸ sigil.
    const alphaLine = f.split('\n').find(l => l.includes('Alpha')) ?? ''
    expect(alphaLine).toContain('▸')
    const bravoLine = f.split('\n').find(l => l.includes('Bravo')) ?? ''
    expect(bravoLine).not.toContain('▸')
  })

  it('renders the default footer hint when none is provided', () => {
    const { lastFrame } = render(
      <SubmenuList items={baseItems} onSelect={() => {}} onCancel={() => {}} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toMatch(/↑↓ select · ⏎ open · Esc back/)
  })

  it('renders custom footer hint when provided', () => {
    const { lastFrame } = render(
      <SubmenuList
        items={baseItems}
        footer="my custom hint"
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('my custom hint')
  })

  it('arrow down moves cursor', async () => {
    const { lastFrame, stdin } = render(
      <SubmenuList items={baseItems} onSelect={() => {}} onCancel={() => {}} />,
    )
    stdin.write('\u001B[B') // down arrow
    await flushAll()
    const f = lastFrame() ?? ''
    const bravoLine = f.split('\n').find(l => l.includes('Bravo')) ?? ''
    expect(bravoLine).toContain('▸')
    const alphaLine = f.split('\n').find(l => l.includes('Alpha')) ?? ''
    expect(alphaLine).not.toContain('▸')
  })

  it('arrow up at top stays in bounds (no wrap)', async () => {
    const { lastFrame, stdin } = render(
      <SubmenuList items={baseItems} onSelect={() => {}} onCancel={() => {}} />,
    )
    stdin.write('\u001B[A') // up arrow at index 0
    await flushAll()
    const f = lastFrame() ?? ''
    const alphaLine = f.split('\n').find(l => l.includes('Alpha')) ?? ''
    expect(alphaLine).toContain('▸')
  })

  it('arrow down at bottom stays clamped to last index', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <SubmenuList items={baseItems} onSelect={onSelect} onCancel={() => {}} />,
    )
    // Move past the bottom (4 items, send 10 downs)
    for (let i = 0; i < 10; i++) {
      stdin.write('\u001B[B')
      await flush()
    }
    // Press Enter — last item is "Delta" at index 3 (Charlie disabled at 2 doesn't matter for clamp).
    stdin.write('\r')
    await flushAll()
    expect(onSelect).toHaveBeenCalledWith(baseItems[3], 3)
  })

  it('Enter activates onSelect with current item and index', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <SubmenuList items={baseItems} onSelect={onSelect} onCancel={() => {}} />,
    )
    // Move to index 1 (Bravo).
    stdin.write('\u001B[B')
    await flushAll()
    stdin.write('\r')
    await flushAll()
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(baseItems[1], 1)
  })

  it('disabled item: Enter does NOT call onSelect', async () => {
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    const { stdin } = render(
      <SubmenuList items={baseItems} onSelect={onSelect} onCancel={onCancel} />,
    )
    // Move to Charlie (index 2): two downs.
    stdin.write('\u001B[B')
    await flushAll()
    stdin.write('\u001B[B')
    await flushAll()
    stdin.write('\r')
    await flushAll()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Esc calls onCancel', async () => {
    const onCancel = vi.fn()
    const { stdin } = render(
      <SubmenuList items={baseItems} onSelect={() => {}} onCancel={onCancel} />,
    )
    stdin.write('\u001B') // Esc
    await flushAll()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('right arrow activates onSelect like Enter', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <SubmenuList items={baseItems} onSelect={onSelect} onCancel={() => {}} />,
    )
    stdin.write('\u001B[C') // right arrow
    await flushAll()
    expect(onSelect).toHaveBeenCalledWith(baseItems[0], 0)
  })

  it('Space activates onSelect like Enter', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <SubmenuList items={baseItems} onSelect={onSelect} onCancel={() => {}} />,
    )
    stdin.write(' ')
    await flushAll()
    expect(onSelect).toHaveBeenCalledWith(baseItems[0], 0)
  })

  it('j/k aliases navigate the cursor', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <SubmenuList items={baseItems} onSelect={onSelect} onCancel={() => {}} />,
    )
    stdin.write('j') // down
    await flushAll()
    stdin.write('\r')
    await flushAll()
    expect(onSelect).toHaveBeenCalledWith(baseItems[1], 1)
  })

  it('initialCursor seeds the starting position', async () => {
    const onSelect = vi.fn()
    const { stdin, lastFrame } = render(
      <SubmenuList
        items={baseItems}
        initialCursor={3}
        onSelect={onSelect}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    const deltaLine = f.split('\n').find(l => l.includes('Delta')) ?? ''
    expect(deltaLine).toContain('▸')
    stdin.write('\r')
    await flushAll()
    expect(onSelect).toHaveBeenCalledWith(baseItems[3], 3)
  })

  it('focused=false: keys are ignored', async () => {
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    const { stdin } = render(
      <SubmenuList
        items={baseItems}
        focused={false}
        onSelect={onSelect}
        onCancel={onCancel}
      />,
    )
    stdin.write('\u001B[B')
    stdin.write('\r')
    stdin.write('\u001B')
    await flushAll()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('long list: shows windowing indicators when items exceed terminal height', async () => {
    const longItems: SubmenuListItem[] = Array.from({ length: 200 }, (_, i) => ({
      id: `i-${i}`,
      label: `Item ${i}`,
    }))
    const { lastFrame, stdin } = render(
      <SubmenuList items={longItems} onSelect={() => {}} onCancel={() => {}} />,
    )
    // At top: only "more below" should appear.
    const f0 = lastFrame() ?? ''
    expect(f0).toContain('↓ more below')

    // Move down many rows so we're somewhere in the middle.
    for (let i = 0; i < 30; i++) {
      stdin.write('\u001B[B')
      await flush()
    }
    const f1 = lastFrame() ?? ''
    expect(f1).toContain('↑ more above')
    expect(f1).toContain('↓ more below')
  })

  it('renders description and value for items that have them', () => {
    const { lastFrame } = render(
      <SubmenuList items={baseItems} onSelect={() => {}} onCancel={() => {}} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('first letter')
    expect(f).toContain('second letter')
    // Value at far right
    expect(f).toContain('on')
  })
})
