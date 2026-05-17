// src/core/fileSearch/fileIndex.ts
//
// FileIndex — high-performance fuzzy path search.
//
// Ported from Nuka-Code's `src/native-ts/file-index/index.ts`, which is
// itself a pure-TypeScript port of the Rust `nucleo`-based file-index
// crate. The scoring shape mirrors fzf-v2 / nucleo: per-char match,
// boundary / camelCase / consecutive bonuses, gap penalties. Higher
// fuzzScore is better internally; the final exposed `score` is
// position-in-results / result-count (lower = better), so the top match
// is always 0.0 and the bottom approaches 1.0.
//
// Key performance tricks ported intact:
//
//   - a–z presence bitmap on each path → O(1) rejection of paths
//     missing any needle letter (~10% free win on broad queries, 90%+
//     on rare letters);
//   - top-k array sorted ascending → avoids O(n log n) sort when we
//     only need `limit` matches;
//   - gap-bound reject: if best-case boundary score minus known gap
//     penalty can't beat the current threshold, skip the boundary pass;
//   - fused indexOf scan: positions + gap/consec accumulation in one
//     loop (the greedy-earliest positions are identical to what a
//     separate scorer would find, so we score directly from them);
//   - test-file penalty: paths containing "test" get a 1.05× score
//     bump (capped at 1.0) so non-test files rank slightly higher when
//     scores are otherwise equal.
//
// Async load: yields to the event loop every ~CHUNK_MS of sync work so
// large indexes (270k+ files) don't block the main thread for >10ms at
// a time. `loadFromFileListAsync` returns `{ queryable, done }`:
// `queryable` resolves after the first chunk so partial results are
// available while build continues.
//
// Side-effects: none. Pure logic, no FS / network. Walker lives in
// ./walker.ts; the convenience wrapper that ties them together lives
// in ./searchPaths.ts.

export type SearchResult = {
  path: string
  score: number
}

// nucleo-style scoring constants (approximating fzf-v2 / nucleo bonuses)
const SCORE_MATCH = 16
const BONUS_BOUNDARY = 8
const BONUS_CAMEL = 6
const BONUS_CONSECUTIVE = 4
const BONUS_FIRST_CHAR = 8
const PENALTY_GAP_START = 3
const PENALTY_GAP_EXTENSION = 1

const TOP_LEVEL_CACHE_LIMIT = 100
const MAX_QUERY_LEN = 64
// Yield to event loop after this many ms of sync work. Chunk sizes are
// time-based (not count-based) so slow machines get smaller chunks and
// stay responsive — 5k paths is ~2ms on M-series but could be 15ms+ on
// older Windows hardware.
const CHUNK_MS = 4

// Reusable buffer: records where each needle char matched during the
// indexOf scan. Re-used across queries — search() is not re-entrant.
const posBuf = new Int32Array(MAX_QUERY_LEN)

export class FileIndex {
  private paths: string[] = []
  private lowerPaths: string[] = []
  private charBits: Int32Array = new Int32Array(0)
  private pathLens: Uint16Array = new Uint16Array(0)
  private topLevelCache: SearchResult[] | null = null
  // During async build, tracks how many paths have bitmap/lowerPath filled.
  // search() uses this to search the ready prefix while build continues.
  private readyCount = 0

  /**
   * Load paths from an array of strings.
   * Automatically deduplicates and filters empty strings.
   */
  loadFromFileList(fileList: string[]): void {
    const seen = new Set<string>()
    const paths: string[] = []
    for (const line of fileList) {
      if (line.length > 0 && !seen.has(line)) {
        seen.add(line)
        paths.push(line)
      }
    }

    this.buildIndex(paths)
  }

