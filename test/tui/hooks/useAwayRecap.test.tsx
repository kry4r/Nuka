// test/tui/hooks/useAwayRecap.test.tsx
//
// Iter NNNN — covers `useAwayRecap`, the TUI bridge that turns
// `IdleAwaySummaryHook.onRecapResult` events into a dismissable banner
// state.
//
// Pattern: Nuka has no `renderHook` helper; we drive the hook through a
// probe component that exposes the latest `{ recap, dismiss }` via a
// mutable ref. Mirrors test/tui/hooks/useIdlePoke.test.tsx.

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'

import {
  useAwayRecap,
  type AwayRecapTarget,
  type UseAwayRecapResult,
} from '../../../src/tui/hooks/useAwayRecap'
import type { AwayRecapEvent } from '../../../src/core/awaySummary/idleHook'

type FakeHook = {
  target: AwayRecapTarget
  fire: (event: AwayRecapEvent) => void
  listenerCount: () => number
}

function makeFakeHook(): FakeHook {
  const listeners = new Set<(event: AwayRecapEvent) => void>()
  return {
    target: {
      onRecapResult: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    fire: (event) => {
      for (const l of listeners) l(event)
    },
    listenerCount: () => listeners.size,
  }
}

type Probe = { current: UseAwayRecapResult | null }

function makeProbe(target: AwayRecapTarget | null | undefined): {
  probe: Probe
  rerender: (next: AwayRecapTarget | null | undefined) => void
  unmount: () => void
} {
  const probe: Probe = { current: null }
  function P(p: { target: AwayRecapTarget | null | undefined }): React.JSX.Element {
    const r = useAwayRecap(p.target)
    probe.current = r
    return <></>
  }
  const inst = render(<P target={target} />)
  return {
    probe,
    rerender: (next) => inst.rerender(<P target={next} />),
    unmount: () => inst.unmount(),
  }
}

const sampleEvent = (overrides?: Partial<AwayRecapEvent>): AwayRecapEvent => ({
  text: 'Refactoring the registry. Next: fix the type error in line 42.',
  idleMs: 47 * 60 * 1000,
  tokensUsed: 320,
  modelUsed: 'claude-haiku-4-5-20251001',
  ...overrides,
})

describe('useAwayRecap', () => {
  it('starts with recap=null when no event has fired', () => {
    const fake = makeFakeHook()
    const { probe } = makeProbe(fake.target)
    expect(probe.current).not.toBeNull()
    expect(probe.current!.recap).toBeNull()
    expect(typeof probe.current!.dismiss).toBe('function')
  })

  it('exposes recap after the hook fires onRecapResult', async () => {
    const fake = makeFakeHook()
    const { probe } = makeProbe(fake.target)
    fake.fire(sampleEvent({ text: 'Debugging the auth flow.' }))
    // probe is updated synchronously inside render, so a microtask flush
    // is enough to let React commit the setState.
    await new Promise((r) => setImmediate(r))
    expect(probe.current!.recap).not.toBeNull()
    expect(probe.current!.recap!.text).toBe('Debugging the auth flow.')
    expect(probe.current!.recap!.idleMs).toBe(47 * 60 * 1000)
  })

  it('dismiss() clears the recap', async () => {
    const fake = makeFakeHook()
    const { probe } = makeProbe(fake.target)
    fake.fire(sampleEvent())
    await new Promise((r) => setImmediate(r))
    expect(probe.current!.recap).not.toBeNull()
    probe.current!.dismiss()
    await new Promise((r) => setImmediate(r))
    expect(probe.current!.recap).toBeNull()
  })

  it('dismiss() is a no-op when recap is already null', () => {
    const fake = makeFakeHook()
    const { probe } = makeProbe(fake.target)
    expect(probe.current!.recap).toBeNull()
    expect(() => probe.current!.dismiss()).not.toThrow()
    expect(probe.current!.recap).toBeNull()
  })

  it('latest event replaces the previous one', async () => {
    const fake = makeFakeHook()
    const { probe } = makeProbe(fake.target)
    fake.fire(sampleEvent({ text: 'First recap.', idleMs: 60_000 }))
    await new Promise((r) => setImmediate(r))
    expect(probe.current!.recap!.text).toBe('First recap.')
    fake.fire(sampleEvent({ text: 'Second recap.', idleMs: 600_000 }))
    await new Promise((r) => setImmediate(r))
    expect(probe.current!.recap!.text).toBe('Second recap.')
    expect(probe.current!.recap!.idleMs).toBe(600_000)
  })

  it('returns null recap permanently when target is undefined', () => {
    const { probe } = makeProbe(undefined)
    expect(probe.current!.recap).toBeNull()
    // dismiss never throws even without a target
    expect(() => probe.current!.dismiss()).not.toThrow()
  })

  it('returns null recap permanently when target is null', () => {
    const { probe } = makeProbe(null)
    expect(probe.current!.recap).toBeNull()
  })

  it('returns null recap when target lacks onRecapResult', () => {
    const stubTarget = {} as AwayRecapTarget
    const { probe } = makeProbe(stubTarget)
    expect(probe.current!.recap).toBeNull()
  })

  it('keeps dismiss callback identity stable across re-renders', () => {
    const fake = makeFakeHook()
    const seen: Array<() => void> = []
    function P(): React.JSX.Element {
      const r = useAwayRecap(fake.target)
      seen.push(r.dismiss)
      return <></>
    }
    const { rerender } = render(<P />)
    rerender(<P />)
    rerender(<P />)
    expect(seen.length).toBe(3)
    expect(seen[0]).toBe(seen[1])
    expect(seen[1]).toBe(seen[2])
  })

  it('unsubscribes from the target on unmount', () => {
    const fake = makeFakeHook()
    const { unmount } = makeProbe(fake.target)
    expect(fake.listenerCount()).toBe(1)
    unmount()
    expect(fake.listenerCount()).toBe(0)
  })

  it('re-subscribes when target reference changes', () => {
    const a = makeFakeHook()
    const b = makeFakeHook()
    const { probe, rerender } = makeProbe(a.target)
    expect(a.listenerCount()).toBe(1)
    rerender(b.target)
    expect(a.listenerCount()).toBe(0)
    expect(b.listenerCount()).toBe(1)
    // Firing on the old target must NOT mutate state.
    a.fire(sampleEvent({ text: 'Stale recap.' }))
    expect(probe.current!.recap).toBeNull()
  })
})
