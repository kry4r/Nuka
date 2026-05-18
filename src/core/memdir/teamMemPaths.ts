// src/core/memdir/teamMemPaths.ts
//
// 2026-05-18 — team-memory storage paths + traversal-resistant key
// validation. Mirrors the upstream Nuka-Code shape (paths.ts +
// teamMemPaths.ts) with two deliberate omissions: Nuka has no analytics
// platform (Growthbook is gone), and there is no `isAutoMemoryEnabled`
// gate (auto-memory is always on). Enablement collapses to "does the
// loaded config carry a teamId?".
//
// Disk layout (sibling to the per-cwd memdir):
//   ~/.nuka/memory/<sha1(cwd)>/MEMORY.md          ← project (per-cwd) tier
//   ~/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md  ← team tier
//
// sha1(cwd) is identical between the two tiers on purpose: a given
// project always resolves to the SAME hash, regardless of which team
// is active, so switching teams flips between sibling MEMORY.md files
// without re-resolving the project root.

import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'

/**
 * Error thrown when a path validation detects a traversal or injection attempt.
 *
 * Callers should NOT proceed with disk I/O when this is thrown — the entry
 * point is the only line of defence between user-controlled keys (from
 * future remote-sync or slash-command input) and the filesystem.
 */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

/**
 * sha1 of the cwd, hex-encoded. Same hash used by per-cwd memdir so the
 * two tiers naturally line up on the same project. sha1 is sufficient —
 * we are NOT using it for security; it is purely a stable directory name.
 */
function projectHash(cwd: string): string {
  return crypto.createHash('sha1').update(cwd).digest('hex')
}

/**
 * Sanitize a relative-key string by rejecting dangerous patterns. Throws
 * {@link PathTraversalError} on any attempt to escape the team-memory
 * directory via null bytes, URL-encoding, backslashes, absolute paths,
 * or unicode-normalised separators.
 *
 * Pure / synchronous — fast first-pass rejection before any filesystem
 * touch. Mirrors the upstream sanitizer line-for-line; the test suite in
 * `teamMemPaths.test.ts` exercises each vector.
 */
function sanitizePathKey(key: string): string {
  if (key.includes('\0')) {
    throw new PathTraversalError(`Null byte in path key: "${key}"`)
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(key)
  } catch {
    decoded = key
  }
  if (decoded !== key && (decoded.includes('..') || decoded.includes('/'))) {
    throw new PathTraversalError(`URL-encoded traversal in path key: "${key}"`)
  }
  const normalized = key.normalize('NFKC')
  if (
    normalized !== key &&
    (normalized.includes('..') ||
      normalized.includes('/') ||
      normalized.includes('\\') ||
      normalized.includes('\0'))
  ) {
    throw new PathTraversalError(
      `Unicode-normalized traversal in path key: "${key}"`,
    )
  }
  if (key.includes('\\')) {
    throw new PathTraversalError(`Backslash in path key: "${key}"`)
  }
  if (key.startsWith('/')) {
    throw new PathTraversalError(`Absolute path key: "${key}"`)
  }
  return key
}

/**
 * Validate a teamId for filesystem use. teamIds come from `ConfigSchema`
 * (parsed via zod with `.min(1)`) so we already know it is a non-empty
 * string; this guard exists to catch malicious values supplied through
 * a future remote-config or hot-reload path.
 */
function sanitizeTeamId(teamId: string): string {
  if (teamId.length === 0) {
    throw new PathTraversalError('Empty teamId')
  }
  if (teamId.includes('\0') || teamId.includes('/') || teamId.includes('\\')) {
    throw new PathTraversalError(`Illegal characters in teamId: "${teamId}"`)
  }
  if (teamId === '.' || teamId === '..') {
    throw new PathTraversalError(`Reserved teamId value: "${teamId}"`)
  }
  return teamId
}

/**
 * Lightweight enablement predicate. The configured value is the single
 * source of truth — no env-var override, no feature flag.
 */
export function isTeamMemoryEnabled(config: { teamId?: string }): boolean {
  return typeof config.teamId === 'string' && config.teamId.length > 0
}

/**
 * Resolve `<home>/.nuka/team-memory/<teamId>/<sha1(cwd)>/`. Trailing
 * separator included so prefix-containment checks (`startsWith(teamDir)`)
 * are not foiled by sibling directories that share a name prefix (e.g.
 * `<teamId>-evil` vs `<teamId>`).
 */
export function teamMemoryDir(
  teamId: string,
  cwd: string,
  home: string = os.homedir(),
): string {
  const id = sanitizeTeamId(teamId)
  const hash = projectHash(cwd)
  return path.join(home, '.nuka', 'team-memory', id, hash) + path.sep
}

