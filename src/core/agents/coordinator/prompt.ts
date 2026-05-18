// src/core/agents/coordinator/prompt.ts
//
// B5 — Pure function that builds the first user message handed to each
// worker per iteration. Embeds the shared goal, the worker's task, the
// current blackboard snapshot (if any), and a small contract telling
// the worker how to signal completion ("done: true" anywhere in its
// final assistant text).

import type { BlackboardSnapshot } from './types'

export function composeWorkerPrompt(opts: {
  goal: string
  task: string
  iteration: number
  blackboard: BlackboardSnapshot
}): string {
  const lines: string[] = []
  lines.push(`Shared goal: ${opts.goal}`)
  lines.push(`Iteration ${opts.iteration}`)
  lines.push('')
  lines.push(`Your task: ${opts.task}`)

  const keys = Object.keys(opts.blackboard)
  if (keys.length > 0) {
    lines.push('')
    lines.push('Blackboard:')
    for (const key of keys.sort()) {
      const value = opts.blackboard[key] ?? ''
      lines.push(`- ${key}: ${value}`)
    }
  }

  lines.push('')
  lines.push(
    'Use bb_write to share findings with sibling agents. Use bb_read to consume them. ' +
      'When you have nothing more to contribute toward the shared goal, end your reply with ' +
      'a line containing `done: true`. Otherwise leave the marker out and the coordinator ' +
      'will re-run you on the next iteration.',
  )
  return lines.join('\n')
}

const DONE_MARKER = /(^|\n)\s*done:\s*true\s*(\n|$)/i

export function isDone(text: string): boolean {
  return DONE_MARKER.test(text)
}
