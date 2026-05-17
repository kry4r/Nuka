// src/core/hooks/registry.ts
//
// In-process HookRegistry — a function-based event bus for the agent.
// Sibling to the existing shell-command hooks in `runner.ts` / `loader.ts`.
//
// Public surface:
//   - HookRegistry class with register/unregister/list/clear/invoke
//   - createHookRegistry() factory for callers that prefer not to `new`
//
// Wiring HookRegistry into actual tool execution / prompt rendering is a
// separate iter — this file just lands the infrastructure.

import {
  type HookContext,
  type HookHandler,
  type InProcessHookEvent,
  type InvocationResult,
  type InvokeOptions,
  type RegisteredHook,
  type RegisterOptions,
  isInProcessHookEvent,
} from './events'
import { compareRegisteredHooks, runPipeline } from './pipeline'

/**
 * Registry of in-process hook handlers.
 *
 * One registry instance is expected per agent session. Callers obtain it
 * from the host wiring (e.g. a future singleton in `cli.tsx`); plugins and
 * built-ins call `register()` to attach handlers, and the agent loop calls
 * `invoke(event, ctx)` at the relevant lifecycle points.
 */
export class HookRegistry {
  private readonly handlers = new Map<InProcessHookEvent, RegisteredHook[]>()
  /** Lookup by ID for fast unregister + duplicate-ID detection. */
  private readonly byId = new Map<string, RegisteredHook>()
  private nextInsertionOrder = 0
  private idCounter = 0

  /**
   * Register a handler for a given event.
   *
   * @returns the handler ID (caller-supplied via `opts.id` or generated).
   *
   * If `opts.id` collides with an existing registration, the previous
   * handler is replaced (mirrors how `registerHookCallbacks` in upstream
   * Nuka-Code merges callbacks on re-call).
   */
  register(
    event: InProcessHookEvent,
    handler: HookHandler,
    opts?: RegisterOptions,
  ): string {
    if (!isInProcessHookEvent(event)) {
      throw new Error(`HookRegistry.register: invalid event '${String(event)}'`)
    }
    if (typeof handler !== 'function') {
      throw new Error('HookRegistry.register: handler must be a function')
    }

    const id = opts?.id ?? this.generateId(event)
    const priority = opts?.priority ?? 0

    // Replace-on-collision: drop the previous handler with this ID, if any.
    const previous = this.byId.get(id)
    if (previous) {
      this.removeFromEventList(previous)
    }

    const record: RegisteredHook = {
      id,
      event,
      handler,
      priority,
      insertionOrder: this.nextInsertionOrder++,
    }

    const list = this.handlers.get(event)
    if (list) {
      list.push(record)
    } else {
      this.handlers.set(event, [record])
    }
    this.byId.set(id, record)

    return id
  }

  /**
   * Remove a handler by its ID. Returns `true` if a handler was removed.
   */
  unregister(handlerId: string): boolean {
    const record = this.byId.get(handlerId)
    if (!record) return false
    this.removeFromEventList(record)
    this.byId.delete(handlerId)
    return true
  }

  /**
   * List registered handlers. With no argument, lists across all events.
   * With an event, lists handlers for that event only.
   *
   * The returned array is a snapshot — mutating it does not affect the
   * registry. Order matches insertion (NOT priority); sort with
   * `compareRegisteredHooks` if priority order is required.
   */
  list(event?: InProcessHookEvent): RegisteredHook[] {
    if (event !== undefined) {
      return [...(this.handlers.get(event) ?? [])]
    }
    const all: RegisteredHook[] = []
    for (const list of this.handlers.values()) all.push(...list)
    return all
  }

  /**
   * Clear handlers. With no argument, clears every event. With an event,
   * clears only handlers registered for that event.
   */
  clear(event?: InProcessHookEvent): void {
    if (event !== undefined) {
      const list = this.handlers.get(event)
      if (!list) return
      for (const record of list) this.byId.delete(record.id)
      this.handlers.delete(event)
      return
    }
    this.handlers.clear()
    this.byId.clear()
  }

  /**
   * Invoke all handlers for `event`. Runs sequentially in priority order
   * (higher first), with insertion order breaking ties.
   *
   * Returns one `InvocationResult` per handler — including handlers that
   * threw (`outcome: 'error'`) and handlers that didn't run because the
   * signal was aborted (`outcome: 'aborted'`).
   */
  async invoke(
    event: InProcessHookEvent,
    context: Omit<HookContext, 'event' | 'signal'>,
    opts?: InvokeOptions,
  ): Promise<InvocationResult[]> {
    const list = this.handlers.get(event)
    if (!list || list.length === 0) return []

    // Sort a copy — never mutate the canonical list, since callers may be
    // re-entrantly registering handlers from inside a handler.
    const ordered = [...list].sort(compareRegisteredHooks)
    const fullCtx: HookContext = { ...context, event, signal: opts?.signal }
    return runPipeline(ordered, fullCtx, opts?.signal)
  }

  private removeFromEventList(record: RegisteredHook): void {
    const list = this.handlers.get(record.event)
    if (!list) return
    const idx = list.indexOf(record)
    if (idx >= 0) list.splice(idx, 1)
    if (list.length === 0) this.handlers.delete(record.event)
  }

  private generateId(event: InProcessHookEvent): string {
    return `hook_${event}_${++this.idCounter}`
  }
}

/**
 * Factory for callers that prefer not to use `new`.
 */
export function createHookRegistry(): HookRegistry {
  return new HookRegistry()
}
