// test/tui/design-system/LoadingState.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { LoadingState, LOADING_FRAMES } from '../../../src/tui/design-system/LoadingState'

const flush = () => new Promise(r => setImmediate(r))
const flushAll = async () => { for (let i = 0; i < 4; i++) await flush() }
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

describe('LoadingState', () => {
  it('renders the message next to the first lightning frame', () => {
    const { lastFrame } = render(<LoadingState message="Loading sessions" />)
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Loading sessions')
    expect(f).toContain(LOADING_FRAMES[0])
  })

  it('renders a subtitle below the main row when provided', () => {
    const { lastFrame } = render(
      <LoadingState message="Top" subtitle="more details" />,
    )
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Top')
    expect(f).toContain('more details')
    const lines = f.split('\n').map(l => l.trim()).filter(Boolean)
    const topIdx = lines.findIndex(l => l.includes('Top'))
    const subIdx = lines.findIndex(l => l.includes('more details'))
    expect(subIdx).toBeGreaterThan(topIdx)
  })

  it('cycles to the next frame after the interval (real timers)', async () => {
    const { lastFrame } = render(<LoadingState message="Working" />)
    const before = stripAnsi(lastFrame() ?? '')
    expect(before).toContain(LOADING_FRAMES[0])
    // Wait for one interval tick + a flush.
    await sleep(150)
    await flushAll()
    const after = stripAnsi(lastFrame() ?? '')
    // Frame must have advanced beyond index 0.
    expect(after).toContain(LOADING_FRAMES[1])
  })

  it('all frames render valid (no undefined) and form a 4-frame cycle', () => {
    expect(LOADING_FRAMES.length).toBe(4)
    for (const frame of LOADING_FRAMES) {
      expect(typeof frame).toBe('string')
      expect(frame.length).toBeGreaterThan(0)
    }
  })

  it('clears the interval on unmount (clearInterval invoked)', () => {
    vi.useFakeTimers()
    try {
      const clearSpy = vi.spyOn(global, 'clearInterval')
      const before = vi.getTimerCount()
      const { unmount } = render(<LoadingState message="bye" />)
      // setInterval scheduled by useEffect — vi tracks it.
      expect(vi.getTimerCount()).toBeGreaterThan(before)
      unmount()
      // Unmount cleanup MUST have called clearInterval at least once
      // (LoadingState's own teardown).  Any remaining tracked timers belong
      // to ink's internal scheduler, not to this component.
      expect(clearSpy).toHaveBeenCalled()
      clearSpy.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})
