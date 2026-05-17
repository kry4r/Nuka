// src/core/findReplace/findReplaceTool.ts
//
// FindReplace — compound tool that searches files matching a glob pattern,
// applies find-and-replace per file, produces a unified-diff preview per
// changed file, and (optionally) commits the change set through
// {@link applyDiffToFiles} when the caller opts out of dry-run mode AND
// supplies an `expectedFiles` allow-list.
//
// This is an orchestration tool: every primitive it uses is already in
// the repo. The value here is composing them into a single safe-by-
// default workflow so the agent can do "rename a symbol across the src
// tree" or "swap one license header for another" without juggling four
// underlying tools (FileSearch + Read + str-replace + ApplyDiff).
//
//   - walkFiles            (fileSearch/walker) → which files exist
//   - matchesGlob          (glob/glob)         → does this path match
//   - formatUnifiedDiff    (diff/format)       → preview
//   - countLinesChanged    (diff/format)       → additions/deletions
//   - applyDiffToFiles     (diff/applyDiffTool) → actual writes
//
// Safety stance, copied from `applyDiffToFiles` and tightened:
//
//   1. `dryRun` defaults to TRUE. Callers must explicitly say "yes,
//      write" — the agent can't accidentally mutate a tree by forgetting
//      a flag.
//   2. `dryRun: false` REQUIRES a non-empty `expectedFiles` allow-list.
//      The tool refuses to write any file outside the list, even if it
//      matched the glob.
//   3. Empty `pattern` is refused — replaceAll('', x) inserts `x` between
//      every code unit, which is almost certainly not what the caller
//      meant.
//   4. Invalid regex is caught and surfaced as a structured error rather
//      than thrown.
//   5. `maxFiles` caps the result set; exceeding it sets `truncated: true`
//      and stops the scan early.
//   6. `signal` aborts the scan mid-stream and returns a partial result
//      (matches the walker / ApplyDiff conventions).
//
// Output shape (also serialised as the trailing JSON in `output` so
// structured consumers can `JSON.parse` the last non-empty line):
//
//   {
//     filesScanned, filesChanged, filesSkipped,
//     previews: [{ path, additions, deletions, diff }],
//     applied?: [{ path, success, error? }],   // only when dryRun=false
//     dryRun, truncated, aborted
//   }
//
// Side-effects: filesystem reads (always); filesystem writes (only when
// `dryRun: false` AND every file passes the `expectedFiles` guard).

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import { compileGlob } from '../glob/glob'
import { walkFiles } from '../fileSearch/walker'
import { gitignoreFilter } from '../fileSearch/gitignoreFilter'
import {
  countLinesChanged,
  formatUnifiedDiff,
  getHunksFromContents,
} from '../diff/format'
import {
  applyDiffToFiles,
  type ApplyDiffResultPayload,
} from '../diff/applyDiffTool'

export const FIND_REPLACE_TOOL_NAME = 'FindReplace'

/** Default cap on number of matching files scanned. */
export const FIND_REPLACE_DEFAULT_MAX_FILES = 100

/**
 * Hard ceiling on `maxFiles`. Even when the caller asks for more, the
 * tool clamps to this number — prevents runaway scans over a giant
 * mono-repo from blowing the transcript or running for minutes.
 */
export const FIND_REPLACE_HARD_MAX_FILES = 1000

