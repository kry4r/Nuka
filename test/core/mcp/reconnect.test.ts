import { describe, it, expect, vi } from 'vitest'
import {
  nextDelay,
  reconnectWithBackoff,
  isSessionExpiryError,
  DEFAULT_RECONNECT_POLICY,
} from '../../../src/core/mcp/reconnect'

describe('nextDelay', () => {
  it('produces exponential backoff capped at maxDelayMs', () => {
    const policy = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30_000 }
    expect(nextDelay(1, policy)).toBe(1000)
    expect(nextDelay(2, policy)).toBe(2000)
    expect(nextDelay(3, policy)).toBe(4000)
    expect(nextDelay(4, policy)).toBe(8000)
    expect(nextDelay(5, policy)).toBe(16_000)
    expect(nextDelay(6, policy)).toBe(30_000) // capped
    expect(nextDelay(10, policy)).toBe(30_000) // still capped
  })

  it('returns 0 when attempt < 1', () => {
    expect(nextDelay(0, DEFAULT_RECONNECT_POLICY)).toBe(0)
  })
})

describe('reconnectWithBackoff', () => {
  it('succeeds on the first attempt without sleeping', async () => {
    const doConnect = vi.fn().mockResolvedValue(undefined)
    const r = await reconnectWithBackoff(doConnect, {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    })
    expect(r).toEqual({ ok: true })
    expect(doConnect).toHaveBeenCalledTimes(1)
  })

  it('retries and eventually succeeds', async () => {
    let calls = 0
    const doConnect = vi.fn().mockImplementation(async () => {
      calls += 1
      if (calls < 3) throw new Error('nope')
    })
    const r = await reconnectWithBackoff(doConnect, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
    })
    expect(r).toEqual({ ok: true })
    expect(doConnect).toHaveBeenCalledTimes(3)
  })

  it('returns error after exhausting maxAttempts', async () => {
    const doConnect = vi.fn().mockRejectedValue(new Error('spawn failed'))
    const r = await reconnectWithBackoff(doConnect, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
    })
    expect(r).toEqual({ ok: false, error: 'spawn failed', attempts: 3 })
  })

  it('short-circuits on abort before further attempts', async () => {
    const ac = new AbortController()
    let calls = 0
    const doConnect = vi.fn().mockImplementation(async () => {
      calls += 1
      if (calls === 1) ac.abort()
      throw new Error('nope')
    })
    const r = await reconnectWithBackoff(
      doConnect,
      { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 20 },
      ac.signal,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('aborted')
  })
})

describe('isSessionExpiryError', () => {
  it('matches HTTP 404 errors', () => {
    expect(isSessionExpiryError(new Error('POST /mcp 404 Not Found'))).toBe(true)
  })

  it('matches JSON-RPC -32001 by substring', () => {
    expect(isSessionExpiryError(new Error('JSON-RPC error -32001: session expired'))).toBe(true)
  })

  it('matches by `code` property on error-like objects', () => {
    expect(isSessionExpiryError({ code: -32001, message: 'expired' })).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isSessionExpiryError(new Error('connection refused'))).toBe(false)
    expect(isSessionExpiryError(null)).toBe(false)
  })
})
