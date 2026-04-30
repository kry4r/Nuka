import type { MessageEnvelope } from './types'

export type MessageBackendKind = 'in-process' | 'uds' | 'bridge'

export interface MessageBackend {
  readonly kind: MessageBackendKind
  send(envelope: MessageEnvelope): Promise<boolean>
  subscribe(localAddress: string, cb: (e: MessageEnvelope) => void): () => void
}

export class InProcessBackend implements MessageBackend {
  readonly kind = 'in-process' as const
  private readonly subs = new Map<string, Set<(e: MessageEnvelope) => void>>()

  send(envelope: MessageEnvelope): Promise<boolean> {
    const handlers = this.subs.get(envelope.to)
    if (!handlers || handlers.size === 0) return Promise.resolve(false)
    for (const h of handlers) {
      try { h(envelope) } catch { /* never let one bad handler stop the rest */ }
    }
    return Promise.resolve(true)
  }

  subscribe(localAddress: string, cb: (e: MessageEnvelope) => void): () => void {
    let set = this.subs.get(localAddress)
    if (!set) { set = new Set(); this.subs.set(localAddress, set) }
    set.add(cb)
    return () => { set!.delete(cb); if (set!.size === 0) this.subs.delete(localAddress) }
  }
}
