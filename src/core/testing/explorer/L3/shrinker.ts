// src/core/testing/explorer/L3/shrinker.ts
//
// L3 Fuzz — PBT-style sequence shrinker (M3.T2).
// See locked spec §4.4 step 3.
//
// Strategy (deterministic, left-to-right):
//   1. Binary-search the shortest *prefix* of the sequence that still
//      reproduces. This dispatches O(log n) predicate calls and gets us to a
//      tight upper bound fast.
//   2. Per-step deletion pass-until-fixed-point: scan left → right, try
//      removing each element; if predicate still holds, commit the removal
//      and restart. Repeat until a full pass makes no progress.
//
// Both phases are deterministic and depend only on the input sequence and
// the (caller-supplied) predicate.
//
// Predicate contract:
//   - `predicate(s)` returns `true` iff `s` still reproduces the failure.
//   - It MUST be referentially transparent: same input → same result. The
//     shrinker calls it many times on the same prefixes/subsequences and
//     relies on agreement. (Callers using stateful fixtures should wrap each
//     replay in a fresh harness mount.)

export type ShrinkOpts = {
  /** Hard cap on predicate calls in the per-step pass. Default: 4096. */
  maxIters?: number
}

const DEFAULT_MAX_ITERS = 4096

/**
 * Reduce `sequence` to a (locally-)minimal sub-sequence that still satisfies
 * `predicate`. If `predicate(sequence)` is `false` to begin with, the input
 * is returned unchanged (the caller is responsible for verifying the input
 * reproduces before invoking the shrinker).
 */
export function shrink<T>(
  sequence: T[],
  predicate: (s: T[]) => boolean,
  opts?: ShrinkOpts,
): T[] {
  const maxIters = opts?.maxIters ?? DEFAULT_MAX_ITERS

  // Guard 1: empty sequence — nothing to shrink.
  if (sequence.length === 0) return sequence.slice()

  // Guard 2: predicate doesn't hold on the original — return as-is. The
  // shrinker does not synthesise failures; that's the caller's job.
  if (!predicate(sequence)) return sequence.slice()

  let iters = 0

  // -------------------------------------------------------------------------
  // Phase 1 — binary-search prefix.
  // Find the smallest k such that predicate(sequence[0..k]) is still true.
  // Invariant: predicate(sequence[0..hi]) === true (because hi starts at n).
  // We narrow `lo` and `hi` until `lo === hi`.
  // -------------------------------------------------------------------------
  let lo = 1
  let hi = sequence.length
  let best = sequence.slice()
  while (lo < hi && iters < maxIters) {
    const mid = (lo + hi) >> 1
    iters++
    const cand = sequence.slice(0, mid)
    if (predicate(cand)) {
      hi = mid
      best = cand
    } else {
      lo = mid + 1
    }
  }

  // After binary search, `best` is the shortest prefix that reproduces.
  // (Re-check the trivial length-1 case to make this robust to off-by-one.)

  // -------------------------------------------------------------------------
  // Phase 2 — per-step deletion, pass-until-fixed-point.
  // Walk left → right, try removing each element. On success, commit and
  // RESTART the scan (so newly-adjacent positions re-enter the candidate
  // set). Stop when a full pass makes no removals.
  // -------------------------------------------------------------------------
  let progress = true
  while (progress && iters < maxIters) {
    progress = false
    for (let i = 0; i < best.length && iters < maxIters; i++) {
      const cand = best.slice(0, i).concat(best.slice(i + 1))
      iters++
      if (cand.length === 0) {
        // Empty sub-sequence — only accept if predicate truly accepts empty.
        // Predicates over keystroke sequences typically reject empty, so this
        // branch is defensive.
        if (predicate(cand)) {
          best = cand
          progress = true
          break
        }
        continue
      }
      if (predicate(cand)) {
        best = cand
        progress = true
        break
      }
    }
  }

  return best
}
