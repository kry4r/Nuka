// test/core/retry/retry.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  retryWithBackoff,
  computeDelay,
  isRetryableNetworkError,
  RetryError,
  AbortError,
  AttemptTimeoutError,
  type RetryAttemptContext,
} from '../../../src/core/retry'

// Helper: pump scheduled timers + microtasks until the promise settles.
// retryWithBackoff awaits between attempts and after each sleep, so we
// need to alternately advance time and yield microtasks.
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let done = false
  let result: { ok: true; value: T } | { ok: false; error: unknown } | undefined
  p.then(
    v => {
      result = { ok: true, value: v }
      done = true
    },
    e => {
      result = { ok: false, error: e }
      done = true
    },
  )
  // Pump until settled. Each iteration: run pending timers (advances
  // mocked setTimeout) then yield to microtasks (the awaits in fn).
  // 200 ticks is more than enough for any reasonable test config.
  for (let i = 0; i < 200 && !done; i += 1) {
    await vi.advanceTimersByTimeAsync(60_000)
  }
  if (!done) throw new Error('settle: promise never settled')
  return result!
}

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ─── happy paths ──────────────────────────────────────────────────

  it('succeeds on first attempt without delays', async () => {
    const fn = vi.fn(async () => 'ok')
    const p = retryWithBackoff(fn)
    const r = await settle(p)
    expect(r).toEqual({ ok: true, value: 'ok' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('passes attempt number via ctx (1-indexed)', async () => {
    const seen: number[] = []
    const fn = vi.fn(async (ctx: RetryAttemptContext) => {
      seen.push(ctx.attempt)
      return 'ok'
    })
    await settle(retryWithBackoff(fn))
    expect(seen).toEqual([1])
  })

  it('retries until success on 3rd attempt', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new Error(`fail-${calls}`)
      return 'finally'
    })
    const r = await settle(retryWithBackoff(fn, { maxAttempts: 5 }))
    expect(r).toEqual({ ok: true, value: 'finally' })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws RetryError after exhausting maxAttempts', async () => {
    const inner = new Error('boom')
    const fn = vi.fn(async () => {
      throw inner
    })
    const r = await settle(retryWithBackoff(fn, { maxAttempts: 3 }))
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error).toBeInstanceOf(RetryError)
    const re = r.error as RetryError
    expect(re.attempts).toBe(3)
    expect(re.originalError).toBe(inner)
    expect(re.cause).toBe(inner) // ES2022 .cause plumbing
    expect(re.message).toMatch(/3 attempt\(s\)/)
    expect(re.message).toMatch(/boom/)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stops on first success — no extra attempts after a return', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      return calls
    })
    const r = await settle(retryWithBackoff(fn, { maxAttempts: 10 }))
    expect(r).toEqual({ ok: true, value: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // ─── shouldRetry ──────────────────────────────────────────────────

  it('stops when shouldRetry returns false', async () => {
    const inner = new Error('don\'t-retry-me')
    const fn = vi.fn(async () => {
      throw inner
    })
    const shouldRetry = vi.fn(() => false)
    const r = await settle(
      retryWithBackoff(fn, { maxAttempts: 5, shouldRetry }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error).toBeInstanceOf(RetryError)
    expect((r.error as RetryError).attempts).toBe(1)
    expect((r.error as RetryError).originalError).toBe(inner)
    // fn ran once; shouldRetry consulted once after that.
    expect(fn).toHaveBeenCalledTimes(1)
    expect(shouldRetry).toHaveBeenCalledTimes(1)
    expect(shouldRetry).toHaveBeenCalledWith(inner, 1)
  })

  it('supports async shouldRetry', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new Error('blip')
      return 'ok'
    })
    const shouldRetry = vi.fn(async (_e: unknown, attempt: number) => {
      // Force a real await tick.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      return attempt < 3
    })
    const r = await settle(
      retryWithBackoff(fn, { maxAttempts: 5, shouldRetry }),
    )
    expect(r).toEqual({ ok: true, value: 'ok' })
    expect(shouldRetry).toHaveBeenCalledTimes(2) // after attempt 1 and 2
  })

  it('shouldRetry sees the 1-indexed attempt that just failed', async () => {
    const seen: number[] = []
    const fn = vi.fn(async () => {
      throw new Error('always')
    })
    await settle(
      retryWithBackoff(fn, {
        maxAttempts: 4,
        shouldRetry: (_, n) => {
          seen.push(n)
          return true
        },
      }),
    )
    // maxAttempts=4 → fn fails on attempts 1,2,3,4. shouldRetry is asked
    // after 1, 2, 3 (not 4, because we're out of budget).
    expect(seen).toEqual([1, 2, 3])
    expect(fn).toHaveBeenCalledTimes(4)
  })

  // ─── onAttempt ────────────────────────────────────────────────────

  it('fires onAttempt with correct attempt + delay', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new Error(`fail-${calls}`)
      return 'ok'
    })
    const log: Array<{ attempt: number; delayMs: number; msg: string }> = []
    await settle(
      retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        backoffFactor: 2,
        jitter: false,
        onAttempt: (err, attempt, delayMs) => {
          log.push({
            attempt,
            delayMs,
            msg: (err as Error).message,
          })
        },
      }),
    )
    // Two failures → two onAttempt calls: after attempt 1 (delay 100ms)
    // and after attempt 2 (delay 200ms). The third attempt succeeds, so
    // no onAttempt for it.
    expect(log).toEqual([
      { attempt: 1, delayMs: 100, msg: 'fail-1' },
      { attempt: 2, delayMs: 200, msg: 'fail-2' },
    ])
  })

  it('does NOT fire onAttempt when shouldRetry returns false', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom')
    })
    const onAttempt = vi.fn()
    const r = await settle(
      retryWithBackoff(fn, {
        maxAttempts: 5,
        shouldRetry: () => false,
        onAttempt,
      }),
    )
    expect(r.ok).toBe(false)
    expect(onAttempt).not.toHaveBeenCalled()
  })

  it('does NOT fire onAttempt on the final-attempt failure (no delay coming)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom')
    })
    const onAttempt = vi.fn()
    await settle(retryWithBackoff(fn, { maxAttempts: 3, onAttempt }))
    // 3 failures, but onAttempt only fires after attempts 1 and 2.
    expect(onAttempt).toHaveBeenCalledTimes(2)
    expect(onAttempt.mock.calls[0]?.[1]).toBe(1)
    expect(onAttempt.mock.calls[1]?.[1]).toBe(2)
  })

  // ─── AbortSignal ──────────────────────────────────────────────────

  it('throws immediately if signal already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const fn = vi.fn(async () => 'never')
    const r = await settle(retryWithBackoff(fn, { signal: ac.signal }))
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error).toBeInstanceOf(Error)
    expect((r.error as Error).name).toBe('AbortError')
    expect(fn).not.toHaveBeenCalled()
  })

  it('throws signal.reason when reason is an Error', async () => {
    const ac = new AbortController()
    const reason = new Error('user-cancelled')
    ac.abort(reason)
    const r = await settle(
      retryWithBackoff(async () => 'x', { signal: ac.signal }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error).toBe(reason)
  })

  it('aborts during delay between attempts', async () => {
    const ac = new AbortController()
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      throw new Error('blip')
    })
    const p = retryWithBackoff(fn, {
      maxAttempts: 10,
      initialDelayMs: 1000,
      jitter: false,
      signal: ac.signal,
    })
    // Let the first attempt run + queue a sleep.
    // Microtask flush: fn's throw resolves, we enter sleepInterruptible.
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toBe(1)
    // Abort while we're in the 1000ms sleep.
    ac.abort()
    const r = await settle(p)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect((r.error as Error).name).toBe('AbortError')
    // No further attempts.
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('aborts immediately if signal fires before next attempt boundary', async () => {
    const ac = new AbortController()
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      throw new Error('blip')
    })
    const p = retryWithBackoff(fn, {
      maxAttempts: 10,
      initialDelayMs: 5,
      jitter: false,
      signal: ac.signal,
    })
    await Promise.resolve()
    await Promise.resolve()
    ac.abort()
    const r = await settle(p)
    expect(r.ok).toBe(false)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // ─── attemptTimeoutMs ────────────────────────────────────────────

  it('each attempt is bounded by attemptTimeoutMs', async () => {
    // fn never resolves — only the timeout fires.
    let calls = 0
    const fn = vi.fn(async (ctx: RetryAttemptContext) => {
      calls += 1
      // hang until ctx.signal fires
      return new Promise<string>((_, reject) => {
        ctx.signal.addEventListener('abort', () => {
          reject(new Error('aborted-via-ctx'))
        })
      })
    })
    const r = await settle(
      retryWithBackoff(fn, {
        maxAttempts: 2,
        attemptTimeoutMs: 100,
        initialDelayMs: 50,
        jitter: false,
      }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error).toBeInstanceOf(RetryError)
    expect((r.error as RetryError).originalError).toBeInstanceOf(
      AttemptTimeoutError,
    )
    expect(calls).toBe(2)
  })

  it('attemptTimeoutMs fires but retry succeeds afterwards', async () => {
    let calls = 0
    const fn = vi.fn(async (ctx: RetryAttemptContext) => {
      calls += 1
      if (calls === 1) {
        // Hang past the timeout.
        return new Promise<string>((_, reject) => {
          ctx.signal.addEventListener('abort', () => {
            reject(new Error('aborted-via-ctx'))
          })
        })
      }
      return 'recovered'
    })
    const r = await settle(
      retryWithBackoff(fn, {
        maxAttempts: 3,
        attemptTimeoutMs: 100,
        initialDelayMs: 10,
        jitter: false,
      }),
    )
    expect(r).toEqual({ ok: true, value: 'recovered' })
    expect(calls).toBe(2)
  })

  it('an attempt that resolves before attemptTimeoutMs is unaffected', async () => {
    const fn = vi.fn(async () => 'fast')
    const r = await settle(
      retryWithBackoff(fn, { attemptTimeoutMs: 10_000 }),
    )
    expect(r).toEqual({ ok: true, value: 'fast' })
  })

  // ─── jitter / backoff growth ─────────────────────────────────────

  it('delays grow exponentially with backoffFactor=2 (no jitter)', async () => {
    const delays: number[] = []
    const fn = async () => {
      throw new Error('persistent')
    }
    await settle(
      retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 50,
        backoffFactor: 2,
        jitter: false,
        onAttempt: (_e, _n, d) => delays.push(d),
      }),
    )
    // After failures 1,2,3,4 we'd schedule delays 50, 100, 200, 400.
    expect(delays).toEqual([50, 100, 200, 400])
  })

  it('respects custom backoffFactor (3x)', async () => {
    const delays: number[] = []
    await settle(
      retryWithBackoff(
        async () => {
          throw new Error('x')
        },
        {
          maxAttempts: 4,
          initialDelayMs: 10,
          backoffFactor: 3,
          jitter: false,
          onAttempt: (_e, _n, d) => delays.push(d),
        },
      ),
    )
    expect(delays).toEqual([10, 30, 90])
  })

  it('maxDelayMs caps growth', async () => {
    const delays: number[] = []
    await settle(
      retryWithBackoff(
        async () => {
          throw new Error('x')
        },
        {
          maxAttempts: 6,
          initialDelayMs: 100,
          backoffFactor: 10, // ramps fast
          maxDelayMs: 500,
          jitter: false,
          onAttempt: (_e, _n, d) => delays.push(d),
        },
      ),
    )
    // raw: 100, 1000, 10000, 100000, 1000000
    // capped at 500: 100, 500, 500, 500, 500
    expect(delays).toEqual([100, 500, 500, 500, 500])
  })

  it('jitter adds ±25% (delay in [base, base*1.25))', async () => {
    // Deterministic by stubbing Math.random.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const delays: number[] = []
    await settle(
      retryWithBackoff(
        async () => {
          throw new Error('x')
        },
        {
          maxAttempts: 3,
          initialDelayMs: 100,
          backoffFactor: 2,
          jitter: true,
          onAttempt: (_e, _n, d) => delays.push(d),
        },
      ),
    )
    // 100 * (1 + 0.5*0.25) = 112.5; 200 * 1.125 = 225
    expect(delays).toEqual([112.5, 225])
    randomSpy.mockRestore()
  })

  it('jitter is never negative (always ≥ base)', async () => {
    // Math.random can return [0, 1). Lowest value is 0, so jitter
    // floor is base + 0 = base. Verify with random=0.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const delays: number[] = []
    await settle(
      retryWithBackoff(
        async () => {
          throw new Error('x')
        },
        {
          maxAttempts: 3,
          initialDelayMs: 100,
          backoffFactor: 2,
          jitter: true,
          onAttempt: (_e, _n, d) => delays.push(d),
        },
      ),
    )
    expect(delays).toEqual([100, 200])
    randomSpy.mockRestore()
  })

  it('two runs with different randoms produce different delays (jitter active)', async () => {
    const delays1: number[] = []
    const delays2: number[] = []
    const s1 = vi.spyOn(Math, 'random').mockReturnValue(0.1)
    await settle(
      retryWithBackoff(
        async () => {
          throw new Error('x')
        },
        {
          maxAttempts: 3,
          initialDelayMs: 100,
          backoffFactor: 2,
          jitter: true,
          onAttempt: (_e, _n, d) => delays1.push(d),
        },
      ),
    )
    s1.mockRestore()
    const s2 = vi.spyOn(Math, 'random').mockReturnValue(0.9)
    await settle(
      retryWithBackoff(
        async () => {
          throw new Error('x')
        },
        {
          maxAttempts: 3,
          initialDelayMs: 100,
          backoffFactor: 2,
          jitter: true,
          onAttempt: (_e, _n, d) => delays2.push(d),
        },
      ),
    )
    s2.mockRestore()
    expect(delays1).not.toEqual(delays2)
    // Sanity: rand=0.9 produces larger delays than rand=0.1.
    expect(delays2[0]).toBeGreaterThan(delays1[0]!)
  })

  // ─── custom error / retained type ───────────────────────────────

  it('retains custom error type via cause and originalError', async () => {
    class MyDomainError extends Error {
      public readonly code = 'DOMAIN_X'
      public constructor() {
        super('domain failure')
        this.name = 'MyDomainError'
      }
    }
    const err = new MyDomainError()
    const fn = async () => {
      throw err
    }
    const r = await settle(retryWithBackoff(fn, { maxAttempts: 2 }))
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    const re = r.error as RetryError
    expect(re).toBeInstanceOf(RetryError)
    expect(re.originalError).toBe(err)
    expect(re.cause).toBe(err)
    expect((re.originalError as MyDomainError).code).toBe('DOMAIN_X')
  })

  // ─── edge cases ─────────────────────────────────────────────────

  it('maxAttempts=1 means no retries (one shot)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('one-shot')
    })
    const r = await settle(retryWithBackoff(fn, { maxAttempts: 1 }))
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect((r.error as RetryError).attempts).toBe(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('coerces invalid maxAttempts to defaults', async () => {
    const fn = vi.fn(async () => {
      throw new Error('x')
    })
    // NaN / undefined / 0 / -5 all fall back to a sane minimum.
    await settle(retryWithBackoff(fn, { maxAttempts: 0 }))
    expect(fn).toHaveBeenCalledTimes(1) // clamped to 1
  })

  it('exposes lastDelayMs in RetryError', async () => {
    const r = await settle(
      retryWithBackoff(
        async () => {
          throw new Error('x')
        },
        {
          maxAttempts: 3,
          initialDelayMs: 50,
          backoffFactor: 2,
          jitter: false,
        },
      ),
    )
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    const re = r.error as RetryError
    // After failure 1 we waited 50; after failure 2 we waited 100; then
    // failure 3 (no further wait). lastDelayMs is the last one we
    // actually waited — 100.
    expect(re.lastDelayMs).toBe(100)
  })

  it('passes a non-aborted signal to ctx on each attempt', async () => {
    const fn = vi.fn(async (ctx: RetryAttemptContext) => {
      expect(ctx.signal.aborted).toBe(false)
      return 'ok'
    })
    await settle(retryWithBackoff(fn))
    expect(fn).toHaveBeenCalled()
  })

  it('ctx.signal is fresh for each attempt (a previous timeout does not poison next)', async () => {
    const seenSignals: AbortSignal[] = []
    let calls = 0
    const fn = vi.fn(async (ctx: RetryAttemptContext) => {
      seenSignals.push(ctx.signal)
      calls += 1
      if (calls < 2) throw new Error('blip')
      return 'ok'
    })
    await settle(
      retryWithBackoff(fn, {
        maxAttempts: 3,
        attemptTimeoutMs: 10_000,
        initialDelayMs: 5,
        jitter: false,
      }),
    )
    expect(seenSignals[0]).not.toBe(seenSignals[1])
    expect(seenSignals[1]?.aborted).toBe(false)
  })
})

