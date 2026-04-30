import type { MessageBackend } from './inProcessBackend'
import type { MessageEnvelope } from './types'

export class UdsBackend implements MessageBackend {
  readonly kind = 'uds' as const
  send(_envelope: MessageEnvelope): Promise<boolean> { return Promise.resolve(false) }
  subscribe(_localAddress: string, _cb: (e: MessageEnvelope) => void): () => void { return () => {} }
  pending(_localAddress: string): number { return 0 }
  drain(_localAddress: string): MessageEnvelope[] { return [] }
}