  /**
   * Async variant: yields to the event loop every ~CHUNK_MS of work so
   * large indexes (270k+ files) don't block the main thread for >10ms
   * at a time. Identical result to {@link loadFromFileList}.
   *
   * Returns `{ queryable, done }`:
   *   - `queryable` resolves as soon as the first chunk is indexed
   *     (search returns partial results from the ready prefix);
   *   - `done` resolves when the entire index is built.
   */
  loadFromFileListAsync(fileList: string[]): {
    queryable: Promise<void>
    done: Promise<void>
  } {
    let markQueryable: () => void = () => {
      // assigned below
    }
    const queryable = new Promise<void>(resolve => {
      markQueryable = resolve
    })
    const done = this.buildAsync(fileList, markQueryable)
    return { queryable, done }
  }

  /** Total number of indexed paths (post-dedup, post-build). */
  size(): number {
    return this.paths.length
  }

  /** Paths already searchable (may be less than `size()` mid-async-build). */
  ready(): number {
    return this.readyCount
  }

  /**
   * Search for paths matching the query using fuzzy matching.
   * Returns up to `limit` results sorted by match score (best first).
   *
   * Empty query returns the cached top-level entries (e.g. `src`,
   * `test`, `package.json`) so palettes have something useful to show
   * before the user types anything.
   */
  search(query: string, limit: number): SearchResult[] {
    if (limit <= 0) return []
    if (query.length === 0) {
      if (this.topLevelCache) {
        return this.topLevelCache.slice(0, limit)
      }
      return []
    }

    // Smart case: lowercase query → case-insensitive; any uppercase
    // → case-sensitive (matches fzf / nucleo / VS Code default).
    const caseSensitive = query !== query.toLowerCase()
    const needle = caseSensitive ? query : query.toLowerCase()
    const nLen = Math.min(needle.length, MAX_QUERY_LEN)
    const needleChars: string[] = new Array<string>(nLen)
    let needleBitmap = 0
    for (let j = 0; j < nLen; j++) {
      const ch = needle.charAt(j)
      needleChars[j] = ch
      const cc = ch.charCodeAt(0)
      if (cc >= 97 && cc <= 122) needleBitmap |= 1 << (cc - 97)
    }

    // Upper bound on score assuming every match gets the max boundary
    // bonus. Used to reject paths whose gap penalties alone make them
    // unable to beat the current top-k threshold, before the
    // charCodeAt-heavy boundary pass.
    const scoreCeiling =
      nLen * (SCORE_MATCH + BONUS_BOUNDARY) + BONUS_FIRST_CHAR + 32

    // Top-k: maintain a sorted-ascending array of the best `limit` matches.
    const topK: { path: string; fuzzScore: number }[] = []
    let threshold = -Infinity

    const { paths, lowerPaths, charBits, pathLens, readyCount } = this

    outer: for (let i = 0; i < readyCount; i++) {
      // O(1) bitmap reject
      const bits = charBits[i] ?? 0
      if ((bits & needleBitmap) !== needleBitmap) continue

      const haystack = caseSensitive ? paths[i]! : lowerPaths[i]!

      // Fused indexOf scan: find positions (SIMD-accelerated in JSC/V8)
      // AND accumulate gap/consecutive terms inline. The greedy-earliest
      // positions found here are identical to what the charCodeAt
      // scorer would find, so we score directly from them.
      let pos = haystack.indexOf(needleChars[0]!)
      if (pos === -1) continue
      posBuf[0] = pos
      let gapPenalty = 0
      let consecBonus = 0
      let prev = pos
      for (let j = 1; j < nLen; j++) {
        pos = haystack.indexOf(needleChars[j]!, prev + 1)
        if (pos === -1) continue outer
        posBuf[j] = pos
        const gap = pos - prev - 1
        if (gap === 0) consecBonus += BONUS_CONSECUTIVE
        else gapPenalty += PENALTY_GAP_START + gap * PENALTY_GAP_EXTENSION
        prev = pos
      }

      // Gap-bound reject: if the best-case score (all boundary bonuses)
      // minus known gap penalties can't beat threshold, skip the
      // boundary pass.
      if (
        topK.length === limit &&
        scoreCeiling + consecBonus - gapPenalty <= threshold
      ) {
        continue
      }

      // Boundary / camelCase scoring: check the char before each match
      // position in the original-case path (camelCase needs case info).
      const path = paths[i]!
      const hLen = pathLens[i] ?? path.length
      let score = nLen * SCORE_MATCH + consecBonus - gapPenalty
      score += scoreBonusAt(path, posBuf[0]!, true)
      for (let j = 1; j < nLen; j++) {
        score += scoreBonusAt(path, posBuf[j]!, false)
      }
      // Short-path bonus: tiny boost so `src/a.ts` beats `src/lib/a.ts`
      // when the rest is equal. Saturates at length 0.
      score += Math.max(0, 32 - (hLen >> 2))

      if (topK.length < limit) {
        topK.push({ path, fuzzScore: score })
        if (topK.length === limit) {
          topK.sort((a, b) => a.fuzzScore - b.fuzzScore)
          threshold = topK[0]!.fuzzScore
        }
      } else if (score > threshold) {
        let lo = 0
        let hi = topK.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (topK[mid]!.fuzzScore < score) lo = mid + 1
          else hi = mid
        }
        topK.splice(lo, 0, { path, fuzzScore: score })
        topK.shift()
        threshold = topK[0]!.fuzzScore
      }
    }

