// src/core/tasks/run-bash.ts
//
// Phase 10 §4.3 — `local_bash` task runner.
//
// Spawns a child process via `child_process.spawn`, streams stdout +
// stderr into the task's outputFile, and resolves with the exit code
// (or null when the process was killed by a signal).

import { spawn, type ChildProcess } from 'node:child_process'
import { appendOutputSync } from './persist'
import type { LocalBashSpec } from './types'

export type RunBashHandle = {
  child: ChildProcess
  /** Promise that resolves with the exit code (null when killed). */
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

export type RunBashOpts = {
  spec: LocalBashSpec
  outputFile: string
  signal: AbortSignal
}

/**
 * Spawn the bash task. Returns a handle whose `done` promise resolves
 * once the child process exits. The caller (TaskManager) is responsible
 * for translating the resolution into task state transitions.
 *
 * `signal` aborts the child via SIGTERM. If the child does not exit
 * within 2 s after SIGTERM, the manager may follow up with SIGKILL —
 * but this runner only emits SIGTERM and lets the manager escalate.
 */
export function runBash(opts: RunBashOpts): RunBashHandle {
  const { spec, outputFile, signal } = opts
  const child = spawn(spec.command, spec.args ?? [], {
    cwd: spec.cwd ?? process.cwd(),
    env: { ...process.env, ...(spec.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const onData = (chunk: Buffer) => {
    try { appendOutputSync(outputFile, chunk) } catch { /* persistence best-effort */ }
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)

  const onAbort = () => {
    if (!child.killed) {
      try { child.kill('SIGTERM') } catch { /* swallow — process already gone */ }
    }
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })

  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, sig) => {
      signal.removeEventListener('abort', onAbort)
      resolve({ code, signal: sig })
    })
    child.on('error', (err) => {
      // `spawn` failures (e.g. ENOENT) surface as 'error' before 'exit'.
      try { appendOutputSync(outputFile, `\n[spawn error] ${(err as Error).message}\n`) } catch { /* ignore */ }
    })
  })

  return { child, done }
}
