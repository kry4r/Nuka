// src/core/lsp/jsonrpc.ts
// Minimal LSP JSON-RPC 2.0 framing over stdio
// Protocol: "Content-Length: N\r\n\r\n<body>" where N is UTF-8 byte count of body

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

export type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/** Produces a Content-Length framed buffer ready to write to an LSP server's stdin. */
export function encodeMessage(msg: unknown): Buffer {
  const body = JSON.stringify(msg)
  const byteLength = Buffer.byteLength(body, 'utf8')
  const header = `Content-Length: ${byteLength}\r\n\r\n`
  return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(body, 'utf8')])
}

const SEPARATOR = Buffer.from('\r\n\r\n')

/**
 * Streaming parser for LSP JSON-RPC framed messages.
 * Call push() with incoming data chunks; call read() to drain parsed messages.
 * Handles partial headers, partial bodies, and multiple messages per chunk.
 */
export class MessageStream {
  private _buf: Buffer = Buffer.alloc(0)
  private _pending: Array<JsonRpcResponse | JsonRpcNotification> = []

  push(chunk: Buffer): void {
    this._buf = Buffer.concat([this._buf, chunk])
    this._extract()
  }

  /** Returns all parsed messages since the last call to read(), then clears the list. */
  read(): Array<JsonRpcResponse | JsonRpcNotification> {
    const msgs = this._pending
    this._pending = []
    return msgs
  }

  private _extract(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const sepIdx = this._buf.indexOf(SEPARATOR)
      if (sepIdx === -1) break // incomplete header

      const headerBytes = this._buf.slice(0, sepIdx).toString('ascii')
      const contentLength = parseContentLength(headerBytes)
      if (contentLength === null) {
        // Malformed header — discard up to separator and continue
        this._buf = this._buf.slice(sepIdx + SEPARATOR.length)
        continue
      }

      const bodyStart = sepIdx + SEPARATOR.length
      if (this._buf.length < bodyStart + contentLength) break // incomplete body

      const bodyBytes = this._buf.slice(bodyStart, bodyStart + contentLength)
      this._buf = this._buf.slice(bodyStart + contentLength)

      let parsed: unknown
      try {
        parsed = JSON.parse(bodyBytes.toString('utf8'))
      } catch (err) {
        throw new Error(`LSP JSON-RPC: failed to parse message body: ${(err as Error).message}`)
      }

      if (isResponse(parsed)) {
        this._pending.push(parsed)
      } else if (isNotification(parsed)) {
        this._pending.push(parsed)
      }
      // Unrecognized messages are silently dropped
    }
  }
}

function parseContentLength(headers: string): number | null {
  for (const line of headers.split('\r\n')) {
    const lower = line.toLowerCase()
    if (lower.startsWith('content-length:')) {
      const val = line.slice('content-length:'.length).trim()
      const n = parseInt(val, 10)
      return isNaN(n) ? null : n
    }
  }
  return null
}

function isResponse(v: unknown): v is JsonRpcResponse {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o['jsonrpc'] === '2.0' && typeof o['id'] === 'number' && ('result' in o || 'error' in o)
}

function isNotification(v: unknown): v is JsonRpcNotification {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o['jsonrpc'] === '2.0' && typeof o['method'] === 'string' && !('id' in o)
}
