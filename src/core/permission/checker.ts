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

export class PermissionChecker {
  constructor(
    private getCache: () => PermissionCache,
    private askUser: AskUser,
  ) {}

  async check(call: PermissionCall): Promise<PermissionDecision> {
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
