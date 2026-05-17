// test/tui/hooks/useIdlePoke.test.tsx
//
// Iter MMMM — covers `useIdlePoke`, the TUI-side bridge that turns
// `IdleAwaySummaryHook.poke()` into a stable React callback for
// PromptInput's input handler.
//
// Assertions:
//   • Returns a function that calls `target.poke()` exactly once when invoked.
//   • Returns a no-op when `target` is `undefined` (no-throw).
//   • Returns a no-op when `target` is `null` (defensive for late wire-up).
//   • Callback identity is stable across renders when the target reference
//     is stable (so consumers can safely list it in dependency arrays).
//   • Callback identity changes when the target reference changes (otherwise
//     the captured `target` would go stale on a swap).
//   • Calling the same callback many times relays each call through to
//     the underlying `poke` (no debounce / one-shot trap).
//
// Pattern: Nuka has no `renderHook` helper; we drive the hook through a
// thin probe component that exposes the returned callback via a ref handle.
// This mirrors the approach used in test/tui/promptMentions/usePromptMention.test.tsx.

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'

import { useIdlePoke, type IdlePokeTarget } from '../../../src/tui/hooks/useIdlePoke'

type Probe = {
  current: (() => void) | null
}

function makeProbe(target: IdlePokeTarget | undefined | null): Probe {
  const probe: Probe = { current: null }
  function P(): React.JSX.Element {
    const cb = useIdlePoke(target)
    probe.current = cb
    return <></>
  }
  render(<P />)
  return probe
}

describe('useIdlePoke', () => {
  it('returns a function that calls target.poke()', () => {
    const poke = vi.fn()
    const probe = makeProbe({ poke })
    expect(typeof probe.current).toBe('function')
    probe.current!()
    expect(poke).toHaveBeenCalledTimes(1)
  })

  it('relays every call (no debounce or one-shot)', () => {
    const poke = vi.fn()
    const probe = makeProbe({ poke })
    probe.current!()
    probe.current!()
    probe.current!()
    expect(poke).toHaveBeenCalledTimes(3)
  })

  it('is a no-op when target is undefined', () => {
    const probe = makeProbe(undefined)
    expect(typeof probe.current).toBe('function')
    expect(() => probe.current!()).not.toThrow()
  })

  it('is a no-op when target is null', () => {
    const probe = makeProbe(null)
    expect(typeof probe.current).toBe('function')
    expect(() => probe.current!()).not.toThrow()
  })

  it('keeps callback identity stable across re-renders for the same target', () => {
    const poke = vi.fn()
    const target: IdlePokeTarget = { poke }
    const seen: Array<() => void> = []
    function P(): React.JSX.Element {
      seen.push(useIdlePoke(target))
      return <></>
    }
    const { rerender } = render(<P />)
    rerender(<P />)
    rerender(<P />)
    expect(seen.length).toBe(3)
    expect(seen[0]).toBe(seen[1])
    expect(seen[1]).toBe(seen[2])
  })

  it('rotates callback identity when the target reference changes', () => {
    const a: IdlePokeTarget = { poke: vi.fn() }
    const b: IdlePokeTarget = { poke: vi.fn() }
    const seen: Array<() => void> = []
    function P(props: { target: IdlePokeTarget }): React.JSX.Element {
      seen.push(useIdlePoke(props.target))
      return <></>
    }
    const { rerender } = render(<P target={a} />)
    rerender(<P target={b} />)
    expect(seen.length).toBe(2)
    expect(seen[0]).not.toBe(seen[1])
    // Verify the new callback hits the new target, not the old one.
    seen[1]!()
    expect(b.poke).toHaveBeenCalledTimes(1)
    expect(a.poke).not.toHaveBeenCalled()
  })

  it('survives target swap from defined → undefined without throw', () => {
    const poke = vi.fn()
    let target: IdlePokeTarget | undefined = { poke }
    function P(): React.JSX.Element {
      const cb = useIdlePoke(target)
      // Run the callback inside render so the test exercises whatever
      // closure React commits with each pass.
      cb()
      return <></>
    }
    const { rerender } = render(<P />)
    expect(poke).toHaveBeenCalledTimes(1)
    target = undefined
    expect(() => rerender(<P />)).not.toThrow()
    // The undefined-target render should not have invoked poke again.
    expect(poke).toHaveBeenCalledTimes(1)
  })
})
