// src/core/diff/apply.ts
//
// Apply a unified-diff back to a source string. Wraps JsDiff's
// `applyPatch`, normalising its failure modes into a result discriminant
// the caller can pattern-match without try/catch gymnastics.
//
// JsDiff's `applyPatch` returns either the patched string or `false` on
// failure, and additionally throws on malformed inputs. Both forms here
// collapse into `{ success: false, error }` so callers handle one shape.
//
// Side-effects: none.

import { applyPatch, type ApplyPatchOptions } from 'diff'

export type ApplyUnifiedDiffOptions = {
  /**
   * Allow hunks to match with this much line-number drift before
   * rejecting. JsDiff supports up to 4 by default; we keep that.
   */
  fuzzFactor?: number
}

export type ApplyUnifiedDiffResult =
  | { success: true; result: string }
  | { success: false; error: string }

/**
 * Apply a unified-diff patch to `originalText`. Returns either the
 * patched string or a structured error describing the failure.
 */
export function applyUnifiedDiff(
  originalText: string,
  diffText: string,
  options: ApplyUnifiedDiffOptions = {},
): ApplyUnifiedDiffResult {
  if (!diffText.trim()) {
    return { success: false, error: 'empty patch' }
  }

  const opts: ApplyPatchOptions = {
    fuzzFactor: options.fuzzFactor ?? 0,
  }

  let patched: string | false
  try {
    patched = applyPatch(originalText, diffText, opts)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  if (patched === false) {
    return {
      success: false,
      error: 'patch did not apply cleanly (context mismatch)',
    }
  }

  return { success: true, result: patched }
}
