// src/core/diff/applyDiffTool.ts
//
// ApplyDiff — agent-facing tool that takes a unified-diff string and
// applies it to files on disk. Builds on the pure `applyUnifiedDiff`
// and `parseUnifiedDiff` helpers in this module; the Tool wrapper adds
// filesystem I/O, multi-file orchestration, dry-run preview, and an
// allow-list guard.
//
// Differences from upstream Nuka-Code:
//
//   1. Upstream exposes a `FileEditTool` that takes a `{path, old_string,
//      new_string}` triple — structured edit, not a diff. We're porting
//      the simpler "give me a unified diff, I'll apply it" variant
//      because Nuka already has the `applyUnifiedDiff` core, and this
//      shape composes well with the `formatUnifiedDiff` helper that
//      callers can use to generate diffs from before/after pairs.
//
//   2. Path resolution: diff headers conventionally use `a/<path>` and
//      `b/<path>` prefixes (git format). We strip these before resolving
//      against `cwd` (or `process.cwd()` if `cwd` was omitted). Raw paths
//      without prefixes also work.
//
//   3. Add / delete handling: a hunk whose old side is `/dev/null` is
//      treated as a file creation (the file must not already exist —
//      mirrors `git apply --check` semantics). Conversely, `/dev/null`
//      on the new side is a deletion (file is unlinked after the diff
//      validates against current contents).
//
//   4. `expectedFiles` allow-list: when present, the tool refuses to
//      touch any file outside the list and returns an `isError` result
//      WITHOUT writing anything. This is the "guardrail" lever the
//      caller uses when it already knows which files a diff should touch
//      and wants to fail loudly if the diff strays.
//
//   5. AbortSignal: checked at the top of each per-file iteration. When
//      the signal aborts mid-loop we stop processing but still return
//      partial results so the caller can see which files made it.
//
//   6. Atomicity: NOT a database transaction — there is no rollback on
//      partial failure. We do, however, refuse to write any file until
//      every file has parsed successfully and the allow-list check has
//      passed; this catches the most common "bad diff" case before
//      anything hits disk. If a per-file write fails partway through a
//      multi-file diff, prior successful writes stay applied — we report
//      both the wins and the loss in the result.
//
// Side-effects: filesystem reads + writes + unlinks (production runs),
// none in dryRun mode.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import { applyUnifiedDiff } from './apply'
import { parseUnifiedDiff, type ParsedDiffFile } from './parse'

// Re-exported from a dedicated constant module so that the
// permission-hook (and any future name-only consumer) can import the
// canonical name WITHOUT pulling the entire tool implementation into
// the main bundle (Phase P2 #12).
import { APPLY_DIFF_TOOL_NAME } from './applyDiffName'
export { APPLY_DIFF_TOOL_NAME }

export type ApplyDiffInput = {
  diff: string
  cwd?: string
  dryRun?: boolean
  expectedFiles?: string[]
}

export type AppliedFile = {
  path: string
  operation: 'modify' | 'create' | 'delete'
  /** Number of bytes in the new contents (0 for delete operations). */
  bytes: number
  /** Present when `dryRun` was true — the would-be new contents (omitted for deletes). */
  preview?: string
}

export type FailedFile = {
  path: string
  reason: string
}

export type ApplyDiffResultPayload = {
  applied: AppliedFile[]
  failed: FailedFile[]
  dryRun: boolean
  aborted: boolean
}

/**
 * Strip the conventional `a/` or `b/` prefix that unified-diff headers
 * carry. Falls through unchanged if neither prefix is present.
 */
function stripDiffPathPrefix(path: string): string {
  if (path.startsWith('a/')) return path.slice(2)
  if (path.startsWith('b/')) return path.slice(2)
  return path
}

/**
 * Classify a parsed diff file as add / delete / modify based on its
 * `/dev/null` markers. Mirrors `git apply` semantics.
 */
