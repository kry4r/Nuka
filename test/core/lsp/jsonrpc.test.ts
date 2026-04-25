import { describe, it, expect } from 'vitest'
import { encodeMessage, MessageStream } from '../../../src/core/lsp/jsonrpc'

describe('encodeMessage', () => {
  it('produces a buffer with correct Content-Length header and body', () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'foo' }
    const buf = encodeMessage(msg)
    const str = buf.toString('utf8')
    const sepIdx = str.indexOf('\r\n\r\n')
    expect(sepIdx).toBeGreaterThan(0)

    const header = str.slice(0, sepIdx)
    const body = str.slice(sepIdx + 4)
    expect(header).toMatch(/^Content-Length: \d+$/)

    const clLine = header.split('\r\n').find(l => l.startsWith('Content-Length:'))!
    const clVal = parseInt(clLine.split(':')[1]!.trim(), 10)
    expect(clVal).toBe(Buffer.byteLength(body, 'utf8'))
    expect(JSON.parse(body)).toEqual(msg)
  })

  it('correctly computes byte length for multi-byte UTF-8 characters', () => {
    const msg = { jsonrpc: '2.0', id: 2, method: 'notify', params: { text: 'ñoño' } }
    const buf = encodeMessage(msg)
    const str = buf.toString('utf8')
    const sepIdx = str.indexOf('\r\n\r\n')
    const header = str.slice(0, sepIdx)
    const body = str.slice(sepIdx + 4)
    const clLine = header.split('\r\n').find(l => l.startsWith('Content-Length:'))!
    const clVal = parseInt(clLine.split(':')[1]!.trim(), 10)
    expect(clVal).toBe(Buffer.byteLength(body, 'utf8'))
  })
})

describe('MessageStream', () => {
  it('returns an empty array when read() is called with no data pushed', () => {
    const ms = new MessageStream()
    expect(ms.read()).toEqual([])
  })

  it('parses a single response message from a complete chunk', () => {
    const msg = { jsonrpc: '2.0' as const, id: 1, result: { capabilities: {} } }
    const ms = new MessageStream()
    ms.push(encodeMessage(msg))
    const [parsed] = ms.read()
    expect(parsed).toEqual(msg)
    // subsequent read() should be empty (drained)
    expect(ms.read()).toEqual([])
  })

  it('parses a single notification from a complete chunk', () => {
    const notif = { jsonrpc: '2.0' as const, method: 'textDocument/publishDiagnostics', params: { uri: 'file:///a.ts', diagnostics: [] } }
    const ms = new MessageStream()
    ms.push(encodeMessage(notif))
    const [parsed] = ms.read()
    expect(parsed).toEqual(notif)
  })

  it('parses two complete framed messages from a single chunk', () => {
    const msg1 = { jsonrpc: '2.0' as const, id: 1, result: { ok: true } }
    const msg2 = { jsonrpc: '2.0' as const, method: 'initialized', params: {} }
    const chunk = Buffer.concat([encodeMessage(msg1), encodeMessage(msg2)])
    const ms = new MessageStream()
    ms.push(chunk)
    const msgs = ms.read()
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toEqual(msg1)
    expect(msgs[1]).toEqual(msg2)
  })

  it('handles partial frame — read() returns nothing; second push completes the message', () => {
    const msg = { jsonrpc: '2.0' as const, id: 3, result: { value: 42 } }
    const full = encodeMessage(msg)
    const half = Math.floor(full.length / 2)

    const ms = new MessageStream()
    ms.push(full.slice(0, half))
    expect(ms.read()).toEqual([])

    ms.push(full.slice(half))
    const msgs = ms.read()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toEqual(msg)
  })

  it('handles a message split between header and body (separator boundary)', () => {
    const msg = { jsonrpc: '2.0' as const, id: 4, result: null }
    const full = encodeMessage(msg)
    // Split right at the \r\n\r\n separator
    const sepIdx = full.indexOf(Buffer.from('\r\n\r\n'))
    const part1 = full.slice(0, sepIdx + 2) // incomplete separator

    const ms = new MessageStream()
    ms.push(part1)
    expect(ms.read()).toEqual([])
    ms.push(full.slice(part1.length))
    expect(ms.read()).toHaveLength(1)
  })

  it('handles extra headers (Content-Type) in addition to Content-Length', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 5, result: {} })
    const byteLen = Buffer.byteLength(body, 'utf8')
    const header = `Content-Length: ${byteLen}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`
    const buf = Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(body, 'utf8')])
    const ms = new MessageStream()
    ms.push(buf)
    const msgs = ms.read()
    expect(msgs).toHaveLength(1)
    expect((msgs[0] as { id: number }).id).toBe(5)
  })

  it('handles three messages in a single push', () => {
    const msgs = [
      { jsonrpc: '2.0' as const, id: 1, result: 'a' },
      { jsonrpc: '2.0' as const, method: 'ping', params: {} },
      { jsonrpc: '2.0' as const, id: 2, result: 'b' },
    ]
    const chunk = Buffer.concat(msgs.map(encodeMessage))
    const ms = new MessageStream()
    ms.push(chunk)
    const parsed = ms.read()
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toEqual(msgs[0])
    expect(parsed[1]).toEqual(msgs[1])
    expect(parsed[2]).toEqual(msgs[2])
  })

  it('drains correctly — each read() call clears the pending list', () => {
    const msg = { jsonrpc: '2.0' as const, id: 1, result: {} }
    const ms = new MessageStream()
    ms.push(encodeMessage(msg))
    expect(ms.read()).toHaveLength(1)
    expect(ms.read()).toHaveLength(0)
  })
})
