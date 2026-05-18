// src/core/testing/explorer/judge.ts
//
// L3' Judge verb — M4 implementation. Two-tier flow per locked spec §4.5:
//
//      ┌──────────────────────────────────────────────────────────┐
//      │ cache hit? ──► reuse verdict (unless forceReJudge=true)  │
//      │ miss ─► Haiku quick-pass ─┐                              │
//      │                           ├─ {issues:false} → clean      │
//      │                           └─ {issues:true}  → Opus pass  │
//      │ persist verdict + return                                 │
//      └──────────────────────────────────────────────────────────┘
//
// Cost guards:
//   * maxHaiku / maxOpus (defaults 200 / 20; env INK_EXPLORER_MAX_*).
//   * Cap exhausted → log warning, skip remaining calls, flush whatever
//     verdicts we already produced. budgetHit.<tier> = true in result.
//
// Self-contained per spec §3.2 — does NOT import @anthropic-ai/sdk or
// anything under src/core/provider/. The HTTP client lives in
// L3_judge/client.ts and is injectable via the _client test backdoor.

import { callMessages as defaultCallMessages } from './L3_judge/client'
import { JudgeCache, type JudgeVerdict } from './L3_judge/cache'
import { buildHaikuPrompt, buildOpusPrompt } from './L3_judge/prompt'
import type { JudgeOpts, JudgeResult, FailureRecord } from './types'

type CallMessagesFn = typeof defaultCallMessages

/** Extended opts with a test-only client backdoor (matches sweep _fixtures /
 *  fuzz _fixtureDef pattern). */
type JudgeOptsExtended = JudgeOpts & {
  _client?: CallMessagesFn | null
}

// ---------------------------------------------------------------------------
// Module-level client override for CLI flow + integration tests. Production
// code should pass `_client` via opts; CLI uses __setJudgeClientForTest() to
// inject the real client without bloating the cli.js bundle with explorer
// internals.
// ---------------------------------------------------------------------------
let _clientOverride: CallMessagesFn | null = null

/** TEST-ONLY: inject a mock client. Pass null to clear. */
export function __setJudgeClientForTest(fn: CallMessagesFn | null): void {
  _clientOverride = fn
}

function resolveCap(envName: string, fallback: number): number {
  const raw = process.env[envName]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function viewportKey(v: { cols: number; rows: number }): string {
  return `${v.cols}x${v.rows}`
}

/** Extract a JSON object from a model reply. Models occasionally wrap the
 *  payload in prose or code fences; this tolerates both. Returns null if no
 *  parseable JSON is found. */
function extractJson<T = unknown>(raw: string): T | null {
  const trimmed = raw.trim()
  // Direct parse first.
  try {
    return JSON.parse(trimmed) as T
  } catch {
    /* fallthrough */
  }
  // Strip fenced ```json ... ``` or ``` ... ```.
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  if (fence) {
    try {
      return JSON.parse(fence[1]!) as T
    } catch {
      /* fallthrough */
    }
  }
  // Last-ditch: first { ... } substring.
  const braceStart = trimmed.indexOf('{')
  const braceEnd = trimmed.lastIndexOf('}')
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(trimmed.slice(braceStart, braceEnd + 1)) as T
    } catch {
      /* fallthrough */
    }
  }
  return null
}

function normaliseHaiku(reply: string): { issues: boolean } {
  const j = extractJson<{ issues?: boolean | unknown[]; why?: string }>(reply)
  if (!j) return { issues: false }
  // Boolean form (preferred) or array form (Opus-style — treat non-empty as issues).
  if (typeof j.issues === 'boolean') return { issues: j.issues }
  if (Array.isArray(j.issues)) return { issues: j.issues.length > 0 }
  return { issues: false }
}

function normaliseOpus(
  reply: string,
): { issues: { invariant: string; description: string }[] } {
  const j = extractJson<{
    issues?: { invariant?: string; description?: string }[]
  }>(reply)
  if (!j || !Array.isArray(j.issues)) return { issues: [] }
  return {
    issues: j.issues.map((it) => ({
      invariant: String(it.invariant ?? 'unknown'),
      description: String(it.description ?? ''),
    })),
  }
}

/**
 * Two-tier judge. See locked spec §4.5 and the file-header diagram.
 *
 * Returns the verdict for every failure that was successfully judged
 * (cache hit, Haiku-only, or Haiku→Opus). When a cost cap is exhausted
 * mid-batch, remaining failures are dropped from the result and a
 * `budgetHit.<tier>` flag is set; partial verdicts are NOT thrown away.
 */
