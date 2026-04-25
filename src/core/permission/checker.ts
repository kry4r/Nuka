// src/core/permission/checker.ts
import type { PermissionCache } from './cache'
import type { PermissionCall, PermissionDecision } from './types'
import type { PermissionPayload, AnnotationBadge } from './bridge'

export type AskUser = (payload: PermissionPayload) => Promise<PermissionDecision>

/** Derive annotation badges from a PermissionCall's annotations field. */
function deriveBadges(call: PermissionCall): AnnotationBadge[] | undefined {
  const ann = call.annotations
  if (!ann) return undefined
  const badges: AnnotationBadge[] = []
  if (ann.readOnly) badges.push('read-only')
  if (ann.destructive) badges.push('destructive')
  if (ann.openWorld) badges.push('network')
  return badges.length > 0 ? badges : undefined
}

/** Tool names whose writes are always blocked in plan mode. */
const PLAN_BLOCKED_TOOLS = new Set(['Write', 'Edit', 'Bash'])

/** Phase 8 §4.4 error surfaced to the agent via tool_result isError=true. */
export const PLAN_BLOCKED_REASON =
  'blocked: plan mode is active. Use /plan apply to execute.'

export class PermissionChecker {
  constructor(
    private getCache: () => PermissionCache,
    private askUser: AskUser,
  ) {}

  async check(call: PermissionCall): Promise<PermissionDecision> {
    // Plan-mode gate runs BEFORE cache/hint shortcuts so that a previously
    // remembered "allow write" rule cannot bypass the plan. Read-only tools
    // are unaffected regardless of mode.
    if (call.mode === 'plan') {
      const ann = call.annotations
      const blocked =
        PLAN_BLOCKED_TOOLS.has(call.toolName) ||
        ann?.destructive === true ||
        ann?.openWorld === true
      if (blocked) {
        return { allowed: false, reason: PLAN_BLOCKED_REASON }
      }
    }

    if (call.hint === 'none') return { allowed: true }
    if (this.getCache().isAllowed(call)) return { allowed: true }
    const payload: PermissionPayload = {
      call,
      annotationBadges: deriveBadges(call),
    }
    const decision = await this.askUser(payload)
    if (decision.allowed && decision.remember) {
      this.getCache().add(decision.remember)
    }
    return decision
  }
}