// ─── computeDelay (pure unit) ──────────────────────────────────────

describe('computeDelay', () => {
  it('no-jitter exponential', () => {
    expect(
      computeDelay({
        attempt: 1,
        initialDelayMs: 100,
        maxDelayMs: 30_000,
        backoffFactor: 2,
        jitter: false,
      }),
    ).toBe(100)
    expect(
      computeDelay({
        attempt: 2,
        initialDelayMs: 100,
        maxDelayMs: 30_000,
        backoffFactor: 2,
        jitter: false,
      }),
    ).toBe(200)
    expect(
      computeDelay({
        attempt: 3,
        initialDelayMs: 100,
        maxDelayMs: 30_000,
        backoffFactor: 2,
        jitter: false,
      }),
    ).toBe(400)
  })

  it('caps at maxDelayMs', () => {
    expect(
      computeDelay({
        attempt: 20,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffFactor: 2,
        jitter: false,
      }),
    ).toBe(1000)
  })

  it('jitter is non-negative and within ±25% of base', () => {
    const s = vi.spyOn(Math, 'random').mockReturnValue(0.999) // just under 1
    const d = computeDelay({
      attempt: 1,
      initialDelayMs: 100,
      maxDelayMs: 30_000,
      backoffFactor: 2,
      jitter: true,
    })
    s.mockRestore()
    expect(d).toBeGreaterThanOrEqual(100)
    expect(d).toBeLessThan(125) // 100 * 1.25 - epsilon
  })
})

