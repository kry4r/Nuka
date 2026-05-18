// src/core/agents/coordinator/blackboard.ts
//
// B5 — In-memory key/value store shared by all sub-agents within a
// single coordinator invocation. Writes are serialised via a Promise
// chain (Node single-threaded but async tool calls may interleave on
// the same event loop turn). Snapshot returns a defensive copy so the
// coordinator can hand it to render code without aliasing.

import type { BlackboardSnapshot } from './types'

const MAX_TOTAL_BYTES = 256 * 1024

export class Blackboard {
  private data = new Map<string, string>()
  private chain: Promise<void> = Promise.resolve()
  private byteCount = 0

  async write(key: string, value: string): Promise<void> {
    if (key.length === 0) throw new Error('Blackboard: key must be non-empty')
    const incomingBytes = Buffer.byteLength(value, 'utf8')
    const next = this.chain.then(() => {
      const prevBytes = this.data.has(key)
        ? Buffer.byteLength(this.data.get(key) ?? '', 'utf8')
        : 0
      const projected = this.byteCount - prevBytes + incomingBytes
      if (projected > MAX_TOTAL_BYTES) {
        throw new Error(
          `Blackboard: total size cap (${MAX_TOTAL_BYTES} bytes) would be exceeded by write to "${key}"`,
        )
      }
      this.data.set(key, value)
      this.byteCount = projected
    })
    this.chain = next.catch(() => undefined)
    await next
  }

  read(key: string): string | undefined {
    return this.data.get(key)
  }

  list(): string[] {
    return [...this.data.keys()]
  }

  snapshot(): BlackboardSnapshot {
    const out: Record<string, string> = {}
    for (const [k, v] of this.data) out[k] = v
    return out
  }
}
