import * as fs from 'node:fs'
import * as path from 'node:path'
import { ulid } from 'ulid'
import type { EventBus } from '../events/bus'
import type { HarnessEvent } from '../events/types'
import type { MessageEnvelope } from '../messaging/types'
import type { TaskGraph } from './taskGraph'
import type { A2ASubscription } from './types'

const TRIGGER_LIMIT = 3

export type A2ARouterOpts = {
  bus: EventBus
  graph: TaskGraph
  sessionId: string
  /**
   * Outbound `send_message` driver. Typically wired to `MessageRouter.send` from
   * `core/messaging/router.ts`. The router constructs a `MessageEnvelope` per
   * supplement and hands it off; the underlying backend is opaque to a2a.
   */
  send: (envelope: MessageEnvelope) => Promise<boolean>
  /** Where to persist subscriptions for crash recovery. */
  subsPath: string
}

/**
 * Watches `coordination.task.started` events on the bus, and when a started
 * task matches a registered subscription's `triggersOn`, instructs the
 * subscriber agent (still in `listening` state) to push a supplemental message
 * to the new task's owner — without going through the main agent.
 *
 * - Auto-cleanup on `coordination.task.completed` for `until-correlated-tasks-done` subs.
 * - Hard cap on triggerCount to prevent feedback loops.
 * - Subscriptions persist to JSON for crash recovery.
 */
export class A2ARouter {
  private subs: A2ASubscription[] = []
  private unsubFn: (() => void) | null = null

  constructor(private readonly opts: A2ARouterOpts) {
    this.unsubFn = this.opts.bus.subscribe<HarnessEvent>('harness', (e) => {
      if (e.type === 'coordination.task.started') void this.onTaskStarted(e)
      else if (e.type === 'coordination.task.completed') this.onTaskCompleted(e)
    })
  }

  dispose(): void {
    this.unsubFn?.()
    this.unsubFn = null
  }

  subscribe(sub: A2ASubscription): void {
    this.subs.push(sub)
    this.persist()
  }

  loadSubs(): void {
    if (!fs.existsSync(this.opts.subsPath)) return
    try {
      const raw = fs.readFileSync(this.opts.subsPath, 'utf8')
      this.subs = JSON.parse(raw) as A2ASubscription[]
    } catch {
      this.subs = []
    }
  }

  activeCount(): number {
    return this.subs.length
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.opts.subsPath), { recursive: true })
    const tmp = `${this.opts.subsPath}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(this.subs, null, 2), 'utf8')
    fs.renameSync(tmp, this.opts.subsPath)
  }

  private async onTaskStarted(
    e: Extract<HarnessEvent, { type: 'coordination.task.started' }>,
  ): Promise<void> {
    if (e.sessionId !== this.opts.sessionId) return
    const matches = this.subs.filter((s) => s.triggersOn.includes(e.taskId))
    for (const sub of matches) {
      if (sub.triggerCount >= TRIGGER_LIMIT) continue
      sub.triggerCount += 1
      const reason = `event-driven supplement: ${sub.ownsTaskId} → ${e.taskId}`
      this.opts.bus.emit('harness', {
        type: 'coordination.a2a.dispatched',
        sessionId: this.opts.sessionId,
        from: sub.subscriberAgentId,
        to: e.agentId,
        reason,
      })
      await this.opts.send(this.buildSupplement(sub, e.taskId, e.agentId, reason))
    }
    this.persist()
  }

  private onTaskCompleted(
    e: Extract<HarnessEvent, { type: 'coordination.task.completed' }>,
  ): void {
    if (e.sessionId !== this.opts.sessionId) return
    const before = this.subs.length
    this.subs = this.subs.filter((sub) => {
      if (sub.lifecycle !== 'until-correlated-tasks-done') return true
      // Drop if the just-completed task is one of triggersOn and all OTHER triggersOn
      // are already terminal in the graph snapshot.
      if (!sub.triggersOn.includes(e.taskId)) return true
      const restTerminal = sub.triggersOn
        .filter((id) => id !== e.taskId)
        .every((id) => {
          const node = this.opts.graph.snapshot().nodes[id]
          return node && (node.status === 'done' || node.status === 'failed')
        })
      return !restTerminal // keep if rest still pending; drop if all terminal
    })
    if (this.subs.length !== before) this.persist()
  }

  private buildSupplement(
    sub: A2ASubscription,
    targetTaskId: string,
    targetAgentId: string,
    reason: string,
  ): MessageEnvelope {
    const ownTask = this.opts.graph.snapshot().nodes[sub.ownsTaskId]
    const summarySrc = ownTask?.result?.summary ?? '(no summary)'
    const body =
      `Supplemental context from ${sub.subscriberAgentId} (just finished task ${sub.ownsTaskId}):\n` +
      `${summarySrc}\n` +
      `Reason: ${reason}\n` +
      `When you start ${targetTaskId}, please factor in any constraints/decisions from my work above.`
    return {
      id: ulid(),
      from: sub.subscriberAgentId,
      to: targetAgentId,
      summary: `a2a supplement: ${sub.ownsTaskId} → ${targetTaskId}`.slice(0, 200),
      message: body,
      sentAt: Date.now(),
    }
  }
}
