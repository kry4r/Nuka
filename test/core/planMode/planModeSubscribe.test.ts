// test/core/planMode/planModeSubscribe.test.ts
//
// Iter ZZZ — spec for the `PlanModeState.subscribe` API.
//
// This file covers only the listener pattern — fundamental lifecycle
// (enter/exit/reset/idempotency) is owned by `planMode.test.ts`.
//
// Listener contract pinned here:
//   - `enter()` fires `{type:'enter'}` only on a true inactive→active
//     transition (idempotent enter doesn't double-fire).
//   - `exit(plan)` fires `{type:'exit', plan, entry}` AFTER state has
//     settled so `isActive()` is already `false` when the listener runs.
//   - `reset()` fires `{type:'reset'}` regardless of prior state — it's
//     a "force back to normal" signal subscribers can use to roll the
//     session.mode flag back without parsing past events.
//   - Listener exceptions are isolated: a buggy subscriber doesn't
//     prevent state mutations or other subscribers from receiving the
//     same event.
//   - The unsubscribe returned by `subscribe()` is idempotent and stops
//     future deliveries.

import { describe, expect, it, vi } from 'vitest'
import {
  PlanModeState,
  type PlanModeEvent,
} from '../../../src/core/planMode/planModeState'

describe('PlanModeState.subscribe — lifecycle delivery', () => {
  it('delivers an enter event on the inactive→active transition', () => {
    const events: PlanModeEvent[] = []
    const s = new PlanModeState()
    s.subscribe(e => events.push(e))
    s.enter()
    expect(events).toEqual([{ type: 'enter' }])
  })

  it('delivers an exit event carrying the plan text', () => {
    const events: PlanModeEvent[] = []
    const s = new PlanModeState(() => 7_777)
    s.subscribe(e => events.push(e))
    s.enter()
    s.exit('# plan\n- step 1')
    expect(events).toEqual<PlanModeEvent[]>([
      { type: 'enter' },
      {
        type: 'exit',
        plan: '# plan\n- step 1',
        entry: { ts: 7_777, plan: '# plan\n- step 1' },
      },
    ])
  })

  it('isActive() is true when the enter listener fires', () => {
    const s = new PlanModeState()
    let snapshot: boolean | undefined
    s.subscribe(event => {
      if (event.type === 'enter') snapshot = s.isActive()
    })
    s.enter()
    expect(snapshot).toBe(true)
  })

  it('isActive() is false when the exit listener fires', () => {
    const s = new PlanModeState()
    let snapshot: boolean | undefined
    s.subscribe(event => {
      if (event.type === 'exit') snapshot = s.isActive()
    })
    s.enter()
    s.exit('p')
    expect(snapshot).toBe(false)
  })

  it('idempotent enter() does NOT double-fire enter events', () => {
    const events: PlanModeEvent[] = []
    const s = new PlanModeState()
    s.subscribe(e => events.push(e))
    s.enter()
    s.enter()
    s.enter()
    expect(events.filter(e => e.type === 'enter')).toHaveLength(1)
  })

  it('a fresh enter() after exit() fires a new enter event', () => {
    const events: PlanModeEvent[] = []
    const s = new PlanModeState(() => 1)
    s.subscribe(e => events.push(e))
    s.enter()
    s.exit('first')
    s.enter()
    s.exit('second')
    expect(events.map(e => e.type)).toEqual(['enter', 'exit', 'enter', 'exit'])
  })

  it('reset() fires a reset event', () => {
    const events: PlanModeEvent[] = []
    const s = new PlanModeState()
    s.subscribe(e => events.push(e))
    s.enter()
    s.reset()
    expect(events.map(e => e.type)).toEqual(['enter', 'reset'])
  })

  it('reset() fires even when the state was already clean', () => {
    const events: PlanModeEvent[] = []
    const s = new PlanModeState()
    s.subscribe(e => events.push(e))
    s.reset()
    expect(events).toEqual<PlanModeEvent[]>([{ type: 'reset' }])
  })
})

describe('PlanModeState.subscribe — unsubscribe + multiple listeners', () => {
  it('returns an unsubscribe function that stops future deliveries', () => {
    const events: string[] = []
    const s = new PlanModeState()
    const unsubscribe = s.subscribe(e => events.push(e.type))
    s.enter()
    unsubscribe()
    s.exit('p')
    expect(events).toEqual(['enter'])
  })

  it('unsubscribe is safe to call more than once', () => {
    const s = new PlanModeState()
    const unsubscribe = s.subscribe(() => undefined)
    expect(() => {
      unsubscribe()
      unsubscribe()
      unsubscribe()
    }).not.toThrow()
  })

  it('multiple listeners all fire in subscription order', () => {
    const calls: string[] = []
    const s = new PlanModeState()
    s.subscribe(() => calls.push('a'))
    s.subscribe(() => calls.push('b'))
    s.subscribe(() => calls.push('c'))
    s.enter()
    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('subscribing the same fn twice still only delivers once (Set dedupe)', () => {
    let count = 0
    const fn = (): void => {
      count++
    }
    const s = new PlanModeState()
    s.subscribe(fn)
    s.subscribe(fn)
    s.enter()
    expect(count).toBe(1)
  })

  it('a throwing listener does not block other listeners or state mutation', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const s = new PlanModeState()
    const calls: string[] = []
    s.subscribe(() => calls.push('before'))
    s.subscribe(() => {
      throw new Error('boom')
    })
    s.subscribe(() => calls.push('after'))
    s.enter()
    expect(calls).toEqual(['before', 'after'])
    expect(s.isActive()).toBe(true)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('multiple throwing listeners are all isolated', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const s = new PlanModeState()
    const calls: string[] = []
    s.subscribe(() => {
      throw new Error('first')
    })
    s.subscribe(() => calls.push('mid'))
    s.subscribe(() => {
      throw new Error('last')
    })
    s.exit('p')
    expect(calls).toEqual(['mid'])
    expect(errSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    errSpy.mockRestore()
  })
})

describe('PlanModeState.subscribe — invariants', () => {
  it('the exit event entry mirrors the value returned by exit()', () => {
    const s = new PlanModeState(() => 12_345)
    let received: { ts: number; plan: string } | undefined
    s.subscribe(event => {
      if (event.type === 'exit') {
        received = event.entry
      }
    })
    const ret = s.exit('hello plan')
    expect(received).toEqual(ret)
  })

  it('exit event plan field equals the raw plan passed to exit()', () => {
    const s = new PlanModeState()
    let received: string | undefined
    s.subscribe(event => {
      if (event.type === 'exit') received = event.plan
    })
    s.exit('  trailing whitespace  ')
    // .exit() does not mutate the plan it stores — we pass the raw text.
    expect(received).toBe('  trailing whitespace  ')
  })

  it('exit() that throws (empty plan) emits no event', () => {
    const events: PlanModeEvent[] = []
    const s = new PlanModeState()
    s.subscribe(e => events.push(e))
    expect(() => s.exit('   ')).toThrow(/non-empty/)
    expect(events).toEqual([])
  })
})
