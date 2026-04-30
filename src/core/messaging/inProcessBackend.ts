import type { MessageEnvelope } from './types'

export type MessageBackendKind = 'in-process' | 'uds' | 'bridge'

export interface MessageBackend {
  readonly kind: MessageBackendKind
  send(envelope: MessageEnvelope): Promise<boolean>
  subscribe(localAddress: string, cb: (e: MessageEnvelope) => void): () => void
  pending(localAddress: string): number
  drain(localAddress: string): MessageEnvelope[]
}

export class InProcessBackend implements MessageBackend {
  readonly kind = 'in-process' as const
  private readonly subs = new Map<string, Set<(e: MessageEnvelope) => void>>()
  private readonly queue = new Map<string, MessageEnvelope[]>()

  send(envelope: MessageEnvelope): Promise<boolean> {
    const handlers = this.subs.get(envelope.to)
    if (handlers && handlers.size > 0) {
      for (const h of handlers) {
        try { h(envelope) } catch { /* never let one bad handler stop the rest */ }
      }
      return Promise.resolve(true)
    }
    // No live subscriber — queue for later drain.
    let q = this.queue.get(envelope.to)
    if (!q) { q = []; this.queue.set(envelope.to, q) }
    q.push(envelope)
    return Promise.resolve(false)
  }

  subscribe(localAddress: string, cb: (e: MessageEnvelope) => void): () => void {
    let set = this.subs.get(localAddress)
    if (!set) { set = new Set(); this.subs.set(localAddress, set) }
    set.add(cb)
    // Flush any previously-queued envelopes to this fresh subscriber.
    const q = this.queue.get(localAddress)
    if (q && q.length > 0) {
      for (const env of q) {
        try { cb(env) } catch { /* */ }
      }
      this.queue.delete(localAddress)
    }
    return () => {
      set!.delete(cb)
      if (set!.size === 0) this.subs.delete(localAddress)
    }
  }

  pending(localAddress: string): number {
    return this.queue.get(localAddress)?.length ?? 0
  }

  drain(localAddress: string): MessageEnvelope[] {
    const q = this.queue.get(localAddress)
    if (!q) return []
    this.queue.delete(localAddress)
    return q
  }
}
