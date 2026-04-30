import type { Task } from './types'

export async function runShell(_task: Task, _signal: AbortSignal): Promise<void> {
  throw new Error('run-shell: not implemented (phase14a)')
}
