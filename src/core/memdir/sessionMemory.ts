// src/core/memdir/sessionMemory.ts
//
// Practical-track Iter M — port of upstream Nuka-Code's
// `src/services/SessionMemory/sessionMemoryUtils.ts::getSessionMemoryContent`.
//
// Upstream is a thin filesystem accessor that reads a single `summary.md`
// at a session-scoped path. We generalize slightly to fit Nuka's existing
// memory layout conventions and to satisfy Iter K's `GetSessionMemoryFn`
// alias (`() => Promise<string | null>`):
//
//   - Per-project memory lives under `<nukaHome>/projects/<sha1(cwd)>/memory/MEMORY.md`
//     (mirrors Claude Code's auto-memory layout, just under `.nuka` instead
//      of `.claude`). The sha1 keeps the path stable across runs without
//      having to escape cwd characters.
//   - The returned string is the MEMORY.md body with simple YAML
//     frontmatter (`---\n...\n---\n`) stripped — frontmatter is metadata
//     for editors and is not useful to a model prompt. If frontmatter is
//     malformed we fall back to returning the raw file content (we do not
//     want a corrupted MEMORY.md to crash callers).
//   - `@path/to/file.md` references inside MEMORY.md are walked: the
//     referenced file's body is inlined into the returned string. Cycles
//     are detected and resolved to "[cycle]" placeholders; depth and total
//     file count are capped to bound work. Only files inside the per-project
//     memory directory are followed (no escaping to arbitrary filesystem
//     locations).
//   - Returns null when there's no memory dir, no MEMORY.md, or the file
//     is empty after trimming. Iter K's `awaySummary/summary.ts` treats
//     null as "no memory — fall through with no memory block".
//
// IMPORTANT: this module is not wired into any caller this iter. Future
// iters can pass `getSessionMemoryContent` directly as
// `AwaySummaryDeps.getSessionMemoryContent`.

import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

/** Default cap on link-walk recursion depth. */
const DEFAULT_MAX_DEPTH = 5

/** Default cap on the total number of files inlined into the result. */
const DEFAULT_MAX_FILES = 25

/** Default cap on a single file's read size, in bytes. */
const DEFAULT_MAX_BYTES_PER_FILE = 256 * 1024

/** Per-file cap on the total bytes returned in the assembled output. */
const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024

export type GetSessionMemoryOptions = {
  /** Project working directory. Defaults to `process.cwd()`. */
  cwd?: string
  /** Override `os.homedir()`. Mostly for tests. */
  home?: string
  /** Cap on `@path` recursion depth. Defaults to 5. */
  maxDepth?: number
  /** Cap on total inlined files. Defaults to 25. */
  maxFiles?: number
  /** Cap on per-file read size (bytes). Defaults to 256 KiB. */
  maxBytesPerFile?: number
  /** Cap on total returned bytes. Defaults to 1 MiB. */
  maxTotalBytes?: number
}

/**
 * Resolve the project-id (hashed cwd) for a project's memory directory.
 * Exposed for callers that want to inspect or seed the layout.
 */
export function projectIdForCwd(cwd: string): string {
  return crypto.createHash('sha1').update(cwd).digest('hex')
}

/**
 * Resolve the per-project memory directory:
 *   `<home>/.nuka/projects/<sha1(cwd)>/memory`.
 */
export function sessionMemoryDir(
  cwd: string,
  home: string = os.homedir(),
): string {
  return path.join(home, '.nuka', 'projects', projectIdForCwd(cwd), 'memory')
}

/** Resolve the MEMORY.md path for a given cwd / home. */
export function sessionMemoryFilePath(
  cwd: string,
  home: string = os.homedir(),
): string {
  return path.join(sessionMemoryDir(cwd, home), 'MEMORY.md')
}

/**
 * Strip a simple YAML frontmatter block (`---\n...\n---\n`) from the head
 * of `text`. Malformed frontmatter (unterminated fence) is returned
 * untouched — we never want a corrupted MEMORY.md to crash the caller.
 */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  // Skip the opening fence line.
  const afterOpen = text.slice(3)
  if (!afterOpen.startsWith('\n') && !afterOpen.startsWith('\r\n')) {
    return text
  }
  const eol1 = afterOpen.indexOf('\n')
  // The closing fence must sit on its own line; look for `\n---\n` or
  // `\n---` at EOF.
  const closeRel = afterOpen.indexOf('\n---', eol1)
  if (closeRel < 0) return text // unterminated → leave untouched
  const afterClose = afterOpen.slice(closeRel + 4)
  // Trim the trailing newline (if any) following the closing fence.
  if (afterClose.startsWith('\r\n')) return afterClose.slice(2)
  if (afterClose.startsWith('\n')) return afterClose.slice(1)
  // The closing fence may itself be the last line; legal.
  return afterClose
}

