// test/core/hooks/registry.test.ts
//
// Tests for the in-process HookRegistry — sibling to runner.test.ts /
// loader.test.ts which cover the shell-command hooks.

import { describe, it, expect } from 'vitest'
import { HookRegistry, createHookRegistry } from '../../../src/core/hooks/registry'
import { compareRegisteredHooks, firstSkip } from '../../../src/core/hooks/pipeline'
import type {
  HookContext,
  HookHandler,
  HookResult,
  InvocationResult,
} from '../../../src/core/hooks/events'

describe('HookRegistry.register', () => {
  it('returns a non-empty ID for a registered handler', () => {
    const r = new HookRegistry()
    const id = r.register('promptSubmit', () => undefined)
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('honours caller-supplied IDs', () => {
    const r = new HookRegistry()
    const id = r.register('promptSubmit', () => undefined, { id: 'my-id' })
    expect(id).toBe('my-id')
  })

  it('replaces a previous handler with the same ID', async () => {
    const r = new HookRegistry()
    const seen: string[] = []
    r.register('promptSubmit', () => {
      seen.push('first')
    }, { id: 'dup' })
    r.register('promptSubmit', () => {
      seen.push('second')
    }, { id: 'dup' })

    await r.invoke('promptSubmit', { payload: {} })
    expect(seen).toEqual(['second'])
    expect(r.list('promptSubmit')).toHaveLength(1)
  })

  it('throws on invalid event', () => {
    const r = new HookRegistry()
    expect(() => r.register('not-real-event' as never, () => undefined)).toThrow()
  })

  it('throws on non-function handler', () => {
    const r = new HookRegistry()
    expect(() => r.register('promptSubmit', 'not a function' as unknown as HookHandler)).toThrow()
  })
})

describe('HookRegistry.unregister', () => {
  it('returns true and removes the handler when the ID exists', async () => {
    const r = new HookRegistry()
    let calls = 0
    const id = r.register('promptSubmit', () => {
      calls += 1
    })
    expect(r.unregister(id)).toBe(true)
    await r.invoke('promptSubmit', { payload: {} })
    expect(calls).toBe(0)
    expect(r.list('promptSubmit')).toHaveLength(0)
  })

  it('returns false for an unknown ID', () => {
    const r = new HookRegistry()
    expect(r.unregister('nonexistent')).toBe(false)
  })
})

describe('HookRegistry.invoke ordering', () => {
  it('fires handlers in priority order, higher first', async () => {
    const r = new HookRegistry()
    const order: string[] = []
    r.register('promptSubmit', () => {
      order.push('low')
    }, { priority: 0 })
    r.register('promptSubmit', () => {
      order.push('high')
    }, { priority: 10 })
    r.register('promptSubmit', () => {
      order.push('mid')
    }, { priority: 5 })

    await r.invoke('promptSubmit', { payload: {} })
    expect(order).toEqual(['high', 'mid', 'low'])
  })

  it('breaks priority ties by insertion order', async () => {
    const r = new HookRegistry()
    const order: string[] = []
    r.register('promptSubmit', () => {
      order.push('first')
    })
    r.register('promptSubmit', () => {
      order.push('second')
    })
    r.register('promptSubmit', () => {
      order.push('third')
    })

    await r.invoke('promptSubmit', { payload: {} })
    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('does not fire handlers registered for a different event', async () => {
    const r = new HookRegistry()
    const seen: string[] = []
    r.register('beforeToolCall', () => {
      seen.push('before')
    })
    r.register('afterToolCall', () => {
      seen.push('after')
    })

    await r.invoke('beforeToolCall', { payload: {} })
    expect(seen).toEqual(['before'])
  })

  it('returns [] when no handlers are registered for the event', async () => {
    const r = new HookRegistry()
    const out = await r.invoke('promptSubmit', { payload: {} })
    expect(out).toEqual([])
  })

  it('passes the toolName and payload through to handlers', async () => {
    const r = new HookRegistry()
    let captured: HookContext | undefined
    r.register('beforeToolCall', (ctx) => {
      captured = ctx
    })

    await r.invoke('beforeToolCall', { toolName: 'Bash', payload: { cmd: 'ls' } })
    expect(captured?.event).toBe('beforeToolCall')
    expect(captured?.toolName).toBe('Bash')
    expect(captured?.payload).toEqual({ cmd: 'ls' })
  })
})

describe('HookRegistry.invoke error isolation', () => {
  it('does not crash sibling handlers when one throws', async () => {
    const r = new HookRegistry()
    let calledAfter = false
    r.register('promptSubmit', () => {
      throw new Error('boom')
    }, { priority: 10 })
    r.register('promptSubmit', () => {
      calledAfter = true
    }, { priority: 0 })

    const results = await r.invoke('promptSubmit', { payload: {} })
    expect(calledAfter).toBe(true)
    expect(results).toHaveLength(2)
    expect(results[0]!.outcome).toBe('error')
    expect(results[1]!.outcome).toBe('success')
  })

  it('reports the error message in InvocationResult.error', async () => {
    const r = new HookRegistry()
    r.register('promptSubmit', () => {
      throw new Error('kaboom')
    })
    const results = await r.invoke('promptSubmit', { payload: {} })
    expect(results[0]!.outcome).toBe('error')
    if (results[0]!.outcome === 'error') {
      expect(results[0]!.error.message).toBe('kaboom')
    }
  })

  it('wraps non-Error throws into an Error', async () => {
    const r = new HookRegistry()
    r.register('promptSubmit', () => {
      // biome-ignore lint/suspicious/noThrowAnyType: deliberate non-Error throw
      throw 'string error'
    })
    const results = await r.invoke('promptSubmit', { payload: {} })
    expect(results[0]!.outcome).toBe('error')
    if (results[0]!.outcome === 'error') {
      expect(results[0]!.error).toBeInstanceOf(Error)
      expect(results[0]!.error.message).toBe('string error')
    }
  })

  it('isolates rejected promises from async handlers', async () => {
    const r = new HookRegistry()
    let after = false
    r.register('promptSubmit', async () => {
      await Promise.resolve()
      throw new Error('async boom')
    }, { priority: 10 })
    r.register('promptSubmit', async () => {
      await Promise.resolve()
      after = true
    }, { priority: 0 })

    const results = await r.invoke('promptSubmit', { payload: {} })
    expect(after).toBe(true)
    expect(results[0]!.outcome).toBe('error')
    expect(results[1]!.outcome).toBe('success')
  })
})

describe('HookRegistry.invoke skip semantics', () => {
  it('flags { skip: true } in the result without aborting siblings', async () => {
    const r = new HookRegistry()
    let calledAfter = false
    r.register('beforeToolCall', () => ({ skip: true, reason: 'vetoed' }), {
      priority: 10,
    })
    r.register('beforeToolCall', () => {
      calledAfter = true
    }, { priority: 0 })

    const results = await r.invoke('beforeToolCall', { toolName: 'Bash', payload: {} })
    expect(calledAfter).toBe(true)
    const skip = firstSkip(results)
    expect(skip?.outcome).toBe('success')
    if (skip?.outcome === 'success') {
      expect(skip.result?.skip).toBe(true)
      expect(skip.result?.reason).toBe('vetoed')
    }
  })

  it('returns undefined from firstSkip when no handler vetoes', async () => {
    const r = new HookRegistry()
    r.register('beforeToolCall', () => ({ skip: false }))
    r.register('beforeToolCall', () => undefined)
    const results = await r.invoke('beforeToolCall', { payload: {} })
    expect(firstSkip(results)).toBeUndefined()
  })
})

describe('HookRegistry.invoke async / sync mix', () => {
  it('awaits async handlers before moving to the next one', async () => {
    const r = new HookRegistry()
    const order: string[] = []
    r.register('promptSubmit', async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      order.push('slow-async')
    }, { priority: 10 })
    r.register('promptSubmit', () => {
      order.push('sync')
    }, { priority: 0 })

    await r.invoke('promptSubmit', { payload: {} })
    expect(order).toEqual(['slow-async', 'sync'])
  })

  it('treats sync void-returning handlers as success', async () => {
    const r = new HookRegistry()
    r.register('afterTurn', () => undefined)
    const results = await r.invoke('afterTurn', { payload: {} })
    expect(results[0]!.outcome).toBe('success')
    if (results[0]!.outcome === 'success') {
      expect(results[0]!.result).toBeUndefined()
    }
  })
})

describe('HookRegistry.invoke abort handling', () => {
  it('marks every handler as aborted when the signal is already aborted', async () => {
    const r = new HookRegistry()
    let ran = false
    r.register('promptSubmit', () => {
      ran = true
    })
    const ac = new AbortController()
    ac.abort()
    const results = await r.invoke('promptSubmit', { payload: {} }, { signal: ac.signal })
    expect(ran).toBe(false)
    expect(results).toHaveLength(1)
    expect(results[0]!.outcome).toBe('aborted')
  })

  it('returns partial results when aborted mid-execution', async () => {
    const r = new HookRegistry()
    const ac = new AbortController()
    const seen: string[] = []
    r.register('promptSubmit', () => {
      seen.push('first')
      // Trigger abort *after* this handler runs, before the next one.
      ac.abort()
    }, { priority: 10 })
    r.register('promptSubmit', () => {
      seen.push('second')
    }, { priority: 5 })
    r.register('promptSubmit', () => {
      seen.push('third')
    }, { priority: 0 })

    const results = await r.invoke('promptSubmit', { payload: {} }, { signal: ac.signal })
    expect(seen).toEqual(['first'])
    expect(results).toHaveLength(3)
    expect(results[0]!.outcome).toBe('success')
    expect(results[1]!.outcome).toBe('aborted')
    expect(results[2]!.outcome).toBe('aborted')
  })

  it('forwards the signal to handlers via context', async () => {
    const r = new HookRegistry()
    let received: AbortSignal | undefined
    r.register('promptSubmit', (ctx) => {
      received = ctx.signal
    })
    const ac = new AbortController()
    await r.invoke('promptSubmit', { payload: {} }, { signal: ac.signal })
    expect(received).toBe(ac.signal)
  })
})

describe('HookRegistry.list and clear', () => {
  it('list() returns all handlers across events', () => {
    const r = new HookRegistry()
    r.register('promptSubmit', () => undefined)
    r.register('beforeToolCall', () => undefined)
    r.register('afterToolCall', () => undefined)
    expect(r.list()).toHaveLength(3)
  })

  it('list(event) returns only handlers for that event', () => {
    const r = new HookRegistry()
    r.register('promptSubmit', () => undefined)
    r.register('beforeToolCall', () => undefined)
    expect(r.list('promptSubmit')).toHaveLength(1)
    expect(r.list('beforeToolCall')).toHaveLength(1)
    expect(r.list('afterTurn')).toHaveLength(0)
  })

  it('list() returns a snapshot — mutation does not affect registry', async () => {
    const r = new HookRegistry()
    r.register('promptSubmit', () => undefined)
    const snapshot = r.list('promptSubmit')
    snapshot.length = 0
    expect(r.list('promptSubmit')).toHaveLength(1)
  })

  it('clear(event) only clears the named event', async () => {
    const r = new HookRegistry()
    r.register('promptSubmit', () => undefined)
    r.register('beforeToolCall', () => undefined)
    r.clear('promptSubmit')
    expect(r.list('promptSubmit')).toHaveLength(0)
    expect(r.list('beforeToolCall')).toHaveLength(1)
  })

  it('clear() with no argument clears every event', () => {
    const r = new HookRegistry()
    r.register('promptSubmit', () => undefined)
    r.register('afterToolCall', () => undefined)
    r.clear()
    expect(r.list()).toHaveLength(0)
  })

  it('clear() also invalidates by-ID lookup (subsequent unregister returns false)', () => {
    const r = new HookRegistry()
    const id = r.register('promptSubmit', () => undefined)
    r.clear()
    expect(r.unregister(id)).toBe(false)
  })
})

describe('createHookRegistry factory', () => {
  it('returns a working HookRegistry instance', async () => {
    const r = createHookRegistry()
    expect(r).toBeInstanceOf(HookRegistry)
    let called = false
    r.register('promptSubmit', () => {
      called = true
    })
    await r.invoke('promptSubmit', { payload: {} })
    expect(called).toBe(true)
  })
})

describe('compareRegisteredHooks', () => {
  it('sorts higher priority first', () => {
    const a = { id: 'a', event: 'promptSubmit', handler: () => undefined, priority: 1, insertionOrder: 5 } as const
    const b = { id: 'b', event: 'promptSubmit', handler: () => undefined, priority: 10, insertionOrder: 0 } as const
    const sorted = [a, b].sort(compareRegisteredHooks)
    expect(sorted[0]!.id).toBe('b')
  })

  it('breaks ties by insertion order (earlier first)', () => {
    const a = { id: 'a', event: 'promptSubmit', handler: () => undefined, priority: 0, insertionOrder: 1 } as const
    const b = { id: 'b', event: 'promptSubmit', handler: () => undefined, priority: 0, insertionOrder: 0 } as const
    const sorted = [a, b].sort(compareRegisteredHooks)
    expect(sorted[0]!.id).toBe('b')
  })
})

describe('HookResult plumbing', () => {
  it('carries additionalContext through the result', async () => {
    const r = new HookRegistry()
    const result: HookResult = { additionalContext: 'extra info' }
    r.register('promptRendered', () => result)

    const results: InvocationResult[] = await r.invoke('promptRendered', { payload: {} })
    expect(results[0]!.outcome).toBe('success')
    if (results[0]!.outcome === 'success') {
      expect(results[0]!.result?.additionalContext).toBe('extra info')
    }
  })

  it('carries the opaque data field through', async () => {
    const r = new HookRegistry()
    r.register('afterTurn', () => ({ data: { foo: 1, bar: 'x' } }))
    const results = await r.invoke('afterTurn', { payload: {} })
    expect(results[0]!.outcome).toBe('success')
    if (results[0]!.outcome === 'success') {
      expect(results[0]!.result?.data).toEqual({ foo: 1, bar: 'x' })
    }
  })
})
