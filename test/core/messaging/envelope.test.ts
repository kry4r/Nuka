import { describe, it, expect } from 'vitest'
import { MessageEnvelopeSchema, ProtocolMessageSchema } from '../../../src/core/messaging/types'

describe('MessageEnvelopeSchema', () => {
  it('round-trips a string-body message', () => {
    const e = {
      id: '01ABCXYZ',
      from: 'team:demo/alice',
      to: 'team:demo/bob',
      summary: 'hello',
      message: 'hi bob',
      sentAt: 1700000000000,
    }
    expect(MessageEnvelopeSchema.parse(e)).toEqual(e)
  })

  it('rejects empty summary', () => {
    expect(() => MessageEnvelopeSchema.parse({
      id: 'x', from: 'a', to: 'b', summary: '', message: 'hi', sentAt: 0,
    })).toThrow()
  })

  it('round-trips a shutdown_request protocol message', () => {
    const proto = { type: 'shutdown_request' as const, request_id: 'r1' }
    expect(ProtocolMessageSchema.parse(proto)).toEqual(proto)
    const env = {
      id: 'x', from: 'a', to: 'b', summary: 'shutdown', message: proto, request_id: 'r1', sentAt: 1,
    }
    expect(MessageEnvelopeSchema.parse(env).message).toEqual(proto)
  })

  it('rejects an unknown protocol type', () => {
    expect(() => ProtocolMessageSchema.parse({ type: 'noooope' })).toThrow()
  })
})
