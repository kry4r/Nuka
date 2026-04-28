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
  /** Optional tool annotations forwarded from the tool definition. */
  annotations?: {
    readOnly?: boolean
    destructive?: boolean
    openWorld?: boolean
  }
  /**
   * Phase 8 §4.4 — active session permission mode. When `'plan'`, the
   * checker rejects Write/Edit/Bash and any tool whose annotations mark it
   * destructive or open-world. Absent/undefined is treated as `'normal'`.
   */
  mode?: 'normal' | 'plan' | 'bypass'
}
