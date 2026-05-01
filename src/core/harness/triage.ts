import { z } from 'zod'
import type { Triage } from './types'

const Schema = z.object({
  profile: z.enum(['feature', 'debug-fix', 'refactor', 'investigate', 'doc', 'odd-jobs']),
  difficulty: z.enum(['simple', 'medium', 'hard', 'hell']),
  testStrategy: z.enum(['tdd', 'cross-module', 'multi-test']),
  reasoning: z.string(),
})

const PROMPT = (msg: string, repo: string): string => `You classify a coding task into 3 axes and return STRICT JSON only.

Repo summary:
${repo || '(no summary provided)'}

User request:
${msg}

Schema:
{
  "profile": "feature|debug-fix|refactor|investigate|doc|odd-jobs",
  "difficulty": "simple|medium|hard|hell",
  "testStrategy": "tdd|cross-module|multi-test",
  "reasoning": "<one sentence>"
}

Reply with the JSON object only, no prose.`

function tryParse(text: string): z.infer<typeof Schema> | null {
  try {
    const stripped = text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim()
    return Schema.parse(JSON.parse(stripped))
  } catch {
    return null
  }
}

export type TriageOpts = {
  userMessage: string
  repoSummary: string
  runFork: (prompt: string) => Promise<{ text: string }>
}

/**
 * Classify a user message into the three-axis (profile × difficulty × testStrategy) Triage.
 * Up to 2 attempts; on total failure returns a sensible default Triage with
 * `userConfirmed: false` and a reasoning string indicating fallback.
 */
export async function triageMessage(opts: TriageOpts): Promise<Triage> {
  const prompt = PROMPT(opts.userMessage, opts.repoSummary)
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await opts.runFork(prompt)
    const parsed = tryParse(r.text)
    if (parsed) {
      return { ...parsed, userConfirmed: false }
    }
  }
  return {
    profile: 'feature',
    difficulty: 'medium',
    testStrategy: 'tdd',
    reasoning: 'fallback: triage LLM failed twice',
    userConfirmed: false,
  }
}
