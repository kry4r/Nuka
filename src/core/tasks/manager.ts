// src/core/tasks/manager.ts
//
// Phase 10 §4.3 — TaskManager.
//
// Single-host, in-process registry of background tasks. Each
// `enqueue(spec)` immediately starts the corresponding runner, persists
// output to disk, and emits `change` events on every state transition.
//
// IDs use `crypto.randomUUID().slice(0, 8)` (no extra dep — the spec
// hot-tip explicitly authorises this in lieu of ulid).

import { randomUUID } from 'node:crypto'
import { runBash } from './run-bash'
import { runAgent } from './run-agent'
import {
  appendOutputSync,
  ensureTasksDirSync,
  taskOutputPath,
} from './persist'
import type {
  Task,
  TaskChangeListener,
  TaskSpec,
  TaskState,
} from './types'

export type TaskManagerOpts = {
  /** Filesystem root for task logs (`<home>/.nuka/tasks/<id>.log`). */
  home: string
}

type RunningEntry = {
  task: Task
  abort: AbortController
  done: Promise<void>
}

export class TaskManager {
  private readonly home: string
  private readonly tasks = new Map<string, Task>()
  private readonly running = new Map<string, RunningEntry>()
  private readonly listeners = new Set<TaskChangeListener>()

  constructor(opts: TaskManagerOpts) {
    this.home = opts.home
  }

  /** Subscribe to state-change events. Returns an unsubscribe function. */
  on(_event: 'change', cb: TaskChangeListener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** Snapshot of all known tasks (any state). Newest first. */
  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => {
      const aT = a.startedAt ?? 0
      const bT = b.startedAt ?? 0
      return bT - aT
    })
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  /**
   * Submit a task spec. Returns a `Task` snapshot that's already been
   * registered (state: `running`). The runner is launched synchronously
   * so callers can subscribe to `change` events without races.
   */
  enqueue(spec: TaskSpec): Task {
    const id = randomUUID().slice(0, 8)
    // Ensure the output dir exists synchronously so the first append
    // call in the runner cannot race the mkdir.
    try { ensureTasksDirSync(this.home) } catch { /* runner will report write failures */ }

    const outputFile = taskOutputPath(this.home, id)
    const task: Task = {
      id,
      kind: spec.kind,
      description: spec.description,
      state: 'pending',
      outputFile,
      spec,
    }
    this.tasks.set(id, task)
    this.transition(task, 'running', { startedAt: Date.now() })

    const abort = new AbortController()
    const done = this.startRunner(task, abort.signal).catch((err) => {
      this.fail(task, (err as Error)?.message ?? 'unknown error')
    })
    this.running.set(id, { task, abort, done })

    return { ...task }
  }

  /**
   * Cancel a running task. Sends SIGTERM (for bash) or aborts the
   * runner's signal (for agent/monitor). Resolves once the runner has
   * settled.
   */
  async cancel(id: string): Promise<void> {
    const entry = this.running.get(id)
    if (!entry) return
    entry.abort.abort()
    // Mark as killed up front so observers see the intent immediately;
    // the runner's exit will keep this state (we ignore late exit codes
    // once `killed` has been recorded).
    if (entry.task.state === 'running' || entry.task.state === 'pending') {
      this.transition(entry.task, 'killed', { finishedAt: Date.now() })
    }
    await entry.done
  }

  /** Wait for every currently-running task to settle. */
  async drain(): Promise<void> {
    const entries = [...this.running.values()]
    await Promise.all(entries.map(e => e.done))
  }

  // ---------- internal ----------

  private async startRunner(task: Task, signal: AbortSignal): Promise<void> {
    const spec = task.spec
    if (spec.kind === 'local_bash') {
      const handle = runBash({ spec, outputFile: task.outputFile, signal })
      const { code } = await handle.done
      this.complete(task, code)
      return
    }
    if (spec.kind === 'local_agent') {
      try {
        await runAgent({ spec, outputFile: task.outputFile, signal })
        this.complete(task, 0)
      } catch (err) {
        if (signal.aborted) return // already marked killed
        this.fail(task, (err as Error)?.message ?? 'agent error')
      }
      return
    }
    // Unknown kind — should be impossible by typing but guard anyway.
    this.fail(task, `unknown task kind: ${(spec as { kind: string }).kind}`)
  }

  private complete(task: Task, code: number | null): void {
    if (task.state === 'killed' || task.state === 'completed' || task.state === 'failed') return
    if (code === 0 || code === null) {
      this.transition(task, 'completed', {
        finishedAt: Date.now(),
        exitCode: code ?? 0,
      })
    } else {
      this.transition(task, 'failed', {
        finishedAt: Date.now(),
        exitCode: code,
        error: `exit code ${code}`,
      })
    }
  }

  private fail(task: Task, message: string): void {
    if (task.state === 'killed' || task.state === 'completed' || task.state === 'failed') return
    try { appendOutputSync(task.outputFile, `\n[task error] ${message}\n`) } catch { /* ignore */ }
    this.transition(task, 'failed', {
      finishedAt: Date.now(),
      error: message,
    })
  }

  private transition(
    task: Task,
    state: TaskState,
    patch: Partial<Task> = {},
  ): void {
    task.state = state
    Object.assign(task, patch)
    this.tasks.set(task.id, task)
    for (const cb of this.listeners) {
      try { cb({ ...task }) } catch { /* listener errors are best-effort */ }
    }
  }
}
