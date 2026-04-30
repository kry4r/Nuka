// src/core/recap/fields/nextStep.ts — Phase 14c
// Calls a forked agent to produce a concrete next-step suggestion.
type Rec = { topic: string; payload: any; t?: number }
type Session = { messages: unknown[] }
type Fork = (prompt: string) => Promise<{ text: string }>

export async function reduceNextStep(opts: { events: Rec[]; session: Session; runFork: Fork }): Promise<string> {
  const recent = opts.events
    .slice(-30)
    .map(r => `${r.topic}: ${JSON.stringify(r.payload).slice(0, 120)}`)
    .join('\n')

  const prompt = `Given the following recent events, write ONE concrete next-step suggestion in a single paragraph (≤ 500 chars). Avoid status reports, avoid restating what just happened.

Events:
${recent}

Next step:`

  const { text } = await opts.runFork(prompt)
  return text.trim().slice(0, 500)
}
