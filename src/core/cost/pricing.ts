// src/core/cost/pricing.ts
//
// Phase 7 §5.2 — model pricing table.
//
// All values are USD per 1,000,000 tokens. Numbers are best-effort and may
// drift from the provider's published price list; the cost tracker will
// happily report tokens-only when an entry is missing or stale.
//
// Anthropic Claude 4-series figures are public list pricing as of 2026-04.
// Cache-create / cache-read mirror the standard Anthropic prompt-cache
// multipliers (1.25× input for ephemeral writes, 0.10× input for reads).
//
// OpenAI numbers come from openai.com/pricing as of 2026-04. `gpt-5` is
// treated as a placeholder bracketed against gpt-4o until public pricing
// stabilizes — covered here so unknown-model lookups exercise the
// not-found path in tests.

export type ModelPricing = {
  /** USD per 1M input tokens */
  input: number
  /** USD per 1M output tokens */
  output: number
  /** USD per 1M cache-write tokens (Anthropic ephemeral cache create) */
  cacheCreate?: number
  /** USD per 1M cache-read tokens (Anthropic prompt-cache hit) */
  cacheRead?: number
}

/** Per-model price seed. Lookup is case-insensitive — see {@link findPricing}. */
export const PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude 4-family
  'claude-opus-4-7':   { input: 15.0,  output: 75.0,  cacheCreate: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-6': { input: 3.0,   output: 15.0,  cacheCreate: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5':  { input: 0.25,  output: 1.25,  cacheCreate: 0.30,  cacheRead: 0.025 },

  // OpenAI
  'gpt-5':             { input: 3.0,   output: 15.0 }, // placeholder
  'gpt-4o':            { input: 2.50,  output: 10.0 },
  'gpt-4o-mini':       { input: 0.15,  output: 0.60 },
}

/**
 * Look up pricing for a model id.
 *
 * Lookup is case-insensitive and tolerant of common provider prefixes
 * (e.g. `anthropic/claude-opus-4-7` or `openai/gpt-4o`) so the tracker can
 * record the model id as the provider reported it without forcing callers
 * to strip the prefix first.
 */
export function findPricing(model: string): ModelPricing | undefined {
  if (!model) return undefined
  const key = model.toLowerCase()
  if (PRICING[key]) return PRICING[key]
  const slash = key.lastIndexOf('/')
  if (slash >= 0) {
    const tail = key.slice(slash + 1)
    if (PRICING[tail]) return PRICING[tail]
  }
  return undefined
}
