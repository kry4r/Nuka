import { describe, it, expect, vi } from 'vitest'
import { startIdleWatcher } from '../../../src/core/recap/idleWatcher'

describe('startIdleWatcher', () => {
  it('fires onAway after threshold and onReturn on next input', async () => {
    vi.useFakeTimers()
    const onAway = vi.fn()
    const onReturn = vi.fn()
    const w = startIdleWatcher({ thresholdMs: 1000, onAway, onReturn })
    await vi.advanceTimersByTimeAsync(1500)
    expect(onAway).toHaveBeenCalled()
    w.poke()                    // simulate a keystroke
    expect(onReturn).toHaveBeenCalled()
    w.stop()
    vi.useRealTimers()
  })

  it('does not fire onReturn if not away', async () => {
    vi.useFakeTimers()
    const onAway = vi.fn()
    const onReturn = vi.fn()
    const w = startIdleWatcher({ thresholdMs: 5000, onAway, onReturn })
    // poke immediately — never went away
    w.poke()
    expect(onReturn).not.toHaveBeenCalled()
    w.stop()
    vi.useRealTimers()
  })
})
