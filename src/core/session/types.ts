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
  /**
   * Tool names that have been un-deferred (via searchHint match or explicit
   * un-defer). Once in this set, the tool stays loaded for the session.
   */
  unDeferredToolNames: Set<string>
  /**
   * When explicitly `false`, this session is a dispatched sub-agent and
   * calls to `dispatch_agent` are refused (recursion guard).
   * Undefined / true means the session may dispatch agents.
   */
  allowedAgentDispatch?: boolean
  /** True when the session is created by dispatchAgent or runTeammate. */
  isWorker?: boolean
  /** Recursion guard — when false, team_create tool refuses. */
  allowedTeamCreate?: boolean
  /** Set by runTeammate; coordinator session leaves these undefined. */
  agentName?: string
  teamName?: string
}
