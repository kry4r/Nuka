import { describe, it, expect } from 'vitest'
import { reduceKeyDecisions } from '../../../../src/core/recap/fields/keyDecisions'

describe('reduceKeyDecisions', () => {
  it('extracts tagged directives: 2 out of 5', () => {
    const r = reduceKeyDecisions([
      { topic: 'harness', t: 100, payload: { type: 'harness.editor.directive', sessionId: 's1', directive: '[brainstorm] Use discriminated union' } },
      { topic: 'harness', t: 200, payload: { type: 'harness.editor.directive', sessionId: 's1', directive: 'untagged directive' } },
      { topic: 'harness', t: 300, payload: { type: 'harness.editor.directive', sessionId: 's1', directive: '[plan] Add retry logic' } },
      { topic: 'harness', t: 400, payload: { type: 'harness.editor.directive', sessionId: 's1', directive: 'another untagged' } },
      { topic: 'harness', t: 500, payload: { type: 'harness.editor.directive', sessionId: 's1', directive: 'yet another' } },
    ])
    expect(r.length).toBe(2)
    expect(r[0]!.source).toBe('brainstorm')
    expect(r[1]!.source).toBe('plan')
  })

  it('recognizes handoff tag', () => {
    const r = reduceKeyDecisions([
      { topic: 'harness', t: 100, payload: { type: 'harness.editor.directive', sessionId: 's1', directive: '[handoff] Move to impl stage' } },
    ])
    expect(r.length).toBe(1)
    expect(r[0]!.source).toBe('handoff')
    expect(r[0]!.text).toBe('Move to impl stage')
  })

  it('ignores non-harness events', () => {
    const r = reduceKeyDecisions([
      { topic: 'task', t: 0, payload: { type: 'task.created', task: { id: 't1' } } },
    ])
    expect(r).toEqual([])
  })
})