export type FindReplaceInput = {
  /** File glob, e.g. 'src/**\/*.ts'. Required. */
  glob: string
  /** Root directory for the walk. Defaults to ctx.cwd / process.cwd(). */
  rootDir?: string
  /** Pattern to find (literal string by default; regex when isRegex=true). */
  pattern: string
  /**
   * Replacement string. When `isRegex: true`, supports `$1`, `$2`, ...
   * backreferences and `$&` (whole match) per the standard RegExp
   * `replace` semantics.
   */
  replacement: string
  /** When true, `pattern` is treated as a regex source. Default false. */
  isRegex?: boolean
  /** Case-insensitive matching. Default false. */
  caseInsensitive?: boolean
  /** Multiline regex mode (`^`/`$` match line boundaries). Default false. */
  multiline?: boolean
  /**
   * SAFE-BY-DEFAULT. When true (default), no files are written; the tool
   * just reports the previews. Pass `false` AND a non-empty
   * `expectedFiles` to actually write.
   */
  dryRun?: boolean
  /**
   * Allow-list of files that may be written. REQUIRED when `dryRun:
   * false`. Entries may be absolute or relative (resolved against
   * `rootDir`). Any matched file outside the list is reported as
   * "refused" and not written, even though it appeared in the previews.
   */
  expectedFiles?: string[]
  /** Cap on total files scanned. Default 100, hard max 1000. */
  maxFiles?: number
  /** When true (default), skip files matched by `.gitignore`. */
  respectGitignore?: boolean
  /**
   * Additional glob patterns to exclude. Any file matching ANY exclude
   * pattern is skipped before the find-replace runs.
   */
  excludePaths?: string[]
}

export type FindReplacePreview = {
  /** Forward-slash relative path (or absolute if `rootDir` is absolute). */
  path: string
  /** Number of `+` lines in the diff. */
  additions: number
  /** Number of `-` lines in the diff. */
  deletions: number
  /** Unified-diff text. */
  diff: string
}

export type FindReplaceApplyResult = {
  path: string
  success: boolean
  error?: string
}

export type FindReplaceResult = {
  filesScanned: number
  filesChanged: number
  filesSkipped: number
  previews: FindReplacePreview[]
  applied?: FindReplaceApplyResult[]
  dryRun: boolean
  truncated: boolean
  aborted: boolean
}

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `FindReplace: ${msg}` }
}

/**
 * Build the regex used for find-replace. Returns either a compiled
 * regex or a structured error.
 *
 * Implementation notes:
 *
 *  - When `isRegex` is false we still need a `g`-flag regex so
 *    `replace` swaps every occurrence, not just the first. We use
 *    `String.prototype.replaceAll` with a regex (not a string) because
 *    `replaceAll(string, string)` cannot honour `caseInsensitive` /
 *    `multiline` opts. To use a regex with `replaceAll`, the regex
 *    MUST carry the global flag — that's why we always include `g`.
 *  - For literal mode, we escape regex metacharacters in the pattern
 *    so the user-supplied string is matched verbatim.
 *  - For regex mode, we pass the user's pattern straight to RegExp
 *    and let JS surface a SyntaxError if it's malformed; we catch
 *    that and turn it into a structured error.
 */
function buildReplacer(input: {
  pattern: string
  isRegex: boolean
  caseInsensitive: boolean
  multiline: boolean
}):
  | { ok: true; regex: RegExp }
  | { ok: false; error: string } {
  const flags = `g${input.caseInsensitive ? 'i' : ''}${input.multiline ? 'm' : ''}`
  try {
    const source = input.isRegex
      ? input.pattern
      : escapeRegexLiterals(input.pattern)
    const regex = new RegExp(source, flags)
    return { ok: true, regex }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `invalid regex: ${msg}` }
  }
}

/**
 * Escape the regex metacharacters in `s` so a literal `pattern` is
 * matched verbatim. Mirrors MDN's recommended escape list. We do NOT
 * use a regex with capture groups here because we want the result to
 * pass through `new RegExp(...)` unmodified — only the raw characters
 * are touched.
 */
