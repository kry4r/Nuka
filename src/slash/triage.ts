// src/slash/triage.ts
//
// T8.1 — `/triage` slash command + `/harness retriage` shared helper.
//
// Manually triggers the three-axis triage flow (profile × difficulty × testStrategy)
// against a free-text task description, optionally surfacing the result via
// askUser for confirmation/override, then writes the result back into the
// harness state machine via `setTriage`.
//
// The factory pattern (rather than `SlashContext` injection) keeps the existing
// `types.ts` interface untouched and matches `makeHarnessCommand`.
import type { SlashCommand, SlashResult } from './types'
import type { HarnessStateMachine } from '../core/harness/state'
import type { Triage } from '../core/harness/types'

export type TriageDeps = {
  harness: HarnessStateMachine
  /** Forks a fresh subagent that returns plain text — used to call the classifier LLM. */
  runFork: (prompt: string) => Promise<{ text: string }>
  /** Optional interactive bridge. When provided, the result is surfaced for confirmation. */
  askUser?: (question: string) => Promise<string>
  /** Optional repo summary blurb passed to the classifier prompt. */
  repoSummary?: string
}

/**
 * Format a Triage object into the text body shown in the slash response /
 * harness scratchpad. Kept identical between `/triage` and `/harness retriage`
 * so users see the same shape regardless of entry point.
 */
export function formatTriage(t: Triage): string {
  return [
    'Triage:',
    `  profile:      ${t.profile}`,
    `  difficulty:   ${t.difficulty}`,
    `  testStrategy: ${t.testStrategy}`,
    `  confirmed:    ${t.userConfirmed ? 'yes' : 'no (auto)'}`,
    `  reasoning:    ${t.reasoning}`,
  ].join('\n')
}

/**
 * Shared implementation behind `/triage <message>` and `/harness retriage <message>`.
 * Always returns a `SlashResult`; never throws on classifier failure
 * (the classifier itself returns a sensible fallback after 2 retries).
 */
export async function performTriage(args: string, deps: TriageDeps): Promise<SlashResult> {
  const userMessage = args.trim()
  if (!userMessage) {
    return {
      type: 'text',
      text: 'usage: /triage <message describing the task>',
    }
  }
  const { triageMessage, confirmTriage } = await import('../core/harness/triage')
  let triage = await triageMessage({
    userMessage,
    repoSummary: deps.repoSummary ?? '',
    runFork: deps.runFork,
  })
  if (deps.askUser) {
    triage = await confirmTriage(triage, { askUser: deps.askUser, runFork: deps.runFork })
  }
  deps.harness.setTriage(triage)
  return { type: 'text', text: formatTriage(triage) }
}

export function makeTriageCommand(deps: TriageDeps): SlashCommand {
  return {
    name: 'triage',
    description:
      'Classify a task into the three-axis (profile / difficulty / testStrategy) triage and store it on the harness.',
    usage: '/triage <message describing the task>',
    args: [{ name: 'message', description: 'Free-text description of the task to classify' }],
    examples: [
      '/triage Fix the date-formatting regression in the dashboard',
      '/triage Add a new SSO login provider end-to-end',
    ],
    async run(args, _ctx) {
      return performTriage(args, deps)
    },
  }
}
