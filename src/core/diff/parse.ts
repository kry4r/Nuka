// src/core/diff/parse.ts
//
// Unified-diff parsing — thin, typed wrapper over JsDiff's `parsePatch`.
//
// Upstream (Nuka-Code) doesn't expose a dedicated parse helper; it
// reaches for `parsePatch` directly at the few call sites that need it.
// The seam here lets callers stay TypeScript-clean: the return shape
// drops the leftover `index?` field that JsDiff carries (used only for
// git multi-file patches) and unwraps to `{ files: ParsedDiffFile[] }`
// so a one-file diff is easy to destructure.
//
// Side-effects: none. Pure parser.

import { parsePatch, type StructuredPatch, type StructuredPatchHunk } from 'diff'

export type ParsedDiffFile = {
  oldFileName: string
  newFileName: string
  oldHeader: string | undefined
  newHeader: string | undefined
  hunks: StructuredPatchHunk[]
}

export type ParsedDiff = {
  files: ParsedDiffFile[]
}

/**
 * Parse unified-diff text into structured per-file records.
 *
 * Accepts either a single-file patch or a multi-file patch (the kind
 * emitted by `git diff --staged file1 file2`). Empty input yields
 * `{ files: [] }`.
 */
export function parseUnifiedDiff(diffText: string): ParsedDiff {
  if (!diffText.trim()) return { files: [] }
  const raw = parsePatch(diffText) as StructuredPatch[]
  return {
    files: raw.map(f => ({
      oldFileName: f.oldFileName,
      newFileName: f.newFileName,
      oldHeader: f.oldHeader,
      newHeader: f.newHeader,
      hunks: f.hunks,
    })),
  }
}

/**
 * Convenience: parse and return the first (or only) file's hunks. Use
 * when the caller knows the input is a single-file diff. Returns `null`
 * if no file was parsed.
 */
export function parseUnifiedDiffSingleFile(
  diffText: string,
): ParsedDiffFile | null {
  const parsed = parseUnifiedDiff(diffText)
  return parsed.files[0] ?? null
}
