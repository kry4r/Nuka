// src/core/session/queue.ts
export class MessageQueue {
  private buf: string[] = []
  push(text: string): void { this.buf.push(text) }
  hasPending(): boolean { return this.buf.length > 0 }
  size(): number { return this.buf.length }
  drain(): string[] {
    const out = this.buf
    this.buf = []
    return out
  }
}
