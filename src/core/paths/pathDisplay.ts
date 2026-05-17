// src/core/paths/pathDisplay.ts
//
// Compact, human-readable filesystem path formatting. Pure logic — no
// React/ink, no LLM, no filesystem reads. Only `node:os.homedir()` for
// the default home directory and `node:path` for separator handling.
//
// Ported (and generalised) from Nuka-Code's `utils/file.ts::getDisplayPath`
// and `utils/path.ts::toRelativePath`, which were ad-hoc helpers coupled
// to a global `getCwd()`. The version here:
//
//   * takes `cwd` / `home` as explicit options (testable, deterministic),
//   * exposes the three primitives (`tildify`, `truncatePathMiddle`,
//     `relativizeForDisplay`) plus a combined `displayPath`,
//   * is cross-platform: posix `/` and win32 `\` separators are both
//     accepted on input; output uses the platform-native separator when
//     joining/normalising, but tildify preserves the input's `/` vs `\`
//     style so it round-trips cleanly with `unhomedir`.
//
// Consumers in Nuka can adopt this incrementally. Existing ad-hoc helpers
// (e.g. in tool UI renderers) are intentionally not touched — the goal of
// this port is to provide a shared, tested utility for new call-sites and
// future migrations.
//
// IMPORTANT: every public function operates on path STRINGS only. No
// `fs.stat`, no symlink resolution, no existence check. Garbage in, the
// formatter still returns a sensible string out.

import { homedir } from 'node:os'
import * as nodePath from 'node:path'

/** Common options shared by several helpers. */
export interface HomeOption {
  /**
   * Override the home directory. Defaults to `os.homedir()`. Useful in
   * tests to avoid touching the real environment.
   */
  home?: string
}

/** Options for {@link tildify}. */
export interface TildifyOptions extends HomeOption {}

/** Options for {@link unhomedir}. */
export interface UnhomedirOptions extends HomeOption {}

/** Options for {@link truncatePathMiddle}. */
export interface TruncatePathMiddleOptions {
  /**
   * Replacement string inserted where directory segments were elided.
   * Defaults to `...`.
   */
  ellipsis?: string
}

/** Options for {@link relativizeForDisplay}. */
export interface RelativizeForDisplayOptions extends HomeOption {
  /**
   * When true (default), prefer the relative path if the target is
   * inside `cwd`.
   */
  preferRelativeWhenWithin?: boolean
  /**
   * Maximum number of `..` segments to tolerate in a relative path
   * before falling back to the absolute (tildified) form. `0` means
   * "only return relative if inside cwd". Defaults to `0`.
   */
  maxRelativeUp?: number
}

/** Options for {@link displayPath}. */
export interface DisplayPathOptions extends HomeOption {
  /**
   * Working directory used to compute a relative path. When omitted,
   * no relativisation is performed (only tildify + truncate).
   */
  cwd?: string
  /**
   * Maximum total length (in code units) of the returned display
   * string. When omitted, no truncation is applied. Must be ≥ 1.
   */
  maxLen?: number
  /** Override the truncate ellipsis (default `...`). */
  ellipsis?: string
  /** See {@link RelativizeForDisplayOptions.maxRelativeUp}. */
  maxRelativeUp?: number
  /** See {@link RelativizeForDisplayOptions.preferRelativeWhenWithin}. */
  preferRelativeWhenWithin?: boolean
}

/** Result of {@link splitPath}. */
export interface SplitPathResult {
  /** Directory portion (everything up to the final separator). */
  dir: string
  /** Filename with extension. */
  base: string
  /** Extension including the leading dot, or `''` if none. */
  ext: string
}

const POSIX_SEP = '/'
const WIN32_SEP = '\\'

/**
 * Choose a separator. If the input contains backslashes but no forward
 * slashes, treat it as win32; otherwise use posix `/`. This is a string
 * heuristic — it does NOT switch behaviour based on the host OS.
 */
function detectSep(input: string): '/' | '\\' {
  if (!input) return POSIX_SEP
  const hasBack = input.includes(WIN32_SEP)
  const hasFwd = input.includes(POSIX_SEP)
  if (hasBack && !hasFwd) return WIN32_SEP
  return POSIX_SEP
}

