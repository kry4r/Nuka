// src/core/harness/format.ts
import type { HarnessState } from './types'

export function formatStatus(s: HarnessState): string {
  const lines = [
    `Harness — session ${s.sessionId}`,
    `  mode:    ${s.mode}`,
    `  profile: ${s.taskProfile ?? '(not classified)'}`,
    `  stage:   ${s.currentStage ?? '(not entered)'}`,
    `  history: ${s.history.length} entries`,
    `  scratchpad: ${s.scratchpadPath}`,
  ]
  return lines.join('\n')
}
