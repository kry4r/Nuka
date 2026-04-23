import { describe, it, expect } from 'vitest'
import {
  makeUserMessage,
  makeToolMessage,
  emptyAssistant,
} from '../../../src/core/message/factories'

describe('message factories', () => {
  it('makeUserMessage wraps text as a single text block', () => {
    const m = makeUserMessage({ text: 'hi' })
    expect(m.role).toBe('user')
    expect(m.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(typeof m.id).toBe('string')
    expect(m.id.length).toBeGreaterThan(0)
    expect(m.ts).toBeGreaterThan(0)
  })

  it('makeToolMessage records result + error flag', () => {
    const m = makeToolMessage('call-123', { output: 'ok', isError: false })
    expect(m.role).toBe('tool')
    expect(m.toolUseId).toBe('call-123')
    expect(m.content).toBe('ok')
    expect(m.isError).toBe(false)
  })

  it('emptyAssistant starts with empty content array', () => {
    const a = emptyAssistant()
    expect(a.role).toBe('assistant')
    expect(a.content).toEqual([])
  })
})