/**
 * Replace a leading `$HOME` prefix with `~`. If `absPath` is not inside
 * `home`, returns `absPath` unchanged. If `absPath` is exactly `home`,
 * returns `~`.
 *
 * The separator after `~` matches the separator already present in the
 * input — so a Windows path `C:\\Users\\me\\foo` tildifies (when `home`
 * is `C:\\Users\\me`) to `~\\foo`, and a posix path
 * `/Users/me/foo` becomes `~/foo`.
 *
 * Relative paths are returned unchanged.
 */
export function tildify(absPath: string, opts: TildifyOptions = {}): string {
  if (absPath === '') return ''
  const home = opts.home ?? homedir()
  if (!home) return absPath

  // Relative paths: nothing to do.
  if (!isAbsolutePath(absPath)) return absPath

  if (absPath === home) return '~'

  const sep = detectSep(absPath)
  // Match either the input's separator or the OS-platform separator on
  // the boundary. This handles the case where `home` came from
  // `os.homedir()` (native) but the path was passed in with the other
  // separator.
  for (const candidateSep of [sep, WIN32_SEP, POSIX_SEP]) {
    const prefix = home + candidateSep
    if (absPath.startsWith(prefix)) {
      return '~' + candidateSep + absPath.slice(prefix.length)
    }
  }
  // Home might itself end in a separator (rare, but `/` on Linux when
  // user is root). Handle that explicitly.
  if (home.endsWith(POSIX_SEP) || home.endsWith(WIN32_SEP)) {
    if (absPath.startsWith(home)) {
      return '~' + absPath.slice(home.length - 1)
    }
  }
  return absPath
}

/**
 * Inverse of {@link tildify}: replace a leading `~` (followed by a
 * separator, or alone) with `home`. Paths that don't start with `~` are
 * returned unchanged.
 */
export function unhomedir(
  displayed: string,
  opts: UnhomedirOptions = {},
): string {
  if (displayed === '') return ''
  const home = opts.home ?? homedir()
  if (!home) return displayed

  if (displayed === '~') return home
  if (displayed.startsWith('~' + POSIX_SEP)) {
    return home + displayed.slice(1)
  }
  if (displayed.startsWith('~' + WIN32_SEP)) {
    return home + displayed.slice(1)
  }
  return displayed
}

/**
 * Decide whether a string looks like an absolute path. Recognises:
 *   * Posix absolute `/foo`
 *   * Windows drive absolute `C:\\foo` or `C:/foo` (any single letter)
 *   * UNC `\\\\server\\share` or `//server/share`
 */
function isAbsolutePath(p: string): boolean {
  if (!p) return false
  if (p.startsWith(POSIX_SEP)) return true
  // Windows drive letter: `C:\` or `C:/`
  if (
    p.length >= 3 &&
    /^[a-zA-Z]:[\\/]/.test(p.slice(0, 3))
  ) {
    return true
  }
  // UNC: `\\server` or `//server` (the second case is already caught
  // by the posix check above, so only handle backslash here).
  if (p.startsWith(WIN32_SEP + WIN32_SEP)) return true
  return false
}

/**
 * Middle-truncate a path so the filename (last segment) is preserved
 * and earlier directory segments are collapsed into an ellipsis when
 * needed.
 *
 * Strategy:
 *   1. If `path.length <= maxLen`, return unchanged.
 *   2. Split into directory segments + filename. If the filename
 *      alone is already longer than the budget, middle-truncate the
 *      filename itself (preserving the extension when possible).
 *   3. Otherwise: keep the filename, keep as many leading directory
 *      segments as fit (preferring the first segment so the user can
 *      orient — `~/foo/.../bar.ts` is more useful than `.../foo/bar.ts`
 *      when both fit equally well), and insert the ellipsis between.
 *
 * Works on either posix or win32 style input. Output uses the same
 * separator as the input.
 */