function classifyOperation(
  file: ParsedDiffFile,
): 'modify' | 'create' | 'delete' {
  const oldIsNull = file.oldFileName === '/dev/null'
  const newIsNull = file.newFileName === '/dev/null'
  if (oldIsNull && !newIsNull) return 'create'
  if (newIsNull && !oldIsNull) return 'delete'
  return 'modify'
}

/**
 * Pick the canonical filesystem path for a parsed diff file. For a
 * create operation the new path is the source of truth; for a delete
 * the old path is; for a modify either works (we use the new path so
 * a rename diff resolves to the new location).
 */
function pickPath(file: ParsedDiffFile): string {
  const op = classifyOperation(file)
  const raw = op === 'delete' ? file.oldFileName : file.newFileName
  return stripDiffPathPrefix(raw)
}

/**
 * Resolve a diff path against the tool's effective `cwd`. Absolute
 * paths are passed through unchanged so the model can target files
 * outside the workspace if it has permission.
 */
function resolveAgainstCwd(path: string, baseCwd: string): string {
  return isAbsolute(path) ? path : resolve(baseCwd, path)
}

/**
 * Reconstruct a single-file unified-diff string for one parsed file.
 * `applyUnifiedDiff` expects a unified-diff text, not pre-parsed hunks,
 * so when the caller bundles multiple files in one diff we have to
 * re-serialise each file's hunks individually before applying. The
 * shape produced here matches what `parsePatch` would emit byte-for-byte
 * for a single-file diff.
 */