/**
 * Extract `@path/to/file.md` references from `text`. Only references that
 * sit on their own line (with optional leading whitespace) are followed —
 * inline `@mentions` inside prose are ignored. Both relative and absolute
 * paths are returned; the caller normalizes + scopes them.
 */
export function extractMemoryLinks(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*@([^\s].*?)\s*$/.exec(line)
    if (!m) continue
    const ref = m[1]
    if (!ref) continue
    // Skip e-mails / "@username" handles that don't look like paths.
    if (!ref.includes('/') && !ref.endsWith('.md')) continue
    out.push(ref)
  }
  return out
}

/**
 * Read up to `maxBytes` of a file. Returns null on any FS error (missing,
 * permission denied, …). Trimmed of a single trailing newline so inlined
 * bodies don't accumulate blank lines.
 */
async function readBounded(
  filePath: string,
  maxBytes: number,
): Promise<string | null> {
  let handle: FileHandle | undefined
  try {
    handle = await fs.open(filePath, 'r')
    const stat = await handle.stat()
    if (!stat.isFile()) return null
    const size = Math.min(stat.size, maxBytes)
    const buf = Buffer.alloc(size)
    await handle.read(buf, 0, size, 0)
    return buf.toString('utf8').replace(/\r?\n$/, '')
  } catch {
    return null
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

/**
 * Resolve a `@` reference into an absolute path. References are anchored
 * to the parent file's directory when relative, or the project memory dir
 * for absolute paths starting with `/`. The result is constrained to live
 * inside `rootDir` — references that escape are rejected (returns null).
 */
function resolveLink(
  ref: string,
  parentDir: string,
  rootDir: string,
): string | null {
  const target = path.isAbsolute(ref)
    ? ref
    : path.resolve(parentDir, ref)
  const normalizedTarget = path.normalize(target)
  const normalizedRoot = path.normalize(rootDir)
  const withSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep
  if (normalizedTarget === normalizedRoot) return normalizedTarget
  if (!normalizedTarget.startsWith(withSep)) return null
  return normalizedTarget
}

type WalkCtx = {
  rootDir: string
  visited: Set<string>
  maxDepth: number
  maxFiles: number
  filesUsed: number
  maxBytesPerFile: number
  totalBytes: number
  maxTotalBytes: number
}

async function walkFile(
  filePath: string,
  depth: number,
  ctx: WalkCtx,
): Promise<string> {
  if (ctx.visited.has(filePath)) return '[cycle]'
  ctx.visited.add(filePath)
  if (ctx.filesUsed >= ctx.maxFiles) return ''
  ctx.filesUsed += 1
  const raw = await readBounded(filePath, ctx.maxBytesPerFile)
  if (raw === null) return ''
  const body = stripFrontmatter(raw)
  if (depth >= ctx.maxDepth) return body
  const links = extractMemoryLinks(body)
  if (links.length === 0) return body

  const parts: string[] = [body]
  const parentDir = path.dirname(filePath)
  for (const ref of links) {
    if (ctx.filesUsed >= ctx.maxFiles) break
    if (ctx.totalBytes >= ctx.maxTotalBytes) break
    const resolved = resolveLink(ref, parentDir, ctx.rootDir)
    if (!resolved) continue
    const sub = await walkFile(resolved, depth + 1, ctx)
    if (!sub) continue
    const header = `\n\n<!-- @${ref} -->\n`
    parts.push(header + sub)
    ctx.totalBytes += header.length + sub.length
  }
  return parts.join('')
}

/**
 * Read the current session memory for the working directory.
 *
 * Returns null when:
 *   - the per-project memory directory doesn't exist,
 *   - MEMORY.md doesn't exist or isn't a regular file,
 *   - MEMORY.md is empty (after trimming).
 *
 * Returns the assembled markdown string otherwise: MEMORY.md body with
 * frontmatter stripped, plus any `@linked.md` files inlined under
 * `<!-- @link -->` headers. Malformed frontmatter and missing links are
 * tolerated silently — this function should never throw for FS reasons.
 */
export async function getSessionMemoryContent(
  opts: GetSessionMemoryOptions = {},
): Promise<string | null> {
  const cwd = opts.cwd ?? process.cwd()
  const home = opts.home ?? os.homedir()
  const rootDir = sessionMemoryDir(cwd, home)
  const memoryFile = sessionMemoryFilePath(cwd, home)

  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytesPerFile = opts.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES

  // Early-exit on missing dir/file to skip the walker entirely.
  try {
    const stat = await fs.stat(memoryFile)
    if (!stat.isFile()) return null
  } catch {
    return null
  }

  const ctx: WalkCtx = {
    rootDir,
    visited: new Set<string>(),
    maxDepth,
    maxFiles,
    filesUsed: 0,
    maxBytesPerFile,
    totalBytes: 0,
    maxTotalBytes,
  }
  const assembled = await walkFile(memoryFile, 0, ctx)
  const trimmed = assembled.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > maxTotalBytes) return trimmed.slice(0, maxTotalBytes)
  return trimmed
}