    // topK is ascending; reverse to descending (best first)
    topK.sort((a, b) => b.fuzzScore - a.fuzzScore)

    const matchCount = topK.length
    const denom = Math.max(matchCount, 1)
    const results: SearchResult[] = new Array<SearchResult>(matchCount)

    for (let i = 0; i < matchCount; i++) {
      const path = topK[i]!.path
      const positionScore = i / denom
      const finalScore = path.includes('test')
        ? Math.min(positionScore * 1.05, 1.0)
        : positionScore
      results[i] = { path, score: finalScore }
    }

    return results
  }

  private async buildAsync(
    fileList: string[],
    markQueryable: () => void,
  ): Promise<void> {
    const seen = new Set<string>()
    const paths: string[] = []
    let chunkStart = performance.now()
    for (let i = 0; i < fileList.length; i++) {
      const line = fileList[i]!
      if (line.length > 0 && !seen.has(line)) {
        seen.add(line)
        paths.push(line)
      }
      // Check every 256 iterations to amortize performance.now() overhead
      if ((i & 0xff) === 0xff && performance.now() - chunkStart > CHUNK_MS) {
        await yieldToEventLoop()
        chunkStart = performance.now()
      }
    }

    this.resetArrays(paths)

    chunkStart = performance.now()
    let firstChunk = true
    for (let i = 0; i < paths.length; i++) {
      this.indexPath(i)
      if ((i & 0xff) === 0xff && performance.now() - chunkStart > CHUNK_MS) {
        this.readyCount = i + 1
        if (firstChunk) {
          markQueryable()
          firstChunk = false
        }
        await yieldToEventLoop()
        chunkStart = performance.now()
      }
    }
    this.readyCount = paths.length
    markQueryable()
  }

  private buildIndex(paths: string[]): void {
    this.resetArrays(paths)
    for (let i = 0; i < paths.length; i++) {
      this.indexPath(i)
    }
    this.readyCount = paths.length
  }

  private resetArrays(paths: string[]): void {
    const n = paths.length
    this.paths = paths
    this.lowerPaths = new Array<string>(n)
    this.charBits = new Int32Array(n)
    this.pathLens = new Uint16Array(n)
    this.readyCount = 0
    this.topLevelCache = computeTopLevelEntries(paths, TOP_LEVEL_CACHE_LIMIT)
  }

  // Precompute: lowercase, a–z bitmap, length. Bitmap gives O(1)
  // rejection of paths missing any needle letter.
  private indexPath(i: number): void {
    const p = this.paths[i]!
    const lp = p.toLowerCase()
    this.lowerPaths[i] = lp
    const len = lp.length
    this.pathLens[i] = len
    let bits = 0
    for (let j = 0; j < len; j++) {
      const c = lp.charCodeAt(j)
      if (c >= 97 && c <= 122) bits |= 1 << (c - 97)
    }
    this.charBits[i] = bits
  }
}

