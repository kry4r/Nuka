// test/core/sleep/tool.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SLEEP_MAX_SECONDS,
  SLEEP_TOOL_NAME,
  SleepTool,
  sleepMs,
} from '../../../src/core/sleep/tool'

function mkCtx(signal: AbortSignal = new AbortController().signal) {
  return { signal, cwd: process.cwd() }
}

describe('Sleep tool', () => {
  describe('schema + metadata', () => {
    it('exposes the upstream-equivalent name', () => {
      expect(SleepTool.name).toBe(SLEEP_TOOL_NAME)
      expect(SLEEP_TOOL_NAME).toBe('Sleep')
    })

    it('is read-only and parallel-safe (matches upstream "call concurrently" guidance)', () => {
      expect(SleepTool.annotations?.readOnly).toBe(true)
      expect(SleepTool.annotations?.parallelSafe).toBe(true)
      expect(SleepTool.needsPermission({ seconds: 1 })).toBe('none')
    })

    it('declares a required `seconds` number with 0..MAX bounds', () => {
      const params = SleepTool.parameters as {
        required?: string[]
        properties?: Record<string, { type: string; minimum?: number; maximum?: number }>
      }
      expect(params.required).toEqual(['seconds'])
      expect(params.properties?.seconds?.type).toBe('number')
      expect(params.properties?.seconds?.minimum).toBe(0)
      expect(params.properties?.seconds?.maximum).toBe(SLEEP_MAX_SECONDS)
    })

    it('declares core + sleep tags so it loads under the core activation rule', () => {
      expect(SleepTool.tags).toContain('core')
      expect(SleepTool.tags).toContain('sleep')
    })
  })

  describe('happy path (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('resolves after the requested duration', async () => {
      const promise = SleepTool.run({ seconds: 2 }, mkCtx())
      // Not yet resolved.
      let settled = false
      void promise.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(1999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      const r = await promise
      expect(r.isError).toBe(false)
      expect(r.output).toBe('Slept 2s.')
    })

    it('returns immediately for zero duration (yield-style use)', async () => {
      const r = await SleepTool.run({ seconds: 0 }, mkCtx())
      expect(r.isError).toBe(false)
      expect(r.output).toBe('Slept 0s.')
    })

    it('honours fractional seconds (converted to ms internally)', async () => {
      const promise = SleepTool.run({ seconds: 0.5 }, mkCtx())
      let settled = false
      void promise.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(499)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      const r = await promise
      expect(r.isError).toBe(false)
      expect(r.output).toBe('Slept 0.5s.')
    })
  })

  describe('input validation (runtime guard)', () => {
    it('rejects negative seconds', async () => {
      const r = await SleepTool.run({ seconds: -1 }, mkCtx())
      expect(r.isError).toBe(true)
      expect(r.output).toContain('>= 0')
    })

    it('rejects seconds above the max bound', async () => {
      const r = await SleepTool.run(
        { seconds: SLEEP_MAX_SECONDS + 1 },
        mkCtx(),
      )
      expect(r.isError).toBe(true)
      expect(r.output).toContain(`<= ${SLEEP_MAX_SECONDS}`)
      // Steers the model toward the right tool for long waits.
      expect(r.output).toContain('CronCreate')
    })

    it('rejects non-finite numbers (NaN / Infinity)', async () => {
      const nan = await SleepTool.run(
        { seconds: Number.NaN } as { seconds: number },
        mkCtx(),
      )
      expect(nan.isError).toBe(true)
      expect(nan.output).toContain('finite number')

      const inf = await SleepTool.run(
        { seconds: Number.POSITIVE_INFINITY } as { seconds: number },
        mkCtx(),
      )
      expect(inf.isError).toBe(true)
      expect(inf.output).toContain('finite number')
    })

    it('rejects a non-number `seconds`', async () => {
      const r = await SleepTool.run(
        { seconds: 'soon' as unknown as number },
        mkCtx(),
      )
      expect(r.isError).toBe(true)
      expect(r.output).toContain('finite number')
    })
  })

  describe('AbortSignal support (upstream parity: silent resolve on abort)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns immediately when the signal is already aborted', async () => {
      const ac = new AbortController()
      ac.abort()
      const r = await SleepTool.run({ seconds: 60 }, mkCtx(ac.signal))
      expect(r.isError).toBe(false)
      expect(r.output).toContain('interrupted')
    })

    it('cuts the wait short when aborted mid-sleep', async () => {
      const ac = new AbortController()
      const promise = SleepTool.run({ seconds: 30 }, mkCtx(ac.signal))
      await vi.advanceTimersByTimeAsync(100)
      ac.abort()
      const r = await promise
      expect(r.isError).toBe(false)
      expect(r.output).toContain('interrupted')
      // Should reference the originally-requested duration so the model
      // can see how much of its wait got cut.
      expect(r.output).toContain('requested 30s')
    })
  })

  describe('sleepMs helper (exported for direct testing)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('schedules a timer for the requested ms', async () => {
      let resolved = false
      const p = sleepMs(50).then(() => {
        resolved = true
      })
      await vi.advanceTimersByTimeAsync(49)
      expect(resolved).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      await p
      expect(resolved).toBe(true)
    })

    it('resolves immediately if the signal is already aborted', async () => {
      const ac = new AbortController()
      ac.abort()
      let resolved = false
      const p = sleepMs(10_000, ac.signal).then(() => {
        resolved = true
      })
      await p
      expect(resolved).toBe(true)
    })

    it('cleans up the abort listener after natural completion', async () => {
      const ac = new AbortController()
      const removeSpy = vi.spyOn(ac.signal, 'removeEventListener')
      const p = sleepMs(10, ac.signal)
      await vi.advanceTimersByTimeAsync(11)
      await p
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    })
  })
})
