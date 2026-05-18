import { describe, it, expect } from 'vitest'
import type { SessionId, HistoryRecord, HistoryListEntry } from '../../../../src/core/session/history/types'

describe('history types', () => {
  it('SessionId is a branded string', () => {
    const id: SessionId = 'abc' as SessionId
    expect(typeof id).toBe('string')
  })
  it('HistoryListEntry shape', () => {
    const e: HistoryListEntry = {
      id: 'x' as SessionId,
      providerId: 'anthropic',
      model: 'claude-sonnet',
      messageCount: 3,
      preview: 'hi',
      createdAt: 1,
      updatedAt: 2,
    }
    expect(e.preview).toBe('hi')
  })
  it('HistoryRecord shape', () => {
    const r: HistoryRecord = {
      id: 'x' as SessionId,
      providerId: 'p',
      model: 'm',
      mode: 'normal',
      messageCount: 0,
      totalUsage: { inputTokens: 0, outputTokens: 0 },
      preview: '',
      createdAt: 0,
      updatedAt: 0,
    }
    expect(r.id).toBe('x')
  })
})
