// src/core/permission/checker.ts
import type { PermissionCache } from './cache'
import type { PermissionCall, PermissionDecision } from './types'

export type AskUser = (call: PermissionCall) => Promise<PermissionDecision>

export class PermissionChecker {
  constructor(
    private cache: PermissionCache,
    private askUser: AskUser,
  ) {}

  async check(call: PermissionCall): Promise<PermissionDecision> {
    if (call.hint === 'none') return { allowed: true }
    if (this.cache.isAllowed(call)) return { allowed: true }
    const decision = await this.askUser(call)
    if (decision.allowed && decision.remember) {
      this.cache.add(decision.remember)
    }
    return decision
  }
}