function reserialiseSingleFile(file: ParsedDiffFile): string {
  const oldHdr = file.oldHeader ? `\t${file.oldHeader}` : ''
  const newHdr = file.newHeader ? `\t${file.newHeader}` : ''
  const lines: string[] = []
  lines.push(`--- ${file.oldFileName}${oldHdr}`)
  lines.push(`+++ ${file.newFileName}${newHdr}`)
  for (const h of file.hunks) {
    lines.push(
      `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    )
    for (const line of h.lines) lines.push(line)
  }
  return lines.join('\n') + '\n'
}

/**
 * Pure-library entry point. Used by the Tool wrapper, exposed for
 * direct callers that don't want to go through the agent surface.
 */
export async function applyDiffToFiles(
  input: ApplyDiffInput,
  signal?: AbortSignal,
): Promise<ApplyDiffResultPayload> {
  const baseCwd = input.cwd ?? process.cwd()
  const dryRun = input.dryRun === true
  const parsed = parseUnifiedDiff(input.diff)

  const applied: AppliedFile[] = []
  const failed: FailedFile[] = []

  // `parsePatch` is permissive — given totally unstructured input it can
  // produce a synthetic entry with undefined filenames and no hunks. Treat
  // any file that lacks BOTH parseable names AND hunks as "no real diff
  // here" so the tool reports an empty-diff failure instead of crashing
  // on a downstream `undefined.startsWith` against the filename.
  const realFiles = parsed.files.filter(
    f =>
      typeof f.oldFileName === 'string' &&
      typeof f.newFileName === 'string' &&
      f.hunks.length > 0,
  )

  if (realFiles.length === 0) {
    failed.push({ path: '(diff)', reason: 'empty or unparseable diff' })
    return { applied, failed, dryRun, aborted: false }
  }

  // Resolve the touched-paths list up front so we can apply the
  // expectedFiles guard before any read/write happens.
  const plans = realFiles.map(f => {
    const relPath = pickPath(f)
    const absPath = resolveAgainstCwd(relPath, baseCwd)
    return {
      file: f,
      operation: classifyOperation(f),
      relPath,
      absPath,
    }
  })

  if (input.expectedFiles && input.expectedFiles.length > 0) {
    // Normalise the allow-list to absolute paths so comparison is
    // unambiguous regardless of how the caller phrased the entries.
    const allowSet = new Set(
      input.expectedFiles.map(p => resolveAgainstCwd(p, baseCwd)),
    )
    const stray = plans.filter(p => !allowSet.has(p.absPath))
    if (stray.length > 0) {
      for (const p of stray) {
        failed.push({
          path: p.relPath,
          reason:
            'diff touches file not in expectedFiles allow-list — refusing to write any file',
        })
      }
      return { applied, failed, dryRun, aborted: false }
    }
  }

  let aborted = false
  for (const plan of plans) {
    if (signal?.aborted) {
      aborted = true
      break
    }

    const { file, operation, relPath, absPath } = plan

    if (operation === 'create') {
      // For a create, the file must not already exist (or it must be
      // empty — match git apply --check, which tolerates an empty
      // existing file as a degenerate add). We check existence by
      // attempting a read; ENOENT is the happy path.
      let existing: string | null = null
      try {
        existing = await readFile(absPath, 'utf8')
      } catch (err) {
        const e = err as NodeJS.ErrnoException
        if (e.code !== 'ENOENT') {
          failed.push({ path: relPath, reason: e.message })
          continue
        }
      }
      if (existing !== null && existing.length > 0) {
        failed.push({
          path: relPath,
          reason: 'create-file diff but target already exists with content',
        })
        continue
      }

      // The new content is just the `+`-prefixed lines from the
      // (single, /dev/null-origin) hunk. We synthesise it directly
      // rather than going through applyUnifiedDiff — `applyPatch`
      // against an empty string for a `/dev/null` source can refuse,
      // depending on JsDiff version.
      const additionLines: string[] = []
      for (const h of file.hunks) {
        for (const ln of h.lines) {
          if (ln.startsWith('+')) additionLines.push(ln.slice(1))
        }
      }
      const newContent =
        additionLines.length > 0 ? additionLines.join('\n') + '\n' : ''

      if (!dryRun) {
        try {
          await mkdir(dirname(absPath), { recursive: true })
          await writeFile(absPath, newContent, 'utf8')
        } catch (err) {
          failed.push({ path: relPath, reason: (err as Error).message })
          continue
        }
      }
      applied.push({
        path: relPath,
        operation: 'create',
        bytes: Buffer.byteLength(newContent, 'utf8'),
        ...(dryRun ? { preview: newContent } : {}),
      })
      continue
    }

    if (operation === 'delete') {
      // For a delete, the file must exist with content that matches
      // the diff's `-`-prefixed lines (in order). We don't bother
      // calling applyUnifiedDiff — applying a `→ /dev/null` patch
      // to JsDiff also has version-dependent quirks. Instead we
      // verify the file's current contents match what the diff
      // expects and then unlink.
      let existing: string
      try {
        existing = await readFile(absPath, 'utf8')
      } catch (err) {
        const e = err as NodeJS.ErrnoException
        failed.push({
          path: relPath,
          reason:
            e.code === 'ENOENT'
              ? 'delete-file diff but target does not exist'
              : e.message,
        })
        continue
      }

      const expectedLines: string[] = []
      for (const h of file.hunks) {
        for (const ln of h.lines) {
          if (ln.startsWith('-')) expectedLines.push(ln.slice(1))
        }
      }
      const expectedContent =
        expectedLines.length > 0 ? expectedLines.join('\n') + '\n' : ''
      // Compare ignoring an optional trailing newline — many editors
      // (and `diff` itself) elide the final newline in the diff text.
      const normalize = (s: string): string =>
        s.endsWith('\n') ? s : s + '\n'
      if (normalize(existing) !== normalize(expectedContent)) {
        failed.push({
          path: relPath,
          reason: 'delete-file diff content does not match current contents',
        })
        continue
      }
      if (!dryRun) {
        try {
          await rm(absPath)
        } catch (err) {
          failed.push({ path: relPath, reason: (err as Error).message })
          continue
        }
      }
      applied.push({
        path: relPath,
        operation: 'delete',
        bytes: 0,
      })
      continue
    }

    // operation === 'modify'
    let before: string
    try {
      before = await readFile(absPath, 'utf8')
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      failed.push({
        path: relPath,
        reason:
          e.code === 'ENOENT'
            ? 'target file does not exist (use a /dev/null source for a create-file diff)'
            : e.message,
      })
      continue
    }

    const singleDiff = reserialiseSingleFile(file)
    const result = applyUnifiedDiff(before, singleDiff)
    if (!result.success) {
      failed.push({ path: relPath, reason: result.error })
      continue
    }

    if (!dryRun) {
      try {
        await writeFile(absPath, result.result, 'utf8')
      } catch (err) {
        failed.push({ path: relPath, reason: (err as Error).message })
        continue
      }
    }
    applied.push({
      path: relPath,
      operation: 'modify',
      bytes: Buffer.byteLength(result.result, 'utf8'),
      ...(dryRun ? { preview: result.result } : {}),
    })
  }

  return { applied, failed, dryRun, aborted }
}

function summarise(payload: ApplyDiffResultPayload): string {
  const parts: string[] = []
  parts.push(payload.dryRun ? 'ApplyDiff (dryRun):' : 'ApplyDiff:')
  parts.push(`applied=${payload.applied.length}`)
  parts.push(`failed=${payload.failed.length}`)
  if (payload.aborted) parts.push('aborted=true')
  const opCounts = { modify: 0, create: 0, delete: 0 }
  for (const a of payload.applied) opCounts[a.operation] += 1
  if (opCounts.modify > 0) parts.push(`modify=${opCounts.modify}`)
  if (opCounts.create > 0) parts.push(`create=${opCounts.create}`)
  if (opCounts.delete > 0) parts.push(`delete=${opCounts.delete}`)
  for (const a of payload.applied) parts.push(`+ ${a.operation} ${a.path}`)
  for (const f of payload.failed) parts.push(`! ${f.path}: ${f.reason}`)
  return parts.join('\n')
}

export const ApplyDiffTool: Tool<ApplyDiffInput> = defineTool<ApplyDiffInput>({
  name: APPLY_DIFF_TOOL_NAME,
  description:
    'Apply a unified-diff text to files on disk. Supports multi-file diffs, file creation (`/dev/null` source) and deletion (`/dev/null` destination). ' +
    'Use `dryRun: true` to preview the result without writing. Use `expectedFiles` to fail fast if the diff touches anything outside an allow-list. ' +
    'Prefer this over Edit/Write when you have a unified-diff in hand (e.g. from `git diff` or from your own before/after formatting).',
  parameters: {
    type: 'object',
    required: ['diff'],
    properties: {
      diff: {
        type: 'string',
        description: 'Unified-diff text. May span multiple files.',
      },
      cwd: {
        type: 'string',
        description:
          'Optional base directory for resolving relative paths in the diff. Defaults to process.cwd().',
      },
      dryRun: {
        type: 'boolean',
        description:
          'If true, do not write any files; the result includes a `preview` of each would-be new content.',
      },
      expectedFiles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional allow-list. When provided, the tool refuses to touch any file outside this list and writes nothing.',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.write'],
  needsPermission: input => (input.dryRun ? 'none' : 'write'),
  annotations: { readOnly: false, parallelSafe: false },
  searchHint: ['diff', 'patch', 'apply', 'unified', 'hunk'],
  async run(input: ApplyDiffInput, ctx: ToolContext): Promise<ToolResult> {
    if (typeof input.diff !== 'string' || input.diff.length === 0) {
      return {
        isError: true,
        output: 'ApplyDiff: `diff` must be a non-empty string',
      }
    }
    const effectiveCwd = input.cwd ?? ctx.cwd
    const payload = await applyDiffToFiles(
      { ...input, cwd: effectiveCwd },
      ctx.signal,
    )
    const isError = payload.failed.length > 0 && payload.applied.length === 0
    return {
      isError,
      output: summarise(payload),
    }
  },
})
