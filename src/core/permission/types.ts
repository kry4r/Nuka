// src/core/permission/types.ts
import type { PermissionHint } from '../tools/types'
export type { PermissionHint }

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