// ─── isRetryableNetworkError ───────────────────────────────────────

describe('isRetryableNetworkError', () => {
  it('matches common transient codes', () => {
    expect(isRetryableNetworkError({ code: 'ECONNRESET' })).toBe(true)
    expect(isRetryableNetworkError({ code: 'ECONNREFUSED' })).toBe(true)
    expect(isRetryableNetworkError({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isRetryableNetworkError({ code: 'EPIPE' })).toBe(true)
    expect(isRetryableNetworkError({ code: 'EAI_AGAIN' })).toBe(true)
    expect(isRetryableNetworkError({ code: 'ENOTFOUND' })).toBe(true)
  })

  it('does not match unrelated codes', () => {
    expect(isRetryableNetworkError({ code: 'ENOENT' })).toBe(false)
    expect(isRetryableNetworkError({ code: 'EACCES' })).toBe(false)
  })

  it('does not match abort / timeout (caller decides)', () => {
    expect(isRetryableNetworkError(new AbortError())).toBe(false)
    expect(isRetryableNetworkError(new AttemptTimeoutError(1, 100))).toBe(false)
  })

  it('safe on non-objects', () => {
    expect(isRetryableNetworkError(null)).toBe(false)
    expect(isRetryableNetworkError(undefined)).toBe(false)
    expect(isRetryableNetworkError('ECONNRESET')).toBe(false)
    expect(isRetryableNetworkError(42)).toBe(false)
  })

  it('safe when code is non-string', () => {
    expect(isRetryableNetworkError({ code: 42 })).toBe(false)
    expect(isRetryableNetworkError({})).toBe(false)
  })
})

// ─── RetryError shape ──────────────────────────────────────────────

describe('RetryError', () => {
  it('exposes name, attempts, originalError, cause', () => {
    const inner = new Error('boom')
    const re = new RetryError(inner, 3, 200)
    expect(re.name).toBe('RetryError')
    expect(re.attempts).toBe(3)
    expect(re.lastDelayMs).toBe(200)
    expect(re.originalError).toBe(inner)
    expect(re.cause).toBe(inner)
    expect(re.message).toContain('3 attempt(s)')
    expect(re.message).toContain('boom')
  })

  it('handles non-Error original (string / object)', () => {
    const re1 = new RetryError('plain string', 1, 0)
    expect(re1.message).toContain('plain string')
    const re2 = new RetryError({ kind: 'weird' }, 1, 0)
    expect(re2.message).toContain('"kind"')
  })

  it('inherits stack from original Error', () => {
    const inner = new Error('boom')
    const innerStack = inner.stack
    const re = new RetryError(inner, 1, 0)
    expect(re.stack).toBe(innerStack)
  })
})

// ─── AbortError, AttemptTimeoutError ───────────────────────────────

describe('AbortError', () => {
  it('default message', () => {
    const e = new AbortError()
    expect(e.name).toBe('AbortError')
    expect(e.message).toMatch(/aborted/i)
  })
})

describe('AttemptTimeoutError', () => {
  it('records attempt and timeoutMs', () => {
    const e = new AttemptTimeoutError(3, 5000)
    expect(e.name).toBe('AttemptTimeoutError')
    expect(e.attempt).toBe(3)
    expect(e.timeoutMs).toBe(5000)
    expect(e.message).toContain('3')
    expect(e.message).toContain('5000')
  })
})
