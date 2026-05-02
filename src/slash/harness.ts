// src/slash/harness.ts
import type { SlashCommand, SlashResult } from './types'
import { formatStatus } from '../core/harness/format'
import type { HarnessStateMachine } from '../core/harness/state'
import type { HarnessStage, HarnessMode } from '../core/harness/types'
import { performTriage, type TriageDeps } from './triage'

/**
 * Optional retriage deps. When provided, `/harness retriage <hint>` re-runs the
 * three-axis classifier (sharing implementation with `/triage`). When omitted,
 * the subcommand returns a stub message — used by legacy unit tests that do
 * not exercise the LLM bridge.
 */
export type HarnessCommandDeps = Pick<TriageDeps, 'runFork' | 'askUser' | 'repoSummary'>

/**
 * Factory that creates the /harness slash command with a bound harness instance.
 * Using a factory (rather than extending SlashContext) keeps the change additive
 * and avoids touching the shared types.ts interface.
 */
export function makeHarnessCommand(
  harness: HarnessStateMachine,
  retriageDeps?: HarnessCommandDeps,
): SlashCommand {
  return {
    name: 'harness',
    description: 'Control the workflow harness',
    usage: '/harness [deep|fast|off|reset|status|retriage <hint>|transition <stage>]',
    async run(args: string, _ctx): Promise<SlashResult> {
      const trimmed = args.trim()
      // No args → open the interactive Harness submenu (Phase 14d).
      // The legacy text path is still available via `/harness status`.
      if (trimmed === '') {
        return { type: 'dialog', dialog: { kind: 'harness-submenu' } }
      }
      const tokens = trimmed.split(/\s+/).filter(Boolean)
      const sub = tokens[0] ?? 'status'

      if (sub === 'deep' || sub === 'fast' || sub === 'off') {
        harness.setMode(sub as HarnessMode)
        return { type: 'text', text: `harness mode → ${sub}` }
      }
      if (sub === 'status') {
        return { type: 'text', text: formatStatus(harness.snapshot()) }
      }
      if (sub === 'reset') {
        return { type: 'text', text: 'harness reset; will re-classify on next user message' }
      }
      if (sub === 'retriage') {
        const hint = tokens.slice(1).join(' ').trim()
        if (!retriageDeps) {
          return {
            type: 'text',
            text: 'retriage unavailable: harness command was created without runFork bridge',
          }
        }
        if (!hint) {
          return { type: 'text', text: 'usage: /harness retriage <hint describing the task>' }
        }
        return performTriage(hint, { harness, ...retriageDeps })
      }
      if (sub === 'transition') {
        const to = tokens[1] as HarnessStage
        if (!to) return { type: 'text', text: 'usage: /harness transition <stage>' }
        try {
          await harness.transition(to, 'manual')
          return { type: 'text', text: `transitioned → ${to}` }
        } catch (e) {
          return { type: 'text', text: `refused: ${(e as Error).message}` }
        }
      }
      return { type: 'text', text: `unknown subcommand: ${sub}` }
    },
  }
}
