// src/core/recap/awaySummary.ts — Phase 14c §6.3
const PROMPT = `The user stepped away and is coming back. Write exactly 1-3 short sentences. Start with the high-level task — what they are building or debugging, not implementation details. Then the concrete next step. Skip status reports and commit recaps.`

type Message = { role?: string; content?: string | unknown }

export async function generateAwaySummary(opts: {
  messages: Message[]
  signal: AbortSignal
  runFork: (prompt: string) => Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number }; modelUsed?: string }>
}): Promise<{ text: string; tokensUsed: number; modelUsed: string }> {
  const recent = opts.messages
    .slice(-30)
    .map(m => `[${(m as any).role ?? 'user'}] ${typeof (m as any).content === 'string' ? (m as any).content : JSON.stringify((m as any).content ?? '')}`)
    .join('\n')

  const r = await opts.runFork(`${PROMPT}\n\nRecent transcript:\n${recent}`)
  return {
    text: r.text.trim().slice(0, 400),
    tokensUsed: r.usage?.inputTokens ?? 0,
    modelUsed: r.modelUsed ?? 'unknown',
  }
}
