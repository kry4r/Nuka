import type { EventBus } from '../events/bus'
import type { MessageBackend } from './inProcessBackend'
import type { MessageEnvelope } from './types'

export type RouterOpts = {
  backends: MessageBackend[]
  bus: EventBus
}

export type BroadcastOpts = {
  teamName: string
  members: string[]
  base: Omit<MessageEnvelope, 'to'>
}

export class MessageRouter {
  constructor(private readonly opts: RouterOpts) {}

  async send(envelope: MessageEnvelope): Promise<boolean> {
    this.opts.bus.emit('message', { type: 'message.sent', envelope })
    for (const b of this.opts.backends) {
      const ok = await b.send(envelope)
      if (ok) {
        this.opts.bus.emit('message', { type: 'message.delivered', envelopeId: envelope.id, to: envelope.to })
        return true
      }
    }
    this.opts.bus.emit('message', { type: 'message.failed', envelopeId: envelope.id, reason: 'no backend accepted' })
    return false
  }

  inbox(localAddress: string): {
    subscribe(cb: (e: MessageEnvelope) => void): () => void
  } {
    return {
      subscribe: (cb): (() => void) => {
        const offs = this.opts.backends.map(b => b.subscribe(localAddress, cb))
        return () => offs.forEach(off => off())
      },
    }
  }

  async broadcast(opts: BroadcastOpts): Promise<number> {
    let delivered = 0
    for (const m of opts.members) {
      const env: MessageEnvelope = { ...opts.base, to: `team:${opts.teamName}/${m}` }
      if (await this.send(env)) delivered++
    }
    return delivered
  }
}
