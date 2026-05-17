// test/core/session/cronPromptQueue.test.ts
//
// Practical Iter JJJJ — Cron fire → agent input.
//
// Covers the queue's FIFO semantics, drain emptying, peek non-destructive
// read, the env-var gate helper, and the prefix-format helper. The agent
// loop integration (drain-at-runAgent-start) is exercised separately in
// `test/core/agent/loopCronInjection.test.ts`.

import { describe, it, expect } from 'vitest'
import {
  CronPromptQueue,
  formatCronPrompt,
  isCronPromptInjectionEnabled,
} from '../../../src/core/session/cronPromptQueue'

describe('CronPromptQueue — basic mechanics', () => {
  it('starts empty', () => {
    const q = new CronPromptQueue()
    expect(q.size).toBe(0)
    expect(q.peek()).toEqual([])
    expect(q.drain()).toEqual([])
  })

  it('enqueues a single entry and reports size', () => {
    const q = new CronPromptQueue()
    q.enqueue('t1', 'hello', 1000)
    expect(q.size).toBe(1)
    expect(q.peek()).toEqual([{ taskId: 't1', prompt: 'hello', firedAt: 1000 }])
  })

  it('drain returns entries and empties the queue', () => {
    const q = new CronPromptQueue()
    q.enqueue('t1', 'a', 1)
    q.enqueue('t2', 'b', 2)
    const out = q.drain()
    expect(out).toEqual([
      { taskId: 't1', prompt: 'a', firedAt: 1 },
      { taskId: 't2', prompt: 'b', firedAt: 2 },
    ])
    expect(q.size).toBe(0)
    expect(q.drain()).toEqual([])
  })

  it('preserves FIFO order across multiple enqueues', () => {
    const q = new CronPromptQueue()
    for (let i = 0; i < 5; i++) q.enqueue(`t${i}`, `p${i}`, i * 100)
    const out = q.drain()
    expect(out.map(e => e.taskId)).toEqual(['t0', 't1', 't2', 't3', 't4'])
    expect(out.map(e => e.firedAt)).toEqual([0, 100, 200, 300, 400])
  })

  it('peek is non-destructive', () => {
    const q = new CronPromptQueue()
    q.enqueue('t1', 'p1', 10)
    q.enqueue('t2', 'p2', 20)
    const view1 = q.peek()
    const view2 = q.peek()
    expect(view1).toEqual(view2)
    expect(q.size).toBe(2)
    // Subsequent drain still sees everything
    expect(q.drain()).toHaveLength(2)
  })

  it('allows duplicate taskIds (cron may re-fire the same task)', () => {
    const q = new CronPromptQueue()
    q.enqueue('t1', 'p1', 100)
    q.enqueue('t1', 'p1', 200)
    expect(q.size).toBe(2)
    const out = q.drain()
    expect(out).toEqual([
      { taskId: 't1', prompt: 'p1', firedAt: 100 },
      { taskId: 't1', prompt: 'p1', firedAt: 200 },
    ])
  })

  it('handles many enqueues without dropping', () => {
    const q = new CronPromptQueue()
    for (let i = 0; i < 100; i++) q.enqueue(`t${i}`, 'x', i)
    expect(q.size).toBe(100)
    expect(q.drain()).toHaveLength(100)
  })
})

describe('formatCronPrompt', () => {
  it('produces the [CRON id] prefix format', () => {
    expect(formatCronPrompt({ taskId: 'abc123', prompt: 'do thing', firedAt: 1 }))
      .toBe('[CRON abc123] do thing')
  })

  it('preserves multi-line prompts verbatim', () => {
    const out = formatCronPrompt({ taskId: 't1', prompt: 'line one\nline two', firedAt: 0 })
    expect(out).toBe('[CRON t1] line one\nline two')
  })
})

describe('isCronPromptInjectionEnabled', () => {
  it('returns true only for exact match "1"', () => {
    expect(isCronPromptInjectionEnabled({ NUKA_CRON_INJECT_PROMPTS: '1' })).toBe(true)
  })

  it('returns false for unset', () => {
    expect(isCronPromptInjectionEnabled({})).toBe(false)
  })

  it('returns false for "0"', () => {
    expect(isCronPromptInjectionEnabled({ NUKA_CRON_INJECT_PROMPTS: '0' })).toBe(false)
  })

  it('returns false for "true" / other truthy strings (exact match policy)', () => {
    expect(isCronPromptInjectionEnabled({ NUKA_CRON_INJECT_PROMPTS: 'true' })).toBe(false)
    expect(isCronPromptInjectionEnabled({ NUKA_CRON_INJECT_PROMPTS: 'yes' })).toBe(false)
    expect(isCronPromptInjectionEnabled({ NUKA_CRON_INJECT_PROMPTS: ' 1 ' })).toBe(false)
  })

  it('defaults to process.env when no arg given', () => {
    // Just verify the default-arg path doesn't throw. We don't mutate
    // process.env here — the previous tests cover all the value cases.
    expect(typeof isCronPromptInjectionEnabled()).toBe('boolean')
  })
})
