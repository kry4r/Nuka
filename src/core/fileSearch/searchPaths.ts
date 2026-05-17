// src/core/fileSearch/searchPaths.ts
//
// Convenience wrapper: walk a directory + build a FileIndex + run a
// search, in one call. The intermediate FileIndex is discarded.
//
// Use this when:
//   - the consumer is one-shot (slash-command completion, ad-hoc CLI
//     query): pay the walk cost once, take the results, move on;
//   - the directory is small/medium (a few thousand files at most).
//
// DO NOT use this in a hot path that searches the same directory
// repeatedly. For that, build a FileIndex once and call .search() many
// times — see {@link FileIndex.loadFromFileListAsync} for a build
// strategy that doesn't block the main thread.

import { FileIndex, type SearchResult } from './fileIndex.js'
import { walkFiles, type WalkOptions } from './walker.js'

export type SearchPathsOptions = Omit<WalkOptions, 'rootDir'> & {
  /** Absolute root directory to search under. */
  rootDir: string
  /** Query string. Empty string returns top-level entries from the index. */
  query: string
  /** Maximum results to return. Default `20`. */
  maxResults?: number
  /**
   * Optional list of paths (relative to `rootDir`, forward-slash) to
   * promote in the result ranking. The given paths get a free
   * positional boost — they appear ahead of equally-scored entries.
   * Useful for "recently edited / mentioned files".
   *
   * Implementation: we just prepend the matched recents to the front
   * of the result list and dedupe; we don't re-score them. This means
   * a recent file that doesn't fuzzy-match the query still won't
   * appear (recents only nudge ranking, they don't bypass matching).
   */
  recentFiles?: ReadonlyArray<string>
}

/**
 * Walk the given directory, build a fuzzy index, and run a search.
 *
 * Returns up to `maxResults` matches sorted best-first. `score` is
 * position-in-results (lower = better, top match = 0.0) — same
 * semantics as {@link FileIndex.search}.
 */
export async function searchPaths(
  opts: SearchPathsOptions,
): Promise<SearchResult[]> {
  const { query, maxResults = 20, recentFiles, ...walkOpts } = opts

  const paths = await walkFiles(walkOpts)
  const index = new FileIndex()
  index.loadFromFileList(paths)

  const raw = index.search(query, maxResults)

  if (!recentFiles || recentFiles.length === 0 || query.length === 0) {
    return raw
  }

  return promoteRecent(raw, recentFiles, maxResults)
}

/**
 * Walk + build + return the FileIndex for reuse. Cheaper than
 * {@link searchPaths} when you plan to issue many queries against the
 * same tree.
 */
export async function buildIndexFromDir(
  opts: Omit<SearchPathsOptions, 'query' | 'maxResults' | 'recentFiles'>,
): Promise<FileIndex> {
  const paths = await walkFiles(opts)
  const index = new FileIndex()
  index.loadFromFileList(paths)
  return index
}

/**
 * Promote recent files within an existing scored result list. Pure;
 * exported for testing.
 *
 * Behaviour: any result whose path appears in `recentFiles` is
 * extracted, the rest stay in their original order, and the recents
 * are prepended in the order they appear in `recentFiles`. Results
 * not matching the query are NOT injected — recents only nudge the
 * ordering of paths that already passed the fuzzy match.
 */
export function promoteRecent(
  scored: ReadonlyArray<SearchResult>,
  recentFiles: ReadonlyArray<string>,
  maxResults: number,
): SearchResult[] {
  if (recentFiles.length === 0 || scored.length === 0) return [...scored]
  const recentSet = new Set(recentFiles)
  const promoted: SearchResult[] = []
  const rest: SearchResult[] = []
  for (const r of scored) {
    if (recentSet.has(r.path)) promoted.push(r)
    else rest.push(r)
  }
  if (promoted.length === 0) return scored.slice(0, maxResults)

  // Re-order `promoted` to match the order of `recentFiles` (so the
  // caller's notion of "most recent first" is preserved).
  const order = new Map<string, number>()
  recentFiles.forEach((p, i) => order.set(p, i))
  promoted.sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0))

  const merged = [...promoted, ...rest].slice(0, maxResults)
  // Re-stamp scores to reflect the new ordering (lower = better).
  const denom = Math.max(merged.length, 1)
  return merged.map((r, i) => ({ path: r.path, score: i / denom }))
}
