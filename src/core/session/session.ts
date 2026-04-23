// src/core/session/session.ts
import { ulid } from 'ulid'
import type { Session } from './types'
import { MessageQueue } from './queue'

export function createSession(opts: { providerId: string; model: string }): Session {
  return {
    id: ulid(),
    providerId: opts.providerId,
    model: opts.model,
    messages: [],
    totalUsage: { inputTokens: 0, outputTokens: 0 },
    permissionCache: [],
    queue: new MessageQueue(),
    mode: 'normal',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function branchSession(parent: Session): Session {
  const child = createSession({
    providerId: parent.providerId,
    model: parent.model,
  })
  child.parentId = parent.id
  child.messages = JSON.parse(JSON.stringify(parent.messages))
  child.totalUsage = { ...parent.totalUsage }
  child.permissionCache = parent.permissionCache.map(r => ({ ...r }))
  child.mode = parent.mode
  return child
}
