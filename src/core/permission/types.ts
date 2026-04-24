// src/core/permission/types.ts
import type { PermissionHint } from '../tools/types'
export type { PermissionHint }
// Re-export elicitation payload/result types alongside the permission types,
// so callers interacting with the PermissionBridge can import either from
// a single place.
export type {
  ElicitationPayload,
  ElicitationResult,
} from '../mcp/elicitation'

export type PermissionRule = {
  scope: 'once' | 'session' | 'pattern'
  hint: PermissionHint
  pattern?: string
}

export type PermissionDecision = {
  allowed: boolean
  reason?: string
  remember?: PermissionRule
}

export type PermissionCall = {
  toolName: string
  hint: PermissionHint
  input: unknown
}
