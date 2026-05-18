// src/core/testing/explorer/L3_judge/client.ts
//
// L3' Judge — minimal Anthropic /v1/messages HTTP client.
// See locked spec §4.5: no `@anthropic-ai/sdk` dependency (keeps the skill
// install footprint tiny). Self-contained per spec §3.2 — must not import
// from `src/core/provider/`.
//
// Only the two narrow features the judge needs are exposed:
//   * a single-turn `system` + `user` request,
//   * parsed `{ text, usage:{inTok,outTok} }` response,
//   * typed errors for the two retryable failure modes we care about.

/** HTTP 429 — request rate limited by Anthropic. */
export class RateLimitError extends Error {
  readonly status = 429
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

/** HTTP 5xx — transient server error. */
export class ServerError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ServerError'
    this.status = status
  }
}

/** Subset of Anthropic /v1/messages response we depend on. */
type RawResponse = {
  content?: Array<{ type: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { message?: string }
}

/** Pinned model IDs — see locked spec §4.5. */
export type JudgeModel = 'claude-haiku-4-5-20251001' | 'claude-opus-4-7'

/**
 * Single-turn POST to `https://api.anthropic.com/v1/messages`.
 *
 * @throws RateLimitError on HTTP 429
 * @throws ServerError    on HTTP 500/502/503/504
 * @throws Error          on other non-2xx (caller-level fail-fast)
 */
export async function callMessages(opts: {
  apiKey: string
  model: JudgeModel
  system: string
  user: string
  maxTokens: number
}): Promise<{ text: string; usage: { inTok: number; outTok: number } }> {
  const { apiKey, model, system, user, maxTokens } = opts

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (res.status === 429) {
    const text = await safeReadText(res)
    throw new RateLimitError(`Anthropic 429: ${text}`)
  }
  if (res.status >= 500 && res.status < 600) {
    const text = await safeReadText(res)
    throw new ServerError(`Anthropic ${res.status}: ${text}`, res.status)
  }
  if (!res.ok) {
    const text = await safeReadText(res)
    throw new Error(`Anthropic ${res.status}: ${text}`)
  }

  const raw = (await res.json()) as RawResponse

  // text from content[0].text (first text block; the API can interleave but
  // for judge we send a single-turn structural prompt and expect one block).
  const firstBlock = raw.content?.[0]
  const text = typeof firstBlock?.text === 'string' ? firstBlock.text : ''

  const inTok = raw.usage?.input_tokens ?? 0
  const outTok = raw.usage?.output_tokens ?? 0

  return { text, usage: { inTok, outTok } }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return '<no-body>'
  }
}
