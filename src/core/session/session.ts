// src/core/session/session.ts
import { ulid } from 'ulid'
import type { Session } from './types'
import type { Message } from '../message/types'
import { MessageQueue } from './queue'
import { PermissionCache } from '../permission/cache'

export function createSession(opts: { providerId: string; model: string }): Session {
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
  }
}

export function appendMessage(
  session: Session,
  msg: Message,
  sink?: (s: Session, m: Message) => void,
): void {
  session.messages.push(msg)
  session.updatedAt = Date.now()
  sink?.(session, msg)
}

export function branchSession(parent: Session): Session {
  const child = createSession({
    providerId: parent.providerId,
    model: parent.model,
  })
  child.parentId = parent.id
  child.messages = JSON.parse(JSON.stringify(parent.messages))
  child.totalUsage = { ...parent.totalUsage }
  // deep-copy permission rules from parent into a fresh cache instance
  for (const rule of parent.permissionCache.list()) {
    child.permissionCache.add(rule)
  }
  child.mode = parent.mode
  return child
}
