// src/slash/plan.ts
//
// Phase 8 §4.4 — `/plan` slash command.
//
// Sub-commands:
//   /plan on              — toggle the active session into 'plan' mode
//   /plan off             — back to 'normal'
//   /plan show            — cat the current plan file
//   /plan write <text>    — append <text> to the plan file
//   /plan apply           — exit plan mode (same as `/plan off`)
//   /plan                 — print current mode + plan file path

import type { SlashCommand, SlashContext } from './types'
import { planFilePath, readPlan, appendPlan } from '../core/plan/state'

async function runPlan(args: string, ctx: SlashContext, cwd: string = process.cwd()) {
  const session = ctx.sessions.active()
  if (!session) return { type: 'text' as const, text: 'No active session.' }

  const [sub, ...rest] = args.trim().split(/\s+/)
  const tail = args.trim().slice((sub ?? '').length).trimStart()
  const file = planFilePath(cwd)

  switch (sub) {
    case '':
    case undefined: {
      const plan = await readPlan(cwd)
      const lines = [
        `plan mode: ${session.mode === 'plan' ? 'ON' : 'off'}`,
        `plan file: ${file}`,
        plan.trim().length > 0 ? '\n' + plan : '(no plan written yet)',
      ]
      return { type: 'text' as const, text: lines.join('\n') }
    }
    case 'on': {
      session.mode = 'plan'
      return { type: 'text' as const, text: 'Plan mode ON — writes/exec are blocked until /plan apply.' }
    }
    case 'off':
    case 'apply': {
      session.mode = 'normal'
      return { type: 'text' as const, text: 'Plan mode off — agent may execute again.' }
    }
    case 'show': {
      const plan = await readPlan(cwd)
      return {
        type: 'text' as const,
        text: plan.trim().length > 0 ? plan : '(no plan written yet)',
      }
    }
    case 'write': {
      if (tail.length === 0) {
        return { type: 'text' as const, text: 'Usage: /plan write <text>' }
      }
      await appendPlan(cwd, tail)
      return { type: 'text' as const, text: `Appended ${tail.length} chars to plan.` }
    }
    default: {
      // Swallow the unused `rest` var warning for linting tools.
      void rest
      return { type: 'text' as const, text: `Unknown /plan sub-command: ${sub}` }
    }
  }
}

export const PlanCommand: SlashCommand = {
  name: 'plan',
  description: 'Toggle plan-mode; read/append the per-cwd plan file',
  usage: '/plan [on|off|show|write <text>|apply]',
  run: (args, ctx) => runPlan(args, ctx),
}

// Exported for tests that need to inject a mock cwd.
export const _runPlanForTest = runPlan
