// src/core/memdir/relevance.ts
//
// Phase 7 §5.3 — keyword TF-IDF over memory entries.
//
// Embeddings would be better but require a runtime model (or a network
// round-trip). For the agent loop's "what's relevant for this prompt"
// gating, a TF-IDF sweep over `keywords` + body words gives us decent
// recall at zero cost. Top-K is capped externally to bound system-prompt
// growth.

import type { MemoryEntry } from './parser'

const STOPWORDS = new Set<string>([
  'the','and','for','with','that','this','from','into','your','their','they','have',
  'are','was','were','will','can','any','not','but','its','it','to','of','in','a','an',
  'on','by','as','is','at','be','or','if','do','i','you','we','us','me','my','our',
])

/** Lower-case alnum tokenizer. Empties + stopwords dropped. */
export function tokenize(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  const lower = text.toLowerCase()
  // Split on anything that isn't a letter/digit/_-.
  for (const tok of lower.split(/[^a-z0-9_]+/)) {
    if (!tok) continue
    if (tok.length < 2) continue
    if (STOPWORDS.has(tok)) continue
    out.push(tok)
  }
  return out
}

/**
 * Per-entry token bag: keyword tokens count 3× to honor the spec's
 * "TF-IDF over keywords field" — keywords are author-curated and should
 * outweigh accidental body matches.
 */
export function entryTokens(e: MemoryEntry): string[] {
  const out: string[] = []
  for (const kw of e.keywords) {
    const toks = tokenize(kw)
    for (const t of toks) {
      out.push(t); out.push(t); out.push(t)
    }
  }
  out.push(...tokenize(e.body))
  return out
}

type Scored = { entry: MemoryEntry; score: number }

/**
 * Rank `entries` against `queryTokens` by TF-IDF cosine-ish score, return
 * the top-K. K defaults to 5. Entries with score 0 are filtered out, so
 * an entirely irrelevant query yields `[]` (which lets the system-prompt
 * builder skip the `## Memory` section entirely).
 */
export function findRelevant(
  entries: readonly MemoryEntry[],
  queryTokens: readonly string[],
  k: number = 5,
): MemoryEntry[] {
  if (entries.length === 0 || queryTokens.length === 0) return []

  // Build IDF over the entry corpus.
  const docFreq = new Map<string, number>()
  const docs = entries.map(e => entryTokens(e))
  for (const doc of docs) {
    const seen = new Set<string>()
    for (const t of doc) {
      if (seen.has(t)) continue
      seen.add(t)
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
    }
  }
  const N = entries.length
  const idf = (t: string): number => {
    const df = docFreq.get(t) ?? 0
    if (df === 0) return 0
    return Math.log((N + 1) / (df + 1)) + 1 // smoothed
  }

  const queryUniq = Array.from(new Set(queryTokens))
  const scored: Scored[] = []
  for (let i = 0; i < entries.length; i++) {
    const doc = docs[i]!
    const tf = new Map<string, number>()
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const qt of queryUniq) {
      const f = tf.get(qt)
      if (!f) continue
      score += f * idf(qt)
    }
    if (score > 0) scored.push({ entry: entries[i]!, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map(s => s.entry)
}
