import type { Task } from './types'

export async function runRemoteAgent(_task: Task, _signal: AbortSignal): Promise<void> {
  throw new Error('run-remote-agent: not implemented (phase14a)')
}
