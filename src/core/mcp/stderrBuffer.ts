/**
 * A ring (circular) buffer for capturing stderr output from MCP stdio servers.
 * When the buffer is full, the oldest bytes are evicted to make room for new
 * bytes (FIFO eviction). Only a single contiguous string is maintained — when
 * the budget is exceeded we chop the front.
 */

export const DEFAULT_STDERR_BUFFER_BYTES = 64 * 1024 * 1024 // 64 MiB

export class RingBuffer {
  private maxBytes: number
  private buf: string = ''

  constructor(maxBytes: number) {
    if (maxBytes <= 0) throw new RangeError('maxBytes must be > 0')
    this.maxBytes = maxBytes
  }

  /**
   * Append `chunk` to the buffer. If the total length exceeds `maxBytes`,
   * the oldest bytes are dropped so that at most `maxBytes` bytes remain.
   */
  write(chunk: string | Buffer): void {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    this.buf += s
    if (this.buf.length > this.maxBytes) {
      this.buf = this.buf.slice(this.buf.length - this.maxBytes)
    }
  }

  /** Return the current contents of the buffer. */
  read(): string {
    return this.buf
  }

  /** Number of bytes currently stored. */
  size(): number {
    return this.buf.length
  }
}
