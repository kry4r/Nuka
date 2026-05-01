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

const ACK_PATTERNS = [
  /^\s*(ok|okay|yes|y|确认|可以|好|sure|good|correct|对|没问题)\b/i,
  /^\s*(ack|approved|accept)\b/i,
]

function looksLikeAck(reply: string): boolean {
  return ACK_PATTERNS.some((re) => re.test(reply))
}

const REFORK_PROMPT = (orig: Triage, hint: string): string => `Re-classify a task into the same 3-axis schema based on the user hint.

Previous classification:
${JSON.stringify({ profile: orig.profile, difficulty: orig.difficulty, testStrategy: orig.testStrategy, reasoning: orig.reasoning }, null, 2)}

User hint:
${hint}

Schema:
{
  "profile": "feature|debug-fix|refactor|investigate|doc|odd-jobs",
  "difficulty": "simple|medium|hard|hell",
  "testStrategy": "tdd|cross-module|multi-test",
  "reasoning": "<one sentence>"
}

Reply with JSON only.`

export type ConfirmDeps = {
  askUser: (question: string) => Promise<string>
  runFork: (prompt: string) => Promise<{ text: string }>
}

/**
 * Surface the LLM's triage to the user via ask_user_question, allowing them to either
 * acknowledge it ("ok") or supply a free-text hint that triggers a re-fork.
 *
 * Either way the returned Triage has `userConfirmed: true` — the user has had a chance
 * to override. If a re-fork is requested but yields invalid JSON, the original triage
 * is preserved (with reasoning amended) and still marked as user-confirmed so the
 * caller doesn't loop forever.
 */
export async function confirmTriage(initial: Triage, deps: ConfirmDeps): Promise<Triage> {
  const question =
    `LLM triage: profile=${initial.profile}, difficulty=${initial.difficulty}, testStrategy=${initial.testStrategy}.\n` +
    `Reasoning: ${initial.reasoning}\n` +
    `Reply "ok" to accept, or describe what to change.`
  const reply = await deps.askUser(question)
  if (looksLikeAck(reply)) {
    return { ...initial, userConfirmed: true }
  }
  // Treat reply as a hint and re-fork
  const r = await deps.runFork(REFORK_PROMPT(initial, reply))
  const parsed = tryParse(r.text)
  if (parsed) {
    return { ...parsed, userConfirmed: true }
  }
  return {
    ...initial,
    userConfirmed: true,
    reasoning: `${initial.reasoning} | user hint did not yield valid JSON; kept original`,
  }
}
