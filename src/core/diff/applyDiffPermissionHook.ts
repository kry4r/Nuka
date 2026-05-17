// src/core/diff/applyDiffPermissionHook.ts
//
// Permission gate for the ApplyDiff tool: a `beforeToolCall` HookHandler
// that vetoes ApplyDiff calls whose target path is outside a configured
// allow-list. Lets a user sandbox the agent to specific directories
// without modifying the tool itself — same wiring pattern as the
// recentFiles-auto-touch hook (see ../fileSearch/recentFilesHook.ts).
//
// Why a hook (not a tool flag): `ApplyDiffInput` already has an
// `expectedFiles` allow-list, but that is a *per-call* guardrail set by
// the agent itself in the same prompt that issues the diff. It does not
// constrain what the *agent* can ask for — only what the agent has just
// promised. The permission hook is the opposite: it's a process-level
// constraint the operator imposes, regardless of what the agent asks.
// The two compose cleanly (hook denies first, expectedFiles second).
//
// Path extraction:
//   ApplyDiff's input shape carries paths inside the `diff` *text*, not
//   in a top-level field. The tool's own `applyDiffToFiles` parses the
//   diff and strips `a/` / `b/` prefixes to recover filesystem paths
//   (see applyDiffTool.ts:pickPath). We mirror that logic here via
//   `parseUnifiedDiff` so the gate sees the same paths the tool would
//   touch.
//
//   In addition, the brief asks the handler to fall back to common
//   single-path / multi-path field names (`path`, `file_path`,
//   `filename`) so the same factory works for synthetic test tools and
//   for any future ApplyDiff variant that exposes paths as input fields.
//
// Conservative on malformed input: if NO target path can be extracted
// (empty diff, garbage diff that yields no real files, AND no fallback
// field is set), the handler denies. The operator opted in to sandboxing
// — failing closed is the correct stance.

import { resolve, relative, isAbsolute, sep } from 'node:path'
import type { HookHandler } from '../hooks/events'
import { parseUnifiedDiff } from './parse'
import { APPLY_DIFF_TOOL_NAME } from './applyDiffTool'

/**
 * Configuration for {@link createApplyDiffPermissionHandler}.
 */
export interface ApplyDiffPermissionConfig {
  /**
   * Allowed root directories (absolute or relative to `cwd`). Tool calls
   * touching paths outside these roots are denied. An empty array denies
   * every call (useful for "lockdown" mode and exercised by tests).
   */
  allowedRoots: string[]
  /**
   * Tool name to gate. Defaults to {@link APPLY_DIFF_TOOL_NAME} so the
   * factory works out of the box; tests override this with a synthetic
   * name to stay decoupled from the real tool wiring.
   */
  toolName?: string
  /**
   * Optional override for the path extractor. The default reads paths
   * from the parsed `diff` text plus common single/multi-path fields
   * (`path`, `file_path`, `filename`, `paths`, `file_paths`, `filenames`).
   * Provide your own if the gated tool's input shape carries paths
   * somewhere else.
   */
  extractPaths?: (input: unknown) => string[]
  /**
   * Base directory used to resolve relative paths in both `allowedRoots`
   * and extracted target paths. Defaults to `process.cwd()`. Exposed
   * primarily for tests; production callers can leave this unset.
   */
  cwd?: string
}

/**
 * Strip the conventional `a/` / `b/` prefix that unified-diff headers
 * carry. Mirrors applyDiffTool.stripDiffPathPrefix so this gate sees the
 * same logical path the tool would touch on disk.
 */
function stripDiffPathPrefix(path: string): string {
  if (path.startsWith('a/')) return path.slice(2)
  if (path.startsWith('b/')) return path.slice(2)
  return path
}

/**
 * Pull a string field off an opaque record, treating empty strings as
 * "not present" (the same treatment recentFilesHook applies).
 */
function readStringField(
  obj: Record<string, unknown>,
  field: string,
): string | null {
  const v = obj[field]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Pull an array-of-strings field off an opaque record. Non-string
 * entries are filtered out; an entirely empty array returns `null`.
 */
function readStringArrayField(
  obj: Record<string, unknown>,
  field: string,
): string[] | null {
  const v = obj[field]
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const entry of v) {
    if (typeof entry === 'string' && entry.length > 0) out.push(entry)
  }
  return out.length > 0 ? out : null
}

/**
 * Default extractor used when {@link ApplyDiffPermissionConfig.extractPaths}
 * is not provided. Walks the well-known input shapes for ApplyDiff and
 * the brief's fallback field names. Always returns a fresh array — never
 * the input array, so the caller may mutate it safely.
 */
