// src/core/testing/assertions.ts
//
// Phase 9 §3 — pure matcher functions. No I/O. Each `match*` returns
// `{ok:true}` on success or `{ok:false, message}` on failure. The runner
// composes these into step results.

import type { AssertSpec } from './plan'

export type FrameContext = {
  /** All frames captured so far (oldest first). */
  frames: string[]
  /** Convenience: the last frame, or '' when no frames yet. */
  lastFrame: string
}

export type MatchResult = { ok: true } | { ok: false; message: string }

/** Trim ANSI escapes so plan authors can target plain text. */
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g
function strip(s: string): string { return s.replace(ANSI, '') }

export function matches(spec: AssertSpec, ctx: FrameContext): MatchResult {
  const last = strip(ctx.lastFrame)
  if ('contains' in spec) {
    return last.includes(spec.contains)
      ? { ok: true }
      : { ok: false, message: `expected last frame to contain ${JSON.stringify(spec.contains)}\n--- last frame ---\n${last}` }
  }
  if ('notContains' in spec) {
    return !last.includes(spec.notContains)
      ? { ok: true }
      : { ok: false, message: `expected last frame to NOT contain ${JSON.stringify(spec.notContains)}\n--- last frame ---\n${last}` }
  }
  if ('regex' in spec) {
    const re = new RegExp(spec.regex)
    return re.test(last)
      ? { ok: true }
      : { ok: false, message: `expected last frame to match /${spec.regex}/\n--- last frame ---\n${last}` }
  }
  if ('equals' in spec) {
    return last === spec.equals
      ? { ok: true }
      : { ok: false, message: `expected last frame to equal:\n${spec.equals}\n--- got ---\n${last}` }
  }
  if ('frameCount' in spec) {
    return ctx.frames.length === spec.frameCount
      ? { ok: true }
      : { ok: false, message: `expected ${spec.frameCount} frames, got ${ctx.frames.length}` }
  }
  if ('lastFrameMatches' in spec) {
    const lf = spec.lastFrameMatches
    if ('regex' in lf) {
      return new RegExp(lf.regex).test(last)
        ? { ok: true }
        : { ok: false, message: `lastFrameMatches: regex /${lf.regex}/ did not match\n--- last frame ---\n${last}` }
    }
    return last.includes(lf.contains)
      ? { ok: true }
      : { ok: false, message: `lastFrameMatches: missing ${JSON.stringify(lf.contains)}\n--- last frame ---\n${last}` }
  }
  return { ok: false, message: `unknown assertion shape: ${JSON.stringify(spec)}` }
}

/**
 * Render a line-by-line diff for snapshot mismatch messages. Not a true LCS
 * — just the first differing line, plus a few lines of surrounding context.
 */
export function snapshotDiff(expected: string, actual: string): string {
  const e = expected.split('\n')
  const a = actual.split('\n')
  const max = Math.max(e.length, a.length)
  const lines: string[] = []
  let firstMismatch = -1
  for (let i = 0; i < max; i++) {
    if (e[i] !== a[i]) {
      if (firstMismatch === -1) firstMismatch = i
      lines.push(`- ${e[i] ?? '<missing>'}`)
      lines.push(`+ ${a[i] ?? '<missing>'}`)
    } else {
      lines.push(`  ${e[i] ?? ''}`)
    }
  }
  if (firstMismatch === -1) return 'snapshots are equal'
  return [
    `snapshot mismatch (first diff at line ${firstMismatch + 1})`,
    ...lines,
  ].join('\n')
}