export function truncatePathMiddle(
  inputPath: string,
  maxLen: number,
  opts: TruncatePathMiddleOptions = {},
): string {
  if (maxLen < 1) {
    throw new RangeError(`maxLen must be ≥ 1, got ${maxLen}`)
  }
  if (inputPath === '') return ''
  if (inputPath.length <= maxLen) return inputPath

  const ellipsis = opts.ellipsis ?? '...'
  const sep = detectSep(inputPath)

  // Split on whichever separator the path uses. Keep an optional
  // leading separator / drive prefix as the first segment so we don't
  // accidentally drop it.
  const { prefix, segments } = splitWithPrefix(inputPath, sep)

  if (segments.length === 0) {
    // Just a prefix — nothing to truncate around. Hard-cut.
    return hardCut(inputPath, maxLen)
  }

  const filename = segments[segments.length - 1] as string
  const dirs = segments.slice(0, -1)

  // Case 2: filename alone doesn't fit.
  if (filename.length >= maxLen) {
    return truncateFilename(filename, maxLen, ellipsis)
  }

  // Case 3: figure out how many leading dir segments we can keep.
  // We always include the prefix + ellipsis + sep + filename, and then
  // fill in leading dirs greedily.
  const fixedTail = sep + filename
  const minLayout = prefix + ellipsis + fixedTail
  if (minLayout.length > maxLen) {
    // Even the minimum doesn't fit. Drop the prefix to try again.
    const noPrefix = ellipsis + fixedTail
    if (noPrefix.length > maxLen) {
      // Give up and middle-truncate the whole string as a fallback.
      return hardCut(inputPath, maxLen)
    }
    return noPrefix
  }

  // Try to fit as many leading dirs as possible, starting from the
  // beginning (preserving orientation).
  let kept = ''
  for (let i = 0; i < dirs.length; i++) {
    const candidate = kept + dirs[i] + sep
    if (
      (prefix + candidate + ellipsis + fixedTail).length > maxLen
    ) {
      break
    }
    kept = candidate
  }

  // If we managed to keep every directory, just return the original
  // path — there's nothing to elide. (This happens when individual
  // segments are short but the joined length exceeded `maxLen` only by
  // the ellipsis-equivalent. Rare but possible.)
  if (kept.length === dirs.join(sep).length + sep.length) {
    return inputPath
  }

  return prefix + kept + ellipsis + fixedTail
}

/**
 * Split a path into an optional prefix (leading slash, drive, UNC root)
 * and an array of non-empty segments.
 */
function splitWithPrefix(
  p: string,
  sep: '/' | '\\',
): { prefix: string; segments: string[] } {
  let prefix = ''
  let rest = p

  // UNC `\\server\share\...` or `//server/share/...`
  const uncMatch = /^([/\\]{2}[^/\\]+[/\\][^/\\]+)([/\\]?)/.exec(p)
  if (uncMatch && uncMatch[1] !== undefined) {
    prefix = uncMatch[1] + sep
    rest = p.slice(uncMatch[0].length)
  } else if (/^[a-zA-Z]:[\\/]/.test(p)) {
    // Windows drive: `C:\` or `C:/`
    prefix = p.slice(0, 3)
    rest = p.slice(3)
  } else if (p.startsWith(POSIX_SEP) || p.startsWith(WIN32_SEP)) {
    prefix = p[0] as string
    rest = p.slice(1)
  }

  const segments = rest.split(/[\\/]/).filter(s => s.length > 0)
  return { prefix, segments }
}

/**
 * Middle-truncate a bare filename, keeping the extension intact when
 * possible.
 */
function truncateFilename(
  filename: string,
  maxLen: number,
  ellipsis: string,
): string {
  if (filename.length <= maxLen) return filename
  if (maxLen <= ellipsis.length) {
    return ellipsis.slice(0, maxLen)
  }

  // Look for an extension (last `.` not at position 0).
  const dotIdx = filename.lastIndexOf('.')
  const ext = dotIdx > 0 ? filename.slice(dotIdx) : ''
  const stem = ext ? filename.slice(0, dotIdx) : filename

  const remaining = maxLen - ellipsis.length - ext.length
  if (remaining <= 0) {
    // Extension alone fills the budget; degrade to head-only cut.
    return hardCut(filename, maxLen)
  }
  const headLen = Math.ceil(remaining / 2)
  const tailLen = Math.floor(remaining / 2)
  return (
    stem.slice(0, headLen) +
    ellipsis +
    stem.slice(stem.length - tailLen) +
    ext
  )
}

/** Hard slice from the head with an ellipsis on the tail, never longer than maxLen. */
function hardCut(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const ellipsis = '...'
  if (maxLen <= ellipsis.length) return text.slice(0, maxLen)
  return text.slice(0, maxLen - ellipsis.length) + ellipsis
}