export function defaultExtractApplyDiffPaths(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return []
  const obj = input as Record<string, unknown>
  const paths: string[] = []

  // 1. ApplyDiff's canonical shape: `diff` is a unified-diff string. Run
  //    it through the same parser the tool uses so we get the exact
  //    paths it would write to. `parseUnifiedDiff` is pure and never
  //    throws on garbage — it just yields `{ files: [] }`.
  const diff = obj.diff
  if (typeof diff === 'string' && diff.length > 0) {
    const parsed = parseUnifiedDiff(diff)
    for (const file of parsed.files) {
      const oldName = file.oldFileName
      const newName = file.newFileName
      // Skip the parser's synthetic empty entry (both names undefined
      // and no hunks — same filter applyDiffToFiles applies). Also
      // skip /dev/null markers, which are the diff convention for
      // "create" (old=/dev/null) or "delete" (new=/dev/null); the
      // *other* side carries the real filesystem path.
      const candidates: string[] = []
      if (typeof newName === 'string' && newName !== '/dev/null') {
        candidates.push(newName)
      }
      if (typeof oldName === 'string' && oldName !== '/dev/null') {
        candidates.push(oldName)
      }
      for (const c of candidates) {
        const stripped = stripDiffPathPrefix(c)
        if (stripped.length > 0) paths.push(stripped)
      }
    }
  }

  // 2. Single-path fallback fields. These match the field names the
  //    brief mentions plus the ones already used by recentFilesHook;
  //    no real tool today uses them as ApplyDiff input, but they make
  //    the factory usable for tests and future variants.
  for (const field of ['path', 'file_path', 'filename']) {
    const v = readStringField(obj, field)
    if (v !== null) paths.push(v)
  }

  // 3. Multi-path fallback fields. Same rationale as (2).
  for (const field of ['paths', 'file_paths', 'filenames']) {
    const arr = readStringArrayField(obj, field)
    if (arr !== null) paths.push(...arr)
  }

  return paths
}

/**
 * Return true iff `target` is `root` itself or a path strictly under it.
 *
 * Uses `path.relative` and rejects relatives that start with `..` (path
 * traversal out of `root`) or that are absolute on Windows (drive
 * change). A `relative === ''` result means `target === root`, which we
 * accept (the root itself is "under" the allow-list).
 */
function isPathUnder(target: string, root: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return true
  // `..` prefix → target escapes root. The trailing `sep` check stops a
  // false positive on a sibling whose name happens to start with `..`
  // (e.g. `..foo`).
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false
  // `relative()` can return an absolute path on Windows when the two
  // inputs live on different drives. Treat that as "not under".
  if (isAbsolute(rel)) return false
  return true
}

/**
 * Build a `beforeToolCall` handler that vetoes calls to the gated tool
 * when any target path falls outside the configured allow-list.
 *
 * The handler:
 *   - Only acts when `ctx.toolName === config.toolName` (passes through
 *     otherwise).
 *   - Resolves both the allow-list roots and each extracted target path
 *     against `config.cwd ?? process.cwd()` so relative inputs are
 *     normalised before comparison.
 *   - Denies with `{ skip: true, reason: <human-readable> }` on any
 *     violation, including when zero target paths could be extracted
 *     (conservative failure mode — see file header).
 *   - Returns `{}` (allow) when every extracted path is under at least
 *     one allowed root.
 */
export function createApplyDiffPermissionHandler(
  config: ApplyDiffPermissionConfig,
): HookHandler {
  const toolName = config.toolName ?? APPLY_DIFF_TOOL_NAME
  const extract = config.extractPaths ?? defaultExtractApplyDiffPaths
  // Resolve roots up front so each invocation does O(targets) work
  // instead of O(targets * roots) absolutising + traversal-check.
  const baseCwd = config.cwd ?? process.cwd()
  const absoluteRoots = config.allowedRoots.map(r => resolve(baseCwd, r))

  return (ctx) => {
    if (ctx.toolName !== toolName) return {}

    const payload = ctx.payload
    const input = payload?.input
    const rawTargets = extract(input)

    if (rawTargets.length === 0) {
      return {
        skip: true,
        reason: `${toolName} denied: could not extract target path from input`,
      }
    }

    // Resolve every target against the configured cwd so path-traversal
    // attempts (e.g. `../../etc/passwd`) collapse to their real absolute
    // form before the allow-list check. Without this, a literal
    // `..`-prefixed string would fail the `relative()` test against
    // `baseCwd` even though it might resolve into the allowed tree.
    for (const raw of rawTargets) {
      const absTarget = resolve(baseCwd, raw)
      const ok = absoluteRoots.some(root => isPathUnder(absTarget, root))
      if (!ok) {
        const rootsRepr =
          absoluteRoots.length === 0
            ? '[]'
            : `[${absoluteRoots.map(r => `'${r}'`).join(', ')}]`
        return {
          skip: true,
          reason: `${toolName} denied: path '${raw}' is outside allowed roots ${rootsRepr}`,
        }
      }
    }

    return {}
  }
}
