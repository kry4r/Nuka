import type { Task, InProcessTeammateSpec } from './types'
import type { EventBus } from '../events/bus'
import type { MessageRouter } from '../messaging/router'
import type { ProtocolMessage, MessageEnvelope } from '../messaging/types'
import { ProgressTracker } from './progressTracker'
import { ulid } from 'ulid'

export type RunTeammateDeps = {
  bus: EventBus
  router: MessageRouter
  providerResolver: { resolve?: (...args: unknown[]) => unknown }
  runOneTurn: (session: unknown, userMessage: string) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>
  home: string
  summarizerInterval?: number
}

export async function runTeammate(task: Task, signal: AbortSignal, deps?: RunTeammateDeps): Promise<void> {
  if (!deps) {
    // Called without deps (e.g. from TaskManager stub path) — no-op.
    throw new Error('run-teammate: deps required (phase14a)')
  }

  const spec = task.spec as InProcessTeammateSpec
  const localAddr = `team:${spec.teamName}/${spec.agentName}`
  const tracker = new ProgressTracker(task.id, deps.bus)
  const pendingMessages: string[] = [spec.initialMessage]
  let shutdown = false
  let waitResolver: (() => void) | null = null

  // Subscribe to incoming messages on our local address
  const inboxOff = deps.router.inbox(localAddr).subscribe((env: MessageEnvelope) => {
    const msg = env.message
    if (typeof msg === 'object' && msg !== null && 'type' in msg) {
      const proto = msg as ProtocolMessage
      if (proto.type === 'shutdown_request') {
        shutdown = true
        // Send shutdown_response back
        void deps.router.send({
          id: ulid(),
          from: localAddr,
          to: env.from,
          summary: 'shutdown acknowledged',
          message: { type: 'shutdown_response', request_id: proto.request_id, approve: true },
          sentAt: Date.now(),
        })
      } else {
        // Other protocol messages (handoff, plan_approval_request, etc.) — treat as string
        pendingMessages.push(JSON.stringify(msg))
      }
    } else if (typeof msg === 'string') {
      pendingMessages.push(msg)
    }
    if (waitResolver) { waitResolver(); waitResolver = null }
  })

  // When the manager flips task state to 'shutdown_requested' via the bus, emit a
  // shutdown_request envelope to our own address so the inbox handler above can
  // respond with a shutdown_response and exit cleanly. (manager.ts:175)
  const busOff = deps.bus.subscribe('task', (e: unknown) => {
    const ev = e as { type: string; id: string; to: string }
    if (ev.type === 'task.state' && ev.id === task.id && ev.to === 'shutdown_requested') {
      void deps.router.send({
        id: ulid(),
        from: 'manager',
        to: localAddr,
        summary: 'shutdown requested by manager',
        message: { type: 'shutdown_request', request_id: ulid() },
        sentAt: Date.now(),
      })
    }
  })

  // Build a minimal session record
  const session = {
    id: task.id,
    isWorker: true,
    allowedTeamCreate: false,
    teamName: spec.teamName,
    agentName: spec.agentName,
    providerId: '',
    model: spec.agentDef.model ?? '',
    messages: [] as unknown[],
  }

  while (!signal.aborted && !shutdown) {
    if (pendingMessages.length === 0) {
      deps.bus.emit('task', { type: 'task.state', id: task.id, from: 'running', to: 'idle' })
      await new Promise<void>((res) => {
        waitResolver = res
        signal.addEventListener('abort', () => res(), { once: true })
      })
      if (signal.aborted || shutdown) break
      deps.bus.emit('task', { type: 'task.state', id: task.id, from: 'idle', to: 'running' })
      continue
    }
    const next = pendingMessages.shift()!
    try {
      const turn = await deps.runOneTurn(session, next)
      tracker.onUsage(turn.usage)
    } catch {
      // swallow — single turn failures don't kill the teammate
    }
  }

  inboxOff()
  busOff()
}
