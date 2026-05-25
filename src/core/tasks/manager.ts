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
import { writeMeta, writeTranscript, fromTask, transcriptFromMeta } from './meta'
import { runBash } from './run-bash'
import { runAgent } from './run-agent'
import { runTeammate } from './run-teammate'
import { runShell } from './run-shell'
import { runRemoteAgent } from './run-remote-agent'
import { runDream } from './run-dream'
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
  LocalAgentSpec,
} from './types'
import type { EventBus } from '../events/bus'
import type { TaskEvent } from '../events/types'
import type { ProgressTrackerSnapshot } from './progressTracker'
import { defaultGitRunner, removeWorktree } from '../worktree/git'

export type TaskManagerOpts = {
  /** Filesystem root for task logs (`<home>/.nuka/tasks/<id>.log`). */
  home: string
  /** Phase 14 §6.2 — when provided, manager emits typed task events. */
  bus?: EventBus
}

type RunningEntry = {
  task: Task
  abort: AbortController
  done: Promise<void>
}

function terminalSummary(task: Task): string | undefined {
  const source = task.error ?? (task.state === 'killed' ? 'killed' : undefined)
  if (!source) return undefined
  const oneLine = source.replace(/\s+/g, ' ').trim()
  if (!oneLine) return undefined
  return oneLine.length > 180 ? `${oneLine.slice(0, 177)}...` : oneLine
}

function localAgentSpec(task: Task): LocalAgentSpec | undefined {
  return task.spec.kind === 'local_agent' ? task.spec : undefined
}

export class TaskManager {
  private readonly home: string
  private readonly bus?: EventBus
  private readonly tasks = new Map<string, Task>()
  private readonly running = new Map<string, RunningEntry>()
  private readonly listeners = new Set<TaskChangeListener>()
  private readonly shutdownTimers = new Map<string, NodeJS.Timeout>()

  constructor(opts: TaskManagerOpts) {
    this.home = opts.home
    this.bus = opts.bus
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
      ...(spec.kind === 'local_agent' ? { agentId: spec.agentId ?? `agent-${id}` } : {}),
    }
    this.tasks.set(id, task)
    this.bus?.emit('task', { type: 'task.created', task: { ...task } })
    this.transition(task, 'running', { startedAt: Date.now() })

    const abort = new AbortController()
    const done = this.startRunner(task, abort.signal).catch((err) => {
      this.fail(task, (err as Error)?.message ?? 'unknown error')
    }).finally(() => { this.persistMeta(task) })
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

  /** Topic-typed subscribe via the EventBus passed at construction. */
  subscribe(topic: 'task', cb: (e: TaskEvent) => void): () => void {
    return this.bus ? this.bus.subscribe(topic, cb) : () => {}
  }

  setTeammateState(id: string, next: 'idle' | 'running'): void {
    const t = this.tasks.get(id)
    if (!t) return
    const from = t.state
    t.state = next
    for (const cb of this.listeners) { try { cb({ ...t }) } catch { /* */ } }
    this.bus?.emit('task', { type: 'task.state', id, from, to: next })
    try { writeMeta(this.home, fromTask(t)) } catch { /* non-fatal */ }
  }

  injectMessage(id: string, message: string): void {
    const t = this.tasks.get(id)
    if (!t || t.kind !== 'in_process_teammate') return
    if (t.progress) {
      t.progress = {
        ...t.progress,
        recentActivities: [
          ...t.progress.recentActivities,
          { toolName: '__injected', input: { message } },
        ].slice(-5),
      }
    }
    try { writeMeta(this.home, fromTask(t)) } catch { /* non-fatal */ }
  }

  async requestShutdown(id: string): Promise<void> {
    const t = this.tasks.get(id)
    if (!t) return
    const from = t.state
    t.state = 'shutdown_requested'
    this.bus?.emit('task', { type: 'task.state', id, from, to: 'shutdown_requested' })
    // Note: protocol envelope (shutdown_request) is emitted by the
    // in_process_teammate runner in phase14a; foundation only flips state.
    const timer = setTimeout(() => {
      if (this.tasks.get(id)?.state === 'shutdown_requested') {
        void this.cancel(id)
      }
      this.shutdownTimers.delete(id)
    }, 30_000)
    timer.unref()
    this.shutdownTimers.set(id, timer)
    try { writeMeta(this.home, fromTask(t)) } catch { /* non-fatal */ }
  }

  resolveTeammate(address: string): string | undefined {
    // address: "team:<team>/<agent>"
    const m = address.match(/^team:([^/]+)\/(.+)$/)
    if (!m) return undefined
    const teamName = m[1]!
    const agentName = m[2]!
    for (const t of this.tasks.values()) {
      if (t.teamName === teamName && t.agentName === agentName) return t.id
    }
    return undefined
  }

  setProgress(id: string, snapshot: ProgressTrackerSnapshot): void {
    const t = this.tasks.get(id)
    if (!t) return
    t.progress = snapshot
    this.bus?.emit('task', { type: 'task.progress', id, snapshot })
    try { writeMeta(this.home, fromTask(t)) } catch { /* non-fatal */ }
  }

  // ---------- internal ----------

