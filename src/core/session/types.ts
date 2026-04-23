// src/core/session/types.ts
import type { Message, TokenUsage } from '../message/types'
import type { PermissionCache } from '../permission/cache'
import type { MessageQueue } from './queue'

export type SessionMode = 'normal' | 'plan' | 'bypass'

export type Session = {
  id: string
  parentId?: string
  providerId: string
  model: string
  messages: Message[]
  totalUsage: TokenUsage
  permissionCache: PermissionCache
  queue: MessageQueue
  mode: SessionMode
  createdAt: number
  updatedAt: number
}