function escapeRegexLiterals(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Resolve an `expectedFiles` entry to its canonical absolute form so we
 * can compare it against the absolute paths we built from the walker
 * output. Mirrors `applyDiffToFiles`'s own normalisation.
 */
function resolveExpected(path: string, baseCwd: string): string {
  return isAbsolute(path) ? path : resolve(baseCwd, path)
}

/**
 * Pure-library entry point. Exposed so tests can hit the orchestration
 * without going through the Tool's JSON-input/output channel, and so
 * future internal callers (e.g. a slash command) can reuse the logic.
 */
export async function runFindReplace(
  input: FindReplaceInput,
  signal: AbortSignal,
): Promise<FindReplaceResult> {
  const rootDir = input.rootDir ?? process.cwd()
  const dryRun = input.dryRun !== false // default TRUE
  const respectGitignore = input.respectGitignore !== false // default TRUE
  const maxFiles = Math.max(
    1,
    Math.min(
      FIND_REPLACE_HARD_MAX_FILES,
      Math.floor(input.maxFiles ?? FIND_REPLACE_DEFAULT_MAX_FILES),
    ),
  )

  // Compile glob matchers once and reuse for every walker emission. We
  // include the dot-flag so e.g. `**/.env` patterns the caller might
  // pass actually fire — the walker already skips dotfiles by default,
  // and the glob filter shouldn't add a second hidden layer that
  // contradicts what the user asked for.
  const includeMatcher = compileGlob(input.glob, { dot: true })
  const excludeMatchers = (input.excludePaths ?? []).map(p =>
    compileGlob(p, { dot: true }),
  )

  // Build the per-file replacer. If the user opted into regex mode and
  // typed an invalid pattern, surface that as a structured-result error
  // (caller-visible) rather than throwing.
  const replacer = buildReplacer({
    pattern: input.pattern,
    isRegex: input.isRegex === true,
    caseInsensitive: input.caseInsensitive === true,
    multiline: input.multiline === true,
  })
  if (!replacer.ok) {
    return {
      filesScanned: 0,
      filesChanged: 0,
      filesSkipped: 0,
      previews: [],
      dryRun,
      truncated: false,
      aborted: signal.aborted,
      ...(dryRun ? {} : { applied: [] }),
      // The result is structurally clean; the caller-visible error path
      // comes via `run()` returning isError=true. This helper just
      // hands back a no-op shape so the caller can decide.
    } as FindReplaceResult & { error?: never }
  }

  // Walk everything that might match. `walkFiles` respects gitignore
  // when asked, but does NOT pre-filter by glob — we do that ourselves
  // by pulling `shouldInclude` into the walker so we never accumulate
  // a giant relPath list just to throw most of it away.
  //
  // We deliberately load the gitignore predicate *ourselves* and AND it
  // into our `shouldInclude` BEFORE pushing to `candidatePaths`. The
  // walker's own `respectGitignore: true` wrap evaluates our predicate
  // first and AND-s the gitignore predicate after — which would let
  // ignored files slip into our collection (since our predicate has
  // already pushed by the time it returns). Doing the gitignore check
  // ourselves keeps the precedence right.
  let ignorePred: (rel: string) => boolean = () => true
  if (respectGitignore) {
    try {
      ignorePred = await gitignoreFilter(rootDir)
    } catch {
      // No .gitignore — leave the always-true predicate in place.
    }
  }

  const candidatePaths: string[] = []
  let truncated = false
  await walkFiles({
    rootDir,
    // We handle gitignore ourselves above. Walker's own integration
    // would AND it AFTER our predicate, which is too late once we've
    // pushed to candidatePaths.
    respectGitignore: false,
    signal,
    shouldInclude: (rel: string): boolean => {
      // Honour exclude list first — cheaper than running the include
      // matcher when something is excluded.
      for (const ex of excludeMatchers) {
        if (ex.test(rel)) return false
      }
      // Then gitignore (when enabled).
      if (!ignorePred(rel)) return false
      if (!includeMatcher.test(rel)) return false
      // Soft-cap: once we've collected enough, the walker can keep
      // emitting but we drop any further matches. The walker also has
      // a `maxEntries` knob but it counts pre-filter entries, so for a
      // glob-pinned scan we get tighter control here.
      if (candidatePaths.length >= maxFiles) {
        truncated = true
        return false
      }
      candidatePaths.push(rel)
      // Returning false here would prevent the walker from emitting
      // the path, but since we've already pushed it to our list, we
      // can return false to keep the walker's own `out` array small.
      return false
    },
  })

  // If the walk was aborted, `walkFiles` returns whatever it gathered
  // — same for us. Surface the abort flag so the caller can choose to
  // retry / display a partial banner.
  const aborted = signal.aborted

  const previews: FindReplacePreview[] = []
  let filesScanned = 0
  let filesSkipped = 0

  for (const rel of candidatePaths) {
    if (signal.aborted) break
    filesScanned += 1
    const abs = isAbsolute(rel) ? rel : resolve(rootDir, rel)

    let before: string
    try {
      before = await readFile(abs, 'utf8')
    } catch {
      // Per-file read failure (binary file with invalid utf-8, race
      // with deletion, permission denied) is a soft-skip: we count
      // it as skipped and move on. We don't put it in previews,
      // because there's no diff text to show.
      filesSkipped += 1
      continue
    }

    // Reset the regex's `lastIndex` between files — RegExp with the
    // global flag carries state across `replace` calls in some JS
    // engines if the same regex object is reused. Belt-and-braces.
    replacer.regex.lastIndex = 0
    const after = before.replace(replacer.regex, input.replacement)

    if (after === before) {
      // No-op match: file didn't change. Doesn't go in `previews`,
      // but we count it as "skipped" so the caller sees how many
      // files matched the glob without actually changing.
      filesSkipped += 1
      continue
    }

    // `getHunksFromContents` is the structured-hunk version we use to
    // compute additions/deletions without re-parsing the diff text.
    const hunks = getHunksFromContents(before, after, { filename: rel })
    const { additions, deletions } = countLinesChanged(hunks)
    const diff = formatUnifiedDiff(before, after, { filename: rel })
    previews.push({ path: rel, additions, deletions, diff })
  }

  const filesChanged = previews.length

  const result: FindReplaceResult = {
    filesScanned,
    filesChanged,
    filesSkipped,
    previews,
    dryRun,
    truncated,
    aborted,
  }

  if (dryRun) return result

  // Non-dryRun path: enforce the expectedFiles guard, then hand off
  // the assembled diff to `applyDiffToFiles`. We surface per-file
  // outcomes (success / refused / failed) in `applied` so the caller
  // can see which entries actually hit disk.
  const applied: FindReplaceApplyResult[] = []

  const allowList = input.expectedFiles ?? []
  if (allowList.length === 0) {
    // Caller error — we still surface previews so the caller can
    // inspect them, but no file is written. The Tool's `run()` will
    // also flag this as an error (so the agent knows).
    for (const p of previews) {
      applied.push({
        path: p.path,
        success: false,
        error: 'expectedFiles required for non-dryRun write — refusing',
      })
    }
    return { ...result, applied }
  }

  const allowAbsSet = new Set(allowList.map(p => resolveExpected(p, rootDir)))

  // Split previews into "allowed to write" vs "refused".
  const allowedPreviews: FindReplacePreview[] = []
  for (const p of previews) {
    const abs = isAbsolute(p.path) ? p.path : resolve(rootDir, p.path)
    if (allowAbsSet.has(abs)) {
      allowedPreviews.push(p)
    } else {
      applied.push({
        path: p.path,
        success: false,
        error: 'file not in expectedFiles allow-list — refused',
      })
    }
  }

  if (allowedPreviews.length === 0) {
    return { ...result, applied }
  }

  // Compose one big diff and hand it to applyDiffToFiles. The Iter T
  // tool already handles per-file parse + write + abort, and centres
  // its own allow-list check on absolute paths.
  const composedDiff = allowedPreviews.map(p => p.diff).join('')
  let applyPayload: ApplyDiffResultPayload
  try {
    applyPayload = await applyDiffToFiles(
      {
        diff: composedDiff,
        cwd: rootDir,
        dryRun: false,
        // Pass the same allow-list through so applyDiffToFiles will
        // refuse to write anything outside it even if our own split
        // had a bug. Defense in depth.
        expectedFiles: Array.from(allowAbsSet),
      },
      signal,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    for (const p of allowedPreviews) {
      applied.push({ path: p.path, success: false, error: msg })
    }
    return { ...result, applied }
  }

  // Map applyDiffToFiles output (which uses absolute paths once
  // resolved) back onto our preview-relative paths. We keep the
  // canonical relative path the caller saw in `previews`.
  for (const p of allowedPreviews) {
    const abs = isAbsolute(p.path) ? p.path : resolve(rootDir, p.path)
    const okHit = applyPayload.applied.find(a => {
      const aAbs = isAbsolute(a.path) ? a.path : resolve(rootDir, a.path)
      return aAbs === abs
    })
    const failHit = applyPayload.failed.find(f => {
      const fAbs = isAbsolute(f.path) ? f.path : resolve(rootDir, f.path)
      return fAbs === abs
    })
    if (okHit) {
      applied.push({ path: p.path, success: true })
    } else if (failHit) {
      applied.push({ path: p.path, success: false, error: failHit.reason })
    } else {
      // Neither applied nor failed — this happens when the underlying
      // tool aborted before reaching this file. Surface it explicitly.
      applied.push({
        path: p.path,
        success: false,
        error: applyPayload.aborted ? 'aborted before write' : 'no result',
      })
    }
  }

  return { ...result, applied }
}

/**
 * Format the structured result as a compact human-readable summary
 * with a trailing JSON line carrying the full payload (matches the
 * pattern other Nuka tools use — see FileSearchTool / WrapTextTool).
 */
function formatResult(r: FindReplaceResult): string {
  const head = r.dryRun
    ? `FindReplace (dryRun):`
    : `FindReplace:`
  const lines: string[] = [head]
  lines.push(
    `scanned=${r.filesScanned} changed=${r.filesChanged} skipped=${r.filesSkipped}` +
      (r.truncated ? ' truncated=true' : '') +
      (r.aborted ? ' aborted=true' : ''),
  )
  for (const p of r.previews) {
    lines.push(`~ ${p.path}  (+${p.additions}/-${p.deletions})`)
  }
  if (r.applied) {
    for (const a of r.applied) {
      const tag = a.success ? '+ wrote' : '! refused'
      lines.push(`${tag} ${a.path}${a.error ? `: ${a.error}` : ''}`)
    }
  }
  lines.push('')
  lines.push(JSON.stringify(r))
  return lines.join('\n')
}

export const FindReplaceTool: Tool<FindReplaceInput> = defineTool<FindReplaceInput>({
  name: FIND_REPLACE_TOOL_NAME,
  description:
    'Find-and-replace across files matched by a glob, with unified-diff previews. ' +
    'SAFE BY DEFAULT: `dryRun` is true unless explicitly set false, AND non-dryRun ' +
    'writes require an `expectedFiles` allow-list. Supports literal-string OR regex ' +
    'patterns (with `$1` backreferences), case-insensitive and multiline modes. ' +
    'Respects `.gitignore` by default; honours `excludePaths` for extra exclusions. ' +
    'Returns one preview per changed file plus, when writing, a per-file apply outcome.',
  parameters: {
    type: 'object',
    required: ['glob', 'pattern', 'replacement'],
    properties: {
      glob: {
        type: 'string',
        description:
          "File glob (e.g. 'src/**/*.ts'). Files matching this pattern are " +
          'candidates; non-matching files are skipped without being read.',
      },
      rootDir: {
        type: 'string',
        description:
          'Root directory for the walk. Defaults to the tool context cwd / process.cwd().',
      },
      pattern: {
        type: 'string',
        description:
          'String to find. Treated as a literal substring unless `isRegex: true`. ' +
          'Empty string is refused (would no-op or insert replacement at every code-unit).',
      },
      replacement: {
        type: 'string',
        description:
          "Replacement text. When `isRegex: true`, supports `$1`, `$2`, … " +
          "backreferences and `$&` (whole match) per JS RegExp.replace semantics.",
      },
      isRegex: {
        type: 'boolean',
        description: 'Treat `pattern` as a regex source. Default false (literal).',
      },
      caseInsensitive: {
        type: 'boolean',
        description: 'Case-insensitive matching. Default false.',
      },
      multiline: {
        type: 'boolean',
        description:
          'Multiline regex mode — `^` / `$` match line boundaries (not just file boundaries). Default false.',
      },
      dryRun: {
        type: 'boolean',
        description:
          'When true (DEFAULT), no files are written; only previews are returned. ' +
          'Pass `false` AND a non-empty `expectedFiles` to actually write.',
      },
      expectedFiles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'REQUIRED when `dryRun: false`. Allow-list of files (relative or absolute) ' +
          'that may be written. Any matched file outside this list is refused and ' +
          'reported in the result, never written.',
      },
      maxFiles: {
        type: 'number',
        description: `Cap on candidate files scanned. Default ${FIND_REPLACE_DEFAULT_MAX_FILES}, hard max ${FIND_REPLACE_HARD_MAX_FILES}.`,
        minimum: 1,
      },
      respectGitignore: {
        type: 'boolean',
        description: 'Skip files matched by `.gitignore`. Default true.',
      },
      excludePaths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional glob patterns to exclude. Any file matching ANY exclude ' +
          'pattern is skipped before the find-replace runs.',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.read', 'fs.write'],
  needsPermission: (input: FindReplaceInput) =>
    input.dryRun === false ? 'write' : 'none',
  annotations: { readOnly: false, parallelSafe: false },
  searchHint: ['find', 'replace', 'rename', 'substitute', 'sed', 'regex', 'patch'],
  aliases: ['find_replace', 'sed'],
  async run(input: FindReplaceInput, ctx: ToolContext): Promise<ToolResult> {
    if (input == null || typeof input !== 'object') {
      return errorResult(`input must be an object (got ${String(input)}).`)
    }
    if (typeof input.glob !== 'string' || input.glob.length === 0) {
      return errorResult(`'glob' must be a non-empty string.`)
    }
    if (typeof input.pattern !== 'string') {
      return errorResult(`'pattern' must be a string (got ${typeof input.pattern}).`)
    }
    if (input.pattern.length === 0) {
      return errorResult(
        `'pattern' must be non-empty — empty pattern would no-op or insert replacement everywhere.`,
      )
    }
    if (typeof input.replacement !== 'string') {
      return errorResult(
        `'replacement' must be a string (got ${typeof input.replacement}).`,
      )
    }
    if (
      input.maxFiles !== undefined &&
      (typeof input.maxFiles !== 'number' ||
        !Number.isFinite(input.maxFiles) ||
        input.maxFiles < 1)
    ) {
      return errorResult(`'maxFiles' must be a positive number.`)
    }
    if (input.dryRun === false) {
      if (
        !Array.isArray(input.expectedFiles) ||
        input.expectedFiles.length === 0
      ) {
        return errorResult(
          `'expectedFiles' is required and must be non-empty when 'dryRun' is false.`,
        )
      }
    }

    // Validate regex eagerly so we can return a structured error
    // without going through the no-op result branch in runFindReplace.
    if (input.isRegex === true) {
      const probe = buildReplacer({
        pattern: input.pattern,
        isRegex: true,
        caseInsensitive: input.caseInsensitive === true,
        multiline: input.multiline === true,
      })
      if (!probe.ok) return errorResult(probe.error)
    }

    const effectiveCwd = input.rootDir ?? ctx.cwd
    try {
      const payload = await runFindReplace(
        { ...input, rootDir: effectiveCwd },
        ctx.signal,
      )
      const writeAttempted = !payload.dryRun
      const everyApplyFailed =
        writeAttempted &&
        (payload.applied?.length ?? 0) > 0 &&
        payload.applied!.every(a => !a.success)
      return {
        isError: everyApplyFailed,
        output: formatResult(payload),
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return errorResult(`scan failed under '${effectiveCwd}': ${msg}`)
    }
  },
})