  private async startRunner(task: Task, signal: AbortSignal): Promise<void> {
    const spec = task.spec
    switch (spec.kind) {
      case 'local_bash': {
        const handle = runBash({ spec, outputFile: task.outputFile, signal })
        const { code } = await handle.done
        this.complete(task, code)
        return
      }
      case 'local_agent': {
        try {
          await runAgent({ spec, outputFile: task.outputFile, signal })
          this.cleanupLocalAgentWorktree(task)
          this.complete(task, 0)
        } catch (err) {
          if (signal.aborted) return
          this.fail(task, (err as Error)?.message ?? 'agent error')
        }
        return
      }
      case 'in_process_teammate': {
        try { await runTeammate(task, signal); this.complete(task, 0) }
        catch (err) {
          if (signal.aborted) return
          this.fail(task, (err as Error)?.message ?? 'teammate error')
        }
        return
      }
      case 'local_shell': {
        try { await runShell(task, signal); this.complete(task, 0) }
        catch (err) {
          if (signal.aborted) return
          this.fail(task, (err as Error)?.message ?? 'shell error')
        }
        return
      }
      case 'remote_agent': {
        try { await runRemoteAgent(task, signal); this.complete(task, 0) }
        catch (err) {
          if (signal.aborted) return
          this.fail(task, (err as Error)?.message ?? 'remote-agent error')
        }
        return
      }
      case 'dream': {
        try { await runDream(task, signal); this.complete(task, 0) }
        catch (err) {
          if (signal.aborted) return
          this.fail(task, (err as Error)?.message ?? 'dream error')
        }
        return
      }
    }
    const _exhaustive: never = spec; void _exhaustive
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
    this.cleanupLocalAgentWorktree(task)
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
    const from = task.state
    // Cancel pending shutdown timer if the task moves on.
    if (task.state === 'shutdown_requested' && state !== 'shutdown_requested') {
      const t = this.shutdownTimers.get(task.id)
      if (t) { clearTimeout(t); this.shutdownTimers.delete(task.id) }
    }
    task.state = state
    Object.assign(task, patch)
    this.tasks.set(task.id, task)
    for (const cb of this.listeners) {
      try { cb({ ...task }) } catch { /* listener errors are best-effort */ }
    }
    const summary = terminalSummary(task)
    this.bus?.emit('task', {
      type: 'task.state',
      id: task.id,
      from,
      to: state,
      ...(task.error ? { error: task.error } : {}),
      ...(summary ? { summary } : {}),
    })
    this.emitLocalAgentLifecycle(task, from, state, summary)
    this.persistMeta(task)
  }

  private emitLocalAgentLifecycle(
    task: Task,
    from: TaskState,
    to: TaskState,
    summary?: string,
  ): void {
    const spec = localAgentSpec(task)
    if (!spec || !this.bus) return
    const agentId = task.agentId ?? spec.agentId
    if (!agentId) return
    const sessionId = spec.taskSessionId ?? task.id
    const agentName = task.agentName ?? spec.agentName
    if (from !== 'running' && to === 'running') {
      this.bus.emit('agent', {
        type: 'agent.subagent.start',
        sessionId,
        taskId: task.id,
        agentId,
        description: task.description,
        ...(agentName ? { agentName } : {}),
        ...(spec.providerId ? { providerId: spec.providerId } : {}),
        ...(spec.model ? { model: spec.model } : {}),
        ...(spec.cwd ? { cwd: spec.cwd } : {}),
        ...(spec.resumed !== undefined ? { resumed: spec.resumed } : {}),
      })
      return
    }
    if (to === 'completed' || to === 'failed' || to === 'killed') {
      this.bus.emit('agent', {
        type: 'agent.subagent.end',
        sessionId,
        taskId: task.id,
        agentId,
        status: to,
        ...(agentName ? { agentName } : {}),
        ...(task.error ? { error: task.error } : {}),
        ...(summary ? { summary } : {}),
        ...(task.startedAt && task.finishedAt ? { durationMs: task.finishedAt - task.startedAt } : {}),
      })
    }
  }

  private cleanupLocalAgentWorktree(task: Task): void {
    const spec = localAgentSpec(task)
    const worktree = spec?.worktree
    if (!spec || !worktree) return

    const runner = spec.gitRunner ?? defaultGitRunner
    const [path, repoRoot] = worktree
    const status = runner(['status', '--porcelain'], { cwd: path })
    if (status.code !== 0) {
      this.appendCleanupWarning(task, `could not inspect worktree changes: ${status.stderr.trim() || status.stdout.trim() || `exit ${status.code}`}`)
      return
    }
    if (status.stdout.trim().length !== 0) return

    const removed = removeWorktree(runner, { repoRoot, worktreePath: path, force: false })
    if (!removed.ok) {
      this.appendCleanupWarning(task, removed.message)
      return
    }

    delete spec.cwd
    delete spec.worktree
  }

  private appendCleanupWarning(task: Task, message: string): void {
    try { appendOutputSync(task.outputFile, `\n[worktree cleanup] ${message}\n`) } catch { /* ignore */ }
  }

  private persistMeta(task: Task): void {
    try {
      const meta = fromTask(task)
      writeMeta(this.home, meta)
      const transcript = transcriptFromMeta(meta)
      if (transcript) writeTranscript(this.home, transcript)
    } catch { /* non-fatal */ }
  }
}
