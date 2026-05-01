// src/core/harness/classifier.ts
//
// LEGACY single-axis classifier — being replaced by `triage.ts` in T2.1 / removed in T2.3.
// Adapted to the new TaskProfile union so the file typechecks during the migration window.
import type { TaskProfile } from './types'

const VALID: TaskProfile[] = ['feature', 'debug-fix', 'refactor', 'investigate', 'doc', 'odd-jobs']

export async function classifyTaskProfile(opts: {
  userMessage: string
  runFork: (prompt: string) => Promise<{ text: string }>
}): Promise<TaskProfile> {
  const prompt = `Classify the following user request into ONE of: feature, debug-fix, refactor, investigate, doc, odd-jobs. Reply with the single word, no explanation.\n\nRequest: ${opts.userMessage}\n\nClassification:`
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await opts.runFork(prompt)
    const tok = r.text.trim().toLowerCase().split(/\s+/)[0] as TaskProfile
    if (VALID.includes(tok)) return tok
  }
  return 'feature'
}