/**
 * Boundary / camelCase bonus for a match at position `pos` in the
 * original-case path. `first` enables the start-of-string bonus (only
 * for needle[0]).
 */
function scoreBonusAt(path: string, pos: number, first: boolean): number {
  if (pos === 0) return first ? BONUS_FIRST_CHAR : 0
  const prevCh = path.charCodeAt(pos - 1)
  if (isBoundary(prevCh)) return BONUS_BOUNDARY
  if (isLower(prevCh) && isUpper(path.charCodeAt(pos))) return BONUS_CAMEL
  return 0
}

function isBoundary(code: number): boolean {
  // / \ - _ . space
  return (
    code === 47 || // /
    code === 92 || // \
    code === 45 || // -
    code === 95 || // _
    code === 46 || // .
    code === 32 //   (space)
  )
}

function isLower(code: number): boolean {
  return code >= 97 && code <= 122
}

function isUpper(code: number): boolean {
  return code >= 65 && code <= 90
}

/** Yield to the event loop. Exposed so async callers can mirror the
 * same cooperation cadence the index uses internally. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

export { CHUNK_MS }

/**
 * Extract unique top-level path segments, sorted by (length asc, then
 * alpha asc). Handles both Unix (`/`) and Windows (`\`) separators.
 * Used as the empty-query fallback so a typeahead always has something
 * to show before the user starts typing.
 */
function computeTopLevelEntries(
  paths: string[],
  limit: number,
): SearchResult[] {
  const topLevel = new Set<string>()

  for (const p of paths) {
    let end = p.length
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i)
      if (c === 47 || c === 92) {
        end = i
        break
      }
    }
    const segment = p.slice(0, end)
    if (segment.length > 0) {
      topLevel.add(segment)
      if (topLevel.size >= limit) break
    }
  }

  const sorted = Array.from(topLevel)
  sorted.sort((a, b) => {
    const lenDiff = a.length - b.length
    if (lenDiff !== 0) return lenDiff
    return a < b ? -1 : a > b ? 1 : 0
  })

  return sorted.slice(0, limit).map(path => ({ path, score: 0.0 }))
}

/**
 * Stateless one-shot scoring: returns the fuzzScore for a single
 * path / query pair, or `null` if the query is not a subsequence of
 * the path.
 *
 * This is the same scorer the FileIndex uses internally, exposed for
 * callers who only have one or two paths to rank (e.g. small palette
 * with a hand-curated list of candidates) and don't want to pay the
 * indexing cost. Higher score = better match.
 *
 * Returns `null` rather than `0` for non-matches so callers can
 * distinguish "didn't match" from "matched poorly" — sentinel-style
 * matches the rest of the module.
 */
export function scorePath(query: string, path: string): number | null {
  if (query.length === 0) return 0
  const caseSensitive = query !== query.toLowerCase()
  const haystack = caseSensitive ? path : path.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const nLen = Math.min(needle.length, MAX_QUERY_LEN)

  const positions: number[] = new Array<number>(nLen)
  let pos = haystack.indexOf(needle.charAt(0))
  if (pos === -1) return null
  positions[0] = pos
  let gapPenalty = 0
  let consecBonus = 0
  let prev = pos
  for (let j = 1; j < nLen; j++) {
    pos = haystack.indexOf(needle.charAt(j), prev + 1)
    if (pos === -1) return null
    positions[j] = pos
    const gap = pos - prev - 1
    if (gap === 0) consecBonus += BONUS_CONSECUTIVE
    else gapPenalty += PENALTY_GAP_START + gap * PENALTY_GAP_EXTENSION
    prev = pos
  }

  let score = nLen * SCORE_MATCH + consecBonus - gapPenalty
  score += scoreBonusAt(path, positions[0]!, true)
  for (let j = 1; j < nLen; j++) {
    score += scoreBonusAt(path, positions[j]!, false)
  }
  score += Math.max(0, 32 - (path.length >> 2))
  return score
}