/**
 * Return a display-friendly relative path when the target is inside (or
 * close to) `cwd`. Otherwise return the absolute path, tildified.
 *
 * Algorithm:
 *   1. Compute `rel = path.relative(cwd, target)` using the input's
 *      separator style.
 *   2. If `rel === ''`, return `'.'` (the cwd itself).
 *   3. If `rel` doesn't start with `..`, return it (target is inside cwd).
 *   4. Count the number of leading `..` segments:
 *        * If ≤ `maxRelativeUp`, return `rel` as-is.
 *        * Else fall through.
 *   5. Return `tildify(target)`.
 *
 * Notes:
 *   * `target` and `cwd` are both interpreted as already-absolute
 *     paths. Relative `target` is returned unchanged.
 *   * The function never touches the filesystem; symlinks are not
 *     resolved.
 */
export function relativizeForDisplay(
  target: string,
  cwd: string,
  opts: RelativizeForDisplayOptions = {},
): string {
  if (target === '') return ''
  const {
    preferRelativeWhenWithin = true,
    maxRelativeUp = 0,
  } = opts

  if (!isAbsolutePath(target)) return target
  if (!isAbsolutePath(cwd)) {
    // Can't relativise against a non-absolute cwd; fall back to tildify.
    return tildify(target, { home: opts.home })
  }

  const sep = detectSep(target)
  const pathApi = sep === WIN32_SEP ? nodePath.win32 : nodePath.posix

  let rel: string
  try {
    rel = pathApi.relative(cwd, target)
  } catch {
    return tildify(target, { home: opts.home })
  }

  if (rel === '') return '.'
  if (!rel.startsWith('..')) {
    return preferRelativeWhenWithin ? rel : tildify(target, { home: opts.home })
  }

  // Count leading `..` segments.
  const parts = rel.split(/[\\/]/)
  let upCount = 0
  for (const part of parts) {
    if (part === '..') upCount += 1
    else break
  }

  if (upCount <= maxRelativeUp) return rel
  return tildify(target, { home: opts.home })
}

/**
 * Combined formatter: relativise (if `cwd` given), tildify, then
 * truncate. Returns the same display string callers would otherwise
 * assemble by hand.
 *
 * Order matters:
 *   1. Relativise first — a relative path is almost always the
 *      shortest, most useful form.
 *   2. If still absolute, tildify.
 *   3. Truncate to `maxLen` only if set.
 */
export function displayPath(
  inputPath: string,
  opts: DisplayPathOptions = {},
): string {
  if (inputPath === '') return ''

  const {
    cwd,
    home,
    maxLen,
    ellipsis,
    maxRelativeUp = 0,
    preferRelativeWhenWithin = true,
  } = opts

  let out: string
  if (cwd !== undefined && isAbsolutePath(inputPath) && isAbsolutePath(cwd)) {
    out = relativizeForDisplay(inputPath, cwd, {
      home,
      maxRelativeUp,
      preferRelativeWhenWithin,
    })
  } else {
    out = tildify(inputPath, { home })
  }

  if (maxLen !== undefined) {
    if (maxLen < 1) {
      throw new RangeError(`maxLen must be ≥ 1, got ${maxLen}`)
    }
    out = truncatePathMiddle(out, maxLen, ellipsis ? { ellipsis } : {})
  }
  return out
}

/**
 * Split a path string into directory / basename / extension. Operates
 * purely on the string; no filesystem access. Cross-platform: detects
 * the separator from the input.
 *
 * For a path like `/a/b/c.ts`, returns `{ dir: '/a/b', base: 'c.ts',
 * ext: '.ts' }`. A trailing separator on the input is preserved on
 * `dir`. Empty input returns three empty strings.
 */
export function splitPath(inputPath: string): SplitPathResult {
  if (inputPath === '') return { dir: '', base: '', ext: '' }
  const sep = detectSep(inputPath)
  const pathApi = sep === WIN32_SEP ? nodePath.win32 : nodePath.posix
  const dir = pathApi.dirname(inputPath)
  const base = pathApi.basename(inputPath)
  const ext = pathApi.extname(inputPath)
  return { dir, base, ext }
}
