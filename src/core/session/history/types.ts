// src/core/session/history/types.ts
import type { TokenUsage } from '../../message/types'
import type { SessionMode } from '../types'

declare const __sessionIdBrand: unique symbol
export type SessionId = string & { readonly [__sessionIdBrand]: 'SessionId' }

export type HistoryListEntry = {
  id: SessionId
  providerId: string
  model: string
  messageCount: number
  /** First user-message text, trimmed + truncated to PREVIEW_LEN. Empty when unavailable. */
  preview: string
  createdAt: number
  updatedAt: number
}

export type HistoryRecord = HistoryListEntry & {
  mode: SessionMode
  totalUsage: TokenUsage
}

export const PREVIEW_LEN = 64
