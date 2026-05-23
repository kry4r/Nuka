// src/core/tasks/lookup.ts
//
// Shared lookup helpers for task tools that can address a background
// execution record either by task id or by stable local subagent id.

import type { Task } from './types'

export type TaskLookupManagerLike = {
  get(id: string): Task | undefined
  list(): Task[]
}

export function cleanLookupId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function findTaskByAgentId(
  manager: Pick<TaskLookupManagerLike, 'list'>,
  agentId: string,
): Task | undefined {
  return manager.list().find((task) => task.agentId === agentId)
}
