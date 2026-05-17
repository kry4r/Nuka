// src/core/permission/checker.ts
import type { PermissionCache } from './cache'
import type { PermissionCall, PermissionDecision } from './types'
import type { PermissionPayload, AnnotationBadge, PermissionVariant } from './bridge'

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

/**
 * Tool name that should trigger the `'planMode'` permission-dialog
 * variant. Kept as a local literal (rather than importing from
 * `../planMode/planModeTools`) so the permission layer remains
 * dependency-free relative to plan-mode internals — the tool name is
 * already a stable wire-level contract.
 */
const ENTER_PLAN_MODE_TOOL = 'EnterPlanMode'

/** Derive the UX variant from a PermissionCall, or `undefined` for default. */
function deriveVariant(call: PermissionCall): PermissionVariant | undefined {
  // Plan-mode entry is the only "meta operation" today that uses `'ask'`
  // and benefits from a bespoke dialog. Other `'ask'` callers fall
  // through to the default tool-confirmation look.
  if (call.toolName === ENTER_PLAN_MODE_TOOL && call.hint === 'ask') {
    return 'planMode'
  }
  return undefined
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
    //
    // Iter LLLL — the `'ask'` hint is a pure confirmation gate (no side-effect
    // category). Plan-mode is about side effects, so a tool whose only
    // permission classification is `'ask'` must NOT be blocked here. The
    // plan-mode block applies only to hard write/exec tools or annotated
    // destructive/openWorld surfaces.
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
    // Iter LLLL — `'bypass'` mode trusts the session fully and skips
    // confirmation prompts for the `'ask'` hint. Other hints still go
    // through their normal cache/askUser path (bypass for write/exec is
    // handled by the same prompt flow, not auto-allowed here).
    if (call.mode === 'bypass' && call.hint === 'ask') return { allowed: true }
    if (this.getCache().isAllowed(call)) return { allowed: true }
    const variant = deriveVariant(call)
    const payload: PermissionPayload = {
      call,
      annotationBadges: deriveBadges(call),
      ...(variant ? { variant } : {}),
    }
    const decision = await this.askUser(payload)
    if (decision.allowed && decision.remember) {
      this.getCache().add(decision.remember)
    }
    return decision
  }
}