/**
 * Resolve `<teamMemoryDir>/MEMORY.md`. The single entrypoint file for
 * the team tier — same shape as the project tier's MEMORY.md.
 */
export function teamMemoryPath(
  teamId: string,
  cwd: string,
  home: string = os.homedir(),
): string {
  return path.join(teamMemoryDir(teamId, cwd, home), 'MEMORY.md')
}

type ErrnoLike = { code?: unknown }

function errnoCode(e: unknown): string | undefined {
  if (e !== null && typeof e === 'object' && 'code' in e) {
    const c = (e as ErrnoLike).code
    if (typeof c === 'string') return c
  }
  return undefined
}

/**
 * Walk up the path until `realpath` succeeds, then re-append the
 * non-existing tail. Ensures we compare ACTUAL filesystem locations
 * (post-symlink-resolution) rather than the user-supplied string,
 * which is the only way to detect symlink-based escapes (the target
 * file may not exist yet; we are about to create it).
 *
 * Ported from upstream Nuka-Code with one simplification: no telemetry
 * on intermediate ELOOP / ENAMETOOLONG cases — Nuka has no analytics
 * backend to feed.
 */
async function realpathDeepestExisting(absolutePath: string): Promise<string> {
  const tail: string[] = []
  let current = absolutePath
  for (
    let parent = path.dirname(current);
    current !== parent;
    parent = path.dirname(current)
  ) {
    try {
      const realCurrent = await realpath(current)
      return tail.length === 0
        ? realCurrent
        : path.join(realCurrent, ...tail.reverse())
    } catch (e: unknown) {
      const code = errnoCode(e)
      if (code === 'ENOENT') {
        try {
          const st = await lstat(current)
          if (st.isSymbolicLink()) {
            throw new PathTraversalError(
              `Dangling symlink detected (target does not exist): "${current}"`,
            )
          }
        } catch (lstatErr: unknown) {
          if (lstatErr instanceof PathTraversalError) throw lstatErr
          // truly non-existent — safe to walk up
        }
      } else if (code === 'ELOOP') {
        throw new PathTraversalError(
          `Symlink loop detected in path: "${current}"`,
        )
      } else if (code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') {
        throw new PathTraversalError(
          `Cannot verify path containment (${String(code)}): "${current}"`,
        )
      }
      tail.push(current.slice(parent.length + path.sep.length))
      current = parent
    }
  }
  return absolutePath
}

/**
 * Compare a candidate's symlink-resolved location against the team
 * directory's symlink-resolved location. When the team dir does not
 * exist (e.g. brand-new session, never written), no symlinks can exist
 * inside it either — the string-level prefix check is sufficient and
 * we return true to avoid spurious traversal errors.
 */
async function isRealPathWithinTeamDir(
  realCandidate: string,
  teamDir: string,
): Promise<boolean> {
  let realTeamDir: string
  try {
    realTeamDir = await realpath(teamDir.replace(/[/\\]+$/, ''))
  } catch (e: unknown) {
    const code = errnoCode(e)
    if (code === 'ENOENT' || code === 'ENOTDIR') return true
    return false
  }
  if (realCandidate === realTeamDir) return true
  return realCandidate.startsWith(realTeamDir + path.sep)
}

/**
 * Validate a relative key (from a future remote-sync or slash-command
 * surface) against the team memory directory. Throws
 * {@link PathTraversalError} on any escape attempt; returns the
 * absolute, symlink-resolved-where-existing path on success.
 *
 * NOT used by the static `teamMemoryPath` resolver above — that path is
 * fully internal and never sees user input. This validator exists for
 * future iters (write tools, sync watchers) so the security primitive
 * lands with the rest of the team-memory module.
 */
export async function validateTeamMemKey(
  teamId: string,
  cwd: string,
  relativeKey: string,
  home: string = os.homedir(),
): Promise<string> {
  sanitizePathKey(relativeKey)
  const teamDir = teamMemoryDir(teamId, cwd, home)
  const fullPath = path.join(teamDir, relativeKey)
  const resolvedPath = path.resolve(fullPath)
  if (!resolvedPath.startsWith(teamDir)) {
    throw new PathTraversalError(
      `Key escapes team memory directory: "${relativeKey}"`,
    )
  }
  const realPath = await realpathDeepestExisting(resolvedPath)
  if (!(await isRealPathWithinTeamDir(realPath, teamDir))) {
    throw new PathTraversalError(
      `Key escapes team memory directory via symlink: "${relativeKey}"`,
    )
  }
  return resolvedPath
}
