// src/core/session/session.ts
import { ulid } from 'ulid'
import type { Session } from './types'
import type { Message } from '../message/types'
import { MessageQueue } from './queue'
import { PermissionCache } from '../permission/cache'

export function createSession(opts: {
  providerId: string
  model: string
  isWorker?: boolean
  agentName?: string
  teamName?: string
  allowedTeamCreate?: boolean
}): Session {
  return {
    id: ulid(),
    providerId: opts.providerId,
    model: opts.model,
    messages: [],
    totalUsage: { inputTokens: 0, outputTokens: 0 },
    permissionCache: new PermissionCache(),
    queue: new MessageQueue(),
    mode: 'normal',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    unDeferredToolNames: new Set(),
    isWorker: opts.isWorker,
    agentName: opts.agentName,
    teamName: opts.teamName,
    allowedTeamCreate: opts.allowedTeamCreate,
  }
}

export function appendMessage(
  session: Session,
  msg: Message,
  sink?: (s: Session, m: Message) => void,
): void {
  // Replace the array reference (rather than push in place) so React
  // consumers — notably ink's `<Static>`, which memoizes on the array
  // identity — observe the new entry on the next render.
  session.messages = [...session.messages, msg]
  session.updatedAt = Date.now()
  sink?.(session, msg)
}

export function forkSession(parent: Session): Session {
  const child = createSession({
    providerId: parent.providerId,
    model: parent.model,
  })
  child.parentId = parent.id
  child.messages = JSON.parse(JSON.stringify(parent.messages))
  child.totalUsage = { ...parent.totalUsage }
  child.goal = parent.goal ? { ...parent.goal } : undefined
  // deep-copy permission rules from parent into a fresh cache instance
  for (const rule of parent.permissionCache.list()) {
    child.permissionCache.add(rule)
  }
  child.mode = parent.mode
  return child
}
