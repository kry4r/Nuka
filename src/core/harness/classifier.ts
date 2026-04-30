// src/core/harness/classifier.ts
import type { TaskProfile } from './types'

const VALID: TaskProfile[] = ['explore', 'fix', 'refactor', 'feature', 'docs', 'config', 'research']

export async function classifyTaskProfile(opts: {
  userMessage: string
  runFork: (prompt: string) => Promise<{ text: string }>
}): Promise<TaskProfile> {
  const prompt = `Classify the following user request into ONE of: explore, fix, refactor, feature, docs, config, research. Reply with the single word, no explanation.\n\nRequest: ${opts.userMessage}\n\nClassification:`
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await opts.runFork(prompt)
    const tok = r.text.trim().toLowerCase().split(/\s+/)[0] as TaskProfile
    if (VALID.includes(tok)) return tok
  }
  return 'feature'
}
