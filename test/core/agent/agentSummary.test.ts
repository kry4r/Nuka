import { describe, it, expect, vi } from 'vitest'
import { startAgentSummarizer } from '../../../src/core/agent/agentSummary'
import { ProgressTracker } from '../../../src/core/tasks/progressTracker'
import { createEventBus } from '../../../src/core/events/bus'

describe('startAgentSummarizer', () => {
  it('calls runForkedAgent on the configured interval and updates tracker', async () => {
    vi.useFakeTimers()
    const bus = createEventBus()
    const tracker = new ProgressTracker('t1', bus)
    let calls = 0
    const fakeRunFork = async () => { calls++; return { text: 'Reading foo.ts', usage: { input_tokens: 10, output_tokens: 5 } } }
    const stop = startAgentSummarizer({
      taskId: 't1',
      tracker,
      intervalMs: 100,
      runFork: fakeRunFork as never,
      buildPrompt: () => 'p',
    })
    await vi.advanceTimersByTimeAsync(350)
    stop.stop()
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(tracker.snapshot().summary).toBe('Reading foo.ts')
    vi.useRealTimers()
  })
})
