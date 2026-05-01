// src/core/harness/format.ts
import type { HarnessState } from './types'

export function formatStatus(s: HarnessState): string {
  const t = s.triage
  const lines = [
    `Harness — session ${s.sessionId}`,
    `  mode:        ${s.mode}`,
    `  profile:     ${t?.profile ?? '(not classified)'}`,
    `  difficulty:  ${t?.difficulty ?? '(n/a)'}`,
    `  testStrategy:${t?.testStrategy ?? '(n/a)'}`,
    `  stage:       ${s.currentStage ?? '(not entered)'}`,
    `  history:     ${s.history.length} entries`,
    `  scratchpad:  ${s.scratchpadPath}`,
    `  taskGraph:   ${s.taskGraphPath}`,
  ]
  return lines.join('\n')
}
