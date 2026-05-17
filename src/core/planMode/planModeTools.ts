// src/core/planMode/planModeTools.ts
//
// Iter YYY — Plan-mode Tool first pass. Two narrow tools the agent uses
// to signal entry and exit of plan mode. They mutate a shared
// `PlanModeState` (see ./planModeState.ts) — they do NOT toggle
// `Session.mode` directly. That coupling is intentionally deferred to a
// follow-up iter (the "permission-mode shim" called out in MMM): once a
// listener on `PlanModeState` flips the active Session's `mode` flag,
// the existing `PermissionChecker` plan-mode gate (see
// `src/core/permission/checker.ts`) takes over enforcement for free.
//
// Why two tools instead of one with an `action` enum (like Slug /
// Truncate / WrapText etc.)? Plan-mode entry and exit have genuinely
// different vocabularies — entry takes no parameters, exit requires a
// plan string. Pinning two surfaces keeps the agent-facing JSON Schema
// small and the model's tool-use cleaner. The same shape Nuka-Code
// upstream picked.
//
// Reference shape (from ~/Desktop/Nuka-Code):
//   - EnterPlanMode: input {} — confirmation comes from the permission
//     layer (Iter LLLL: `needsPermission: () => 'ask'`). Pre-LLLL this
//     tool carried a schema-level `confirm` field (Iter FFFF), but that
//     duplicated the user-confirmation infra. The `'ask'` hint
//     unifies it: the `PermissionChecker` routes the call to `askUser`,
//     and the tool's `run()` is only invoked after the user agrees.
//   - ExitPlanMode (V2 upstream): input { plan: string, ... }, returns
//     plan + filePath. Upstream V2 reads plan from a per-cwd file and
//     uses a permission-context state machine; that machinery lives in
//     a different layer (`bootstrap/state.ts`, `permissionSetup.ts`)
//     and bringing it in wholesale is out of scope for this first pass.
//
// First-pass divergence from upstream:
//   - We do not block writes / Bash on EnterPlanMode (no permission
//     shim wired in yet).
//   - We do not persist the plan to a per-cwd file — that lives in
//     `src/core/plan/state.ts` and is wired through `/plan write`. The
//     tool simply records the plan into `PlanModeState.plans[]` so
//     `latestPlan()` reflects it. A follow-up iter can extend
//     `exit()` to also `writePlan(cwd, plan)`.
//   - We never reject the call when not in plan mode — we surface a
//     human-readable hint on the way out. (Upstream rejects with
//     `tengu_exit_plan_mode_called_outside_plan`.)

import type { Tool, ToolContext, ToolResult } from '../tools/types.js'
import { defineTool } from '../tools/define.js'
import { PlanModeState } from './planModeState.js'

export const ENTER_PLAN_MODE_TOOL_NAME = 'EnterPlanMode'
export const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode'
export const IS_IN_PLAN_MODE_TOOL_NAME = 'IsInPlanMode'

/**
 * Input shape for EnterPlanMode — no parameters.
 *
 * Iter LLLL — replaces the Iter FFFF schema-level `confirm: boolean`
 * field with `needsPermission: () => 'ask'`. The `PermissionChecker`
 * now routes the call to `askUser` before `run()` fires; once we land
 * in the tool body the user has already confirmed (or `'bypass'` mode
 * is active). The two-step ritual is therefore implicit and lives at
 * the permission layer, not the tool's schema.
 */
export type EnterPlanModeInput = Record<string, never>

/** Input shape for ExitPlanMode — requires a non-empty plan. */
export type ExitPlanModeInput = {
  /** The full plan text. Must be non-empty after trim. */
  plan: string
}

/** Input shape for IsInPlanMode — no parameters. */
export type IsInPlanModeInput = Record<string, never>

/**
 * Structured payload returned by EnterPlanMode.
 *
 * Iter LLLL — the only path through `run()` is now post-confirmation,
 * so we no longer need the `awaiting_confirmation` variant. The
 * permission layer handles the asking phase; if the user rejects, the
 * call short-circuits before `run()` ever fires and the agent sees a
 * `tool_result` with `isError=true, output='Rejected: …'`.
 */
export type EnterPlanModeResult = {
  action: 'enter'
  active: true
  message: string
}

/** Structured payload returned by ExitPlanMode. */
export type ExitPlanModeResult = {
  action: 'exit'
  active: false
  plan: string
  /** epoch-ms when the plan was recorded */
  recordedAt: number
  /** Total plans stored in this PlanModeState (lifetime, not just this exit). */
  planCount: number
  /**
   * True iff `enter()` had been called more recently than `exit()` /
   * `reset()` at the moment this tool ran. False means the model
   * called ExitPlanMode without an EnterPlanMode pair (we still
   * recorded the plan; the field lets callers warn the user).
   */
  wasActive: boolean
}

/** Structured payload returned by IsInPlanMode. */
export type IsInPlanModeResult = {
  action: 'isActive'
  active: boolean
  planCount: number
  latestPlanAt?: number
}

const ENTER_MESSAGE =
  'Plan mode entered. Read-only tools (Read, Grep, Glob, WebSearch, etc.) ' +
  'are encouraged; defer writes/exec until you call ExitPlanMode with the ' +
  'finalised plan for user approval.'

/**
 * Factory — returns a Tool the agent calls to enter plan mode. The
 * Tool closes over `state` so successive calls within a session share
 * one `PlanModeState` instance (cli.tsx constructs it once).
 *
 * Iter LLLL — declares `needsPermission: () => 'ask'`. The agent loop
 * calls `PermissionChecker.check(...)` before `run()`, which routes to
 * `askUser`. The tool body therefore runs only AFTER the user has
 * agreed; no in-tool confirmation gate is needed.
 */
