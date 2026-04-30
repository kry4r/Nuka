// src/slash/harness.ts
import type { SlashCommand, SlashResult } from './types'
import { formatStatus } from '../core/harness/format'
import type { HarnessStateMachine } from '../core/harness/state'
import type { HarnessStage, HarnessMode } from '../core/harness/types'

/**
 * Factory that creates the /harness slash command with a bound harness instance.
 * Using a factory (rather than extending SlashContext) keeps the change additive
 * and avoids touching the shared types.ts interface.
 */
export function makeHarnessCommand(harness: HarnessStateMachine): SlashCommand {
  return {
    name: 'harness',
    description: 'Control the workflow harness',
    usage: '/harness [deep|fast|off|reset|status|transition <stage>]',
    async run(args: string, _ctx): Promise<SlashResult> {
      const tokens = args.trim().split(/\s+/).filter(Boolean)
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