export async function judge(opts: JudgeOptsExtended): Promise<JudgeResult> {
  const {
    failures,
    apiKey,
    cacheRoot,
    maxHaiku: maxHaikuOpt,
    maxOpus: maxOpusOpt,
    forceReJudge = false,
    _client,
  } = opts

  const client: CallMessagesFn =
    _client ?? _clientOverride ?? defaultCallMessages

  const maxHaiku = maxHaikuOpt ?? resolveCap('INK_EXPLORER_MAX_HAIKU', 200)
  const maxOpus = maxOpusOpt ?? resolveCap('INK_EXPLORER_MAX_OPUS', 20)

  const cache = new JudgeCache(cacheRoot)
  const verdicts: JudgeVerdict[] = []
  const budgetHit = { haiku: false, opus: false }
  let haikuCalls = 0
  let opusCalls = 0

  for (const failure of failures) {
    const gridHash = failure.gridHash ?? ''
    const vk = viewportKey(failure.viewport)
    const cacheKey = {
      gridHash,
      component: failure.component,
      viewportKey: vk,
    }

    if (!forceReJudge) {
      const cached = cache.get(cacheKey)
      if (cached) {
        verdicts.push(cached)
        continue
      }
    }

    if (haikuCalls >= maxHaiku) {
      if (!budgetHit.haiku) {
        budgetHit.haiku = true
        console.warn(
          `[judge] Haiku cap (${maxHaiku}) reached — skipping remaining failures. ` +
            `Raise INK_EXPLORER_MAX_HAIKU to continue.`,
        )
      }
      // Stop further calls; flush what we have.
      break
    }

    // Tier 1 — Haiku quick-pass.
    const haikuPrompt = buildHaikuPrompt({
      componentName: failure.component,
      caseName: failure.fixtureCase,
      viewport: failure.viewport,
      asciiView: failure.asciiView,
    })
    haikuCalls++
    const haikuRes = await client({
      apiKey,
      model: 'claude-haiku-4-5-20251001',
      system: haikuPrompt.system,
      user: haikuPrompt.user,
      maxTokens: 256,
    })
    const haikuDecision = normaliseHaiku(haikuRes.text)

    if (!haikuDecision.issues) {
      const verdict: JudgeVerdict = {
        ok: true,
        judgedBy: 'haiku',
        judgedAt: Date.now(),
      }
      cache.put(cacheKey, verdict)
      verdicts.push(verdict)
      continue
    }

    // Tier 2 — Opus precise-pass.
    if (opusCalls >= maxOpus) {
      if (!budgetHit.opus) {
        budgetHit.opus = true
        console.warn(
          `[judge] Opus cap (${maxOpus}) reached — recording Haiku-only verdict. ` +
            `Raise INK_EXPLORER_MAX_OPUS to continue.`,
        )
      }
      // Conservative: record as ok=false with a marker issue so the failure
      // doesn't silently disappear from the result.
      const verdict: JudgeVerdict = {
        ok: false,
        issues: [
          {
            invariant: 'opus_cap_exhausted',
            description: 'Haiku flagged issues but Opus budget was exhausted.',
          },
        ],
        judgedBy: 'haiku',
        judgedAt: Date.now(),
      }
      cache.put(cacheKey, verdict)
      verdicts.push(verdict)
      continue
    }

    const opusPrompt = buildOpusPrompt({
      componentName: failure.component,
      caseName: failure.fixtureCase,
      viewport: failure.viewport,
      asciiView: failure.asciiView,
    })
    opusCalls++
    const opusRes = await client({
      apiKey,
      model: 'claude-opus-4-7',
      system: opusPrompt.system,
      user: opusPrompt.user,
      maxTokens: 1024,
    })
    const opusDecision = normaliseOpus(opusRes.text)

    const verdict: JudgeVerdict = {
      ok: opusDecision.issues.length === 0,
      issues: opusDecision.issues.length > 0 ? opusDecision.issues : undefined,
      judgedBy: 'opus',
      judgedAt: Date.now(),
    }
    cache.put(cacheKey, verdict)
    verdicts.push(verdict)
  }

  return { verdicts, budgetHit }
}

/** Re-export so consumers can `import { JudgeVerdict } from '../judge'`. */
export type { JudgeVerdict } from './L3_judge/cache'

/** Convenience type for callers reading FailureRecord shape from this module. */
export type { FailureRecord } from './types'