export function makeEnterPlanModeTool(state: PlanModeState): Tool<EnterPlanModeInput> {
  return defineTool<EnterPlanModeInput>({
    name: ENTER_PLAN_MODE_TOOL_NAME,
    description:
      'Signal that you are switching into plan mode. Use this proactively before ' +
      'non-trivial implementation work so you can explore the codebase and design an ' +
      'approach before writing code. After calling this tool, prefer read-only tools ' +
      "(Read, Grep, Glob, WebSearch) and DO NOT modify files until you've called " +
      'ExitPlanMode with the finalised plan. ' +
      'The user is prompted for confirmation before plan mode is entered; if you receive ' +
      "a 'Rejected' tool_result, the user declined.",
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'plan'],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'ask',
    searchHint: ['plan', 'planning', 'approach', 'design', 'strategy'],
    aliases: ['enter_plan_mode', 'planmode_enter'],
    async run(_input: EnterPlanModeInput, _ctx: ToolContext): Promise<ToolResult> {
      // Iter LLLL — confirmation is enforced at the permission layer;
      // by the time we reach here the user has already agreed (or
      // `'bypass'` mode is active). The body is a straight commit.
      const alreadyActive = state.isActive()
      state.enter()
      const payload: EnterPlanModeResult = {
        action: 'enter',
        active: true,
        message: alreadyActive
          ? `${ENTER_MESSAGE} (already in plan mode; no change)`
          : ENTER_MESSAGE,
      }
      return { isError: false, output: JSON.stringify(payload) }
    },
  })
}

/**
 * Factory — returns a Tool the agent calls to exit plan mode and
 * present its plan for approval. Records the plan in `state.plans[]`
 * regardless of whether `enter()` was called first; the returned
 * payload's `wasActive` flag tells the caller whether the agent
 * actually paired the calls.
 */
export function makeExitPlanModeTool(state: PlanModeState): Tool<ExitPlanModeInput> {
  return defineTool<ExitPlanModeInput>({
    name: EXIT_PLAN_MODE_TOOL_NAME,
    description:
      'Signal that you have finished planning and are ready for user approval. ' +
      'Pass the complete plan as a single string (markdown is fine). After this call ' +
      'returns, you may proceed with writes/edits according to the user-approved plan. ' +
      'The plan is recorded in plan history for later inspection.',
    parameters: {
      type: 'object',
      required: ['plan'],
      additionalProperties: false,
      properties: {
        plan: {
          type: 'string',
          description:
            'The full plan text, presented to the user for approval. Markdown is supported. ' +
            'Required and must be non-empty after trim.',
          minLength: 1,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'plan'],
    annotations: { readOnly: false, destructive: false, openWorld: false, parallelSafe: false },
    needsPermission: () => 'none',
    searchHint: ['plan', 'planning', 'approve', 'approval', 'finalize', 'finalise'],
    aliases: ['exit_plan_mode', 'planmode_exit'],
    async run(input: ExitPlanModeInput, _ctx: ToolContext): Promise<ToolResult> {
      if (input === null || typeof input !== 'object') {
        return { isError: true, output: "ExitPlanMode: input must be an object with a 'plan' string." }
      }
      const plan = (input as { plan?: unknown }).plan
      if (typeof plan !== 'string') {
        return { isError: true, output: `ExitPlanMode: 'plan' must be a string (got ${typeof plan}).` }
      }
      if (plan.trim().length === 0) {
        return { isError: true, output: "ExitPlanMode: 'plan' must be a non-empty string." }
      }
      const wasActive = state.isActive()
      let entry
      try {
        entry = state.exit(plan)
      } catch (e) {
        return { isError: true, output: `ExitPlanMode: ${(e as Error).message}` }
      }
      const payload: ExitPlanModeResult = {
        action: 'exit',
        active: false,
        plan: entry.plan,
        recordedAt: entry.ts,
        planCount: state.planCount,
        wasActive,
      }
      return { isError: false, output: JSON.stringify(payload) }
    },
  })
}

/**
 * Factory — returns a Tool the agent can use to introspect the current
 * plan-mode state. Useful for the model to decide whether to call
 * `EnterPlanMode` again or skip ahead to read-only exploration.
 */
export function makeIsInPlanModeTool(state: PlanModeState): Tool<IsInPlanModeInput> {
  return defineTool<IsInPlanModeInput>({
    name: IS_IN_PLAN_MODE_TOOL_NAME,
    description:
      'Return whether plan mode is currently active in this session, along with the ' +
      'total number of plans recorded and the timestamp of the most recent plan ' +
      '(if any). Pure read-only — no side effects.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'plan'],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    searchHint: ['plan', 'planning', 'mode', 'status'],
    aliases: ['is_in_plan_mode', 'planmode_status'],
    async run(_input: IsInPlanModeInput, _ctx: ToolContext): Promise<ToolResult> {
      const latest = state.latestPlan()
      const payload: IsInPlanModeResult = {
        action: 'isActive',
        active: state.isActive(),
        planCount: state.planCount,
        ...(latest === undefined ? {} : { latestPlanAt: latest.ts }),
      }
      return { isError: false, output: JSON.stringify(payload) }
    },
  })
}

/**
 * Convenience — build all three plan-mode tools sharing the same
 * `PlanModeState`. cli.tsx uses this so it doesn't have to construct
 * the tools individually.
 */
export function makePlanModeTools(state: PlanModeState): {
  enter: Tool<EnterPlanModeInput>
  exit: Tool<ExitPlanModeInput>
  status: Tool<IsInPlanModeInput>
} {
  return {
    enter: makeEnterPlanModeTool(state),
    exit: makeExitPlanModeTool(state),
    status: makeIsInPlanModeTool(state),
  }
}
