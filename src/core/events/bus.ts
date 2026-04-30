import type {
  Topic, TaskEvent, AgentBusEvent, MessageEvent, HarnessEvent,
} from './types'

type AnyHandler = (e: unknown) => void

export interface EventBus {
  emit(topic: 'task', e: TaskEvent): void
  emit(topic: 'agent', e: AgentBusEvent): void
  emit(topic: 'message', e: MessageEvent): void
  emit(topic: 'harness', e: HarnessEvent): void
  subscribe<E>(topic: Topic, cb: (e: E) => void, filter?: (e: E) => boolean): () => void
  replay<E>(topic: Topic, n: number): E[]
}

export type CreateEventBusOpts = { ringSize?: number }

export function createEventBus(opts: CreateEventBusOpts = {}): EventBus {
  const ringSize = opts.ringSize ?? 1024
  const ring: Map<Topic, unknown[]> = new Map([
    ['task', []], ['agent', []], ['message', []], ['harness', []],
  ])
  const handlers: Map<Topic, Set<AnyHandler>> = new Map([
    ['task', new Set()], ['agent', new Set()],
    ['message', new Set()], ['harness', new Set()],
  ])

  const push = <T>(topic: Topic, ev: T): void => {
    const buf = ring.get(topic)!
    buf.push(ev)
    if (buf.length > ringSize) buf.shift()
    for (const h of handlers.get(topic)!) {
      try { h(ev) } catch { /* swallow handler errors — bus must not crash emitter */ }
    }
  }

  return {
    emit: (topic: Topic, e: unknown): void => push(topic, e),
    subscribe<E>(topic: Topic, cb: (e: E) => void, filter?: (e: E) => boolean): () => void {
      const wrap: AnyHandler = (e) => {
        if (!filter || filter(e as E)) cb(e as E)
      }
      handlers.get(topic)!.add(wrap)
      return () => { handlers.get(topic)!.delete(wrap) }
    },
    replay<E>(topic: Topic, n: number): E[] {
      const buf = ring.get(topic)!
      return buf.slice(-n) as E[]
    },
  } as EventBus
}

export const eventBus: EventBus = createEventBus()
