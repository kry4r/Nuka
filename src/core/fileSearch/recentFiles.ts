// src/core/fileSearch/recentFiles.ts
//
// RecentFiles — most-recently-used (MRU) file-path tracker.
//
// Why this exists: `searchPaths.ts` already accepts a `recentFiles:
// ReadonlyArray<string>` parameter on its options and feeds it into
// `promoteRecent` to nudge ranking. That helper is stateless — it
// trusts the caller to maintain a "freshest first" list. This module
// owns that state: a small ring-buffer keyed by path, with monotonic
// access timestamps and a recency-decay scoring helper, optionally
// persisted to disk.
//
// Upstream provenance: Nuka-Code doesn't ship a dedicated MRU module.
// The closest analogue lives in `src/services/compact/compact.ts`,
// where `recentFiles` is derived ad-hoc from the per-session
// `readFileState: Record<path, { content, timestamp }>` and sorted by
// `timestamp` descending. We lift that shape — `Record<path,
// {timestamp, hits}>` — into a stand-alone helper so the same
// pattern can be reused outside the compact path (palette boosting,
// keyterm seeding, prompt suggestions). The `boost()` scoring is
// new; upstream just uses ordering.
//
// Design choices:
//   - In-memory state is a `Map<string, Entry>`. Map preserves insertion
//     order, so re-touching a path moves it to the end via delete+set;
//     `list()` reverses to give freshest-first.
//   - Eviction is by insertion order (oldest first) when `maxEntries`
//     is exceeded. This is fine because every `touch` reinserts.
//   - `boost(path)` returns a value in [0, 1] derived from elapsed time
//     since the last touch, using `Math.pow(0.5, elapsed/halfLife)`.
//     `decayHalfLifeMs` defaults to 1 hour. Hits give a tiny extra
//     bump capped at 0.1 so frequently-touched-but-old paths don't
//     out-rank brand-new touches.
//   - The `now()` clock is injectable for deterministic tests.
//   - Persistence is opt-in (`persistRecentFiles` / `loadRecentFiles`).
//     The on-disk format is plain JSON via `toJSON()` / `fromJSON()`
//     — versioned so future format changes can migrate cleanly.
//     Default path lives under `$HOME/.nuka/recent-files.json`.
//   - `createPersistentRecentFiles` is the convenience entrypoint:
//     loads on construction and saves throttled (debounced) on every
//     touch. Throttle is async-safe (single in-flight write at a time;
//     a queued follow-up flush picks up newer state on completion).
//
// Side-effects: filesystem reads/writes only in the `persist*` /
// `load*` / `createPersistent*` helpers. The core tracker is pure.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** One MRU entry — last-touched timestamp + cumulative hit count. */
export type RecentFileEntry = {
  /** Forward-slash path (relative or absolute — caller decides). */
  readonly path: string
  /** Epoch ms of the most recent `touch()`. */
  readonly timestamp: number
  /** Number of times `touch()` has been called for this path. */
  readonly hits: number
}

/** On-disk JSON representation. The `v` field lets us migrate later. */
export type RecentFilesJSON = {
  readonly v: 1
  readonly entries: ReadonlyArray<RecentFileEntry>
  /** Tracker options at the time of the snapshot, for sanity. */
  readonly opts: {
    readonly maxEntries: number
    readonly decayHalfLifeMs: number
  }
}

/** Construction-time options. */
export type RecentFilesOptions = {
  /**
   * Maximum number of paths to remember. Once exceeded, the
   * least-recently-touched entry is evicted. Default `64`.
   */
  readonly maxEntries?: number
  /**
   * Half-life in ms for the recency decay used by `boost()`. A path
   * touched `decayHalfLifeMs` ago scores 0.5; twice that ago, 0.25;
   * etc. Default 1 hour (`3_600_000`).
   */
  readonly decayHalfLifeMs?: number
  /**
   * Override the wall clock — useful for deterministic tests. Default
   * `() => Date.now()`.
   */
  readonly now?: () => number
}

const DEFAULT_MAX_ENTRIES = 64
const DEFAULT_HALF_LIFE_MS = 60 * 60 * 1000 // 1 hour
const HIT_BONUS_MAX = 0.1
const HIT_BONUS_SATURATION = 10 // hits above this contribute no extra

/**
 * In-memory MRU tracker for file paths. Holds at most `maxEntries`
 * paths; `touch()` records (or refreshes) one; `list()` returns the
 * current MRU order, freshest first; `boost()` scores a path by
 * recency for use in result ranking.
 */
export class RecentFiles {
  // Map preserves insertion order. We delete+set on every touch so
  // the iteration order is also access order.
  private readonly entries: Map<string, RecentFileEntry> = new Map()
  private readonly maxEntries: number
  private readonly decayHalfLifeMs: number
  private readonly now: () => number

  constructor(opts: RecentFilesOptions = {}) {
    this.maxEntries =
      opts.maxEntries !== undefined && opts.maxEntries > 0
        ? Math.floor(opts.maxEntries)
        : DEFAULT_MAX_ENTRIES
    this.decayHalfLifeMs =
      opts.decayHalfLifeMs !== undefined && opts.decayHalfLifeMs > 0
        ? opts.decayHalfLifeMs
        : DEFAULT_HALF_LIFE_MS
    this.now = opts.now ?? (() => Date.now())
  }

  /**
   * Record (or refresh) an access for `path`. Moves the path to the
   * head of the MRU list; evicts the oldest entry if `maxEntries` is
   * exceeded. Pass an explicit `timestamp` to override the clock —
   * useful when replaying or seeding state.
   */
  touch(path: string, timestamp?: number): void {
    if (path.length === 0) return
    const ts = timestamp ?? this.now()
    const prev = this.entries.get(path)
    // Re-insert (delete first) so this path becomes the youngest in
    // insertion order even when it already existed.
    if (prev !== undefined) {
      this.entries.delete(path)
      this.entries.set(path, {
        path,
        timestamp: ts,
        hits: prev.hits + 1,
      })
    } else {
      this.entries.set(path, { path, timestamp: ts, hits: 1 })
    }
    this.evictIfOversize()
  }

  /**
   * Return the current MRU list, freshest first. Empty array if no
   * paths have been touched. The returned array is a snapshot —
   * mutating it does not affect the tracker.
   */
  list(): string[] {
    // Map iteration is insertion order, which we've maintained as
    // access order. Reverse to put freshest first.
    const out: string[] = []
    for (const path of this.entries.keys()) out.push(path)
    out.reverse()
    return out
  }

  /**
   * Return the raw entries, freshest first. Same ordering as
   * `list()`, but with timestamps and hit counts attached.
   */
  entriesSnapshot(): RecentFileEntry[] {
    const out: RecentFileEntry[] = []
    for (const e of this.entries.values()) out.push(e)
    out.reverse()
    return out
  }

  /**
   * Return a recency-based boost factor in [0, 1] for `path`. Unknown
   * paths score 0. The score is `0.5 ** (elapsed / halfLife)` capped
   * to [0, 1 - HIT_BONUS_MAX], plus a small hit-frequency bonus
   * (capped at HIT_BONUS_MAX) so frequently-revisited paths edge out
   * one-off touches at equal recency.
   *
   * `timestamp` (the "now" for the comparison) defaults to the
   * tracker's clock; pass it explicitly for deterministic tests.
   */
  boost(path: string, timestamp?: number): number {
    const entry = this.entries.get(path)
    if (entry === undefined) return 0
    const at = timestamp ?? this.now()
    const elapsed = Math.max(0, at - entry.timestamp)
    const recencyScore =
      this.decayHalfLifeMs > 0
        ? Math.pow(0.5, elapsed / this.decayHalfLifeMs)
        : 0
    // Recency dominates; hits add a small extra nudge.
    const hitBonus =
      HIT_BONUS_MAX *
      Math.min(1, entry.hits / HIT_BONUS_SATURATION)
    const base = recencyScore * (1 - HIT_BONUS_MAX)
    const total = base + hitBonus * recencyScore
    if (total < 0) return 0
    if (total > 1) return 1
    return total
  }

  /** Remove `path` from the MRU list. No-op if not present. */
  forget(path: string): void {
    this.entries.delete(path)
  }

  /** Drop every tracked path. */
  clear(): void {
    this.entries.clear()
  }

  /** Number of paths currently tracked. */
  get size(): number {
    return this.entries.size
  }

  /**
   * Serialize to the on-disk JSON shape. Entries are emitted oldest
   * first so a `fromJSON` round-trip re-establishes the same
   * insertion / access order via `touch()`.
   */
  toJSON(): RecentFilesJSON {
    const entries: RecentFileEntry[] = []
    for (const e of this.entries.values()) entries.push(e)
    // entries is insertion (oldest → freshest); emit as-is so reload
    // can replay in chronological order.
    return {
      v: 1,
      entries,
      opts: {
        maxEntries: this.maxEntries,
        decayHalfLifeMs: this.decayHalfLifeMs,
      },
    }
  }

  /**
   * Replace the tracker's state with the contents of `data`. The
   * tracker's own `maxEntries` / `decayHalfLifeMs` are preserved
   * (i.e. if the snapshot has 200 entries but this tracker caps at
   * 64, the oldest 136 are dropped on load).
   */
  fromJSON(data: RecentFilesJSON): void {
    this.entries.clear()
    // entries are oldest → freshest; insert in order so the Map's
    // iteration order matches.
    for (const e of data.entries) {
      if (typeof e.path !== 'string' || e.path.length === 0) continue
      if (typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp)) {
        continue
      }
      if (typeof e.hits !== 'number' || !Number.isFinite(e.hits)) continue
      this.entries.set(e.path, {
        path: e.path,
        timestamp: e.timestamp,
        hits: Math.max(1, Math.floor(e.hits)),
      })
    }
    this.evictIfOversize()
  }

  private evictIfOversize(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) return
      this.entries.delete(oldest.value)
    }
  }
}

/**
 * Default on-disk location for the persistence helpers. Lives under
 * the user's home dir so it survives across cwds / projects.
 */
export function defaultRecentFilesPath(): string {
  return join(homedir(), '.nuka', 'recent-files.json')
}

/**
 * Write the tracker's state to `path` as JSON. Creates parent
 * directories as needed.
 *
 * Atomic on POSIX: marshals the payload to a sibling `.tmp-<pid>-<ms>`
 * file first, then `rename`s into the final path so a crash mid-write
 * never leaves a half-written file at `path`. The tmp suffix carries
 * pid+ms so two writers (rare — there's only one tracker per process,
 * but two concurrent Nuka processes share the home-dir file) can't
 * clobber each other's tmp. On a failed `rename` we best-effort delete
 * the tmp so an aborted save doesn't leak.
 *
 * Mirrors the idiom in `src/core/cost/persist.ts` and
 * `src/core/plan/state.ts`. Throws on filesystem errors so the caller
 * can decide whether to swallow (debounced save in cli.tsx does).
 */
export async function persistRecentFiles(
  tracker: RecentFiles,
  path: string,
): Promise<void> {
  const payload = JSON.stringify(tracker.toJSON())
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, payload, 'utf8')
  try {
    await rename(tmp, path)
  } catch (err) {
    // Best-effort cleanup of the tmp file when rename fails so we
    // don't leak `.tmp-…` siblings on every crash.
    try {
      await unlink(tmp)
    } catch {
      /* swallow — original error is more interesting */
    }
    throw err
  }
}

/**
 * Load a tracker from `path`. If the file is missing or unreadable,
 * returns a fresh empty tracker (using `opts`). Invalid / partial JSON
 * is also tolerated — corrupt files yield an empty tracker rather
 * than throwing, so a broken persistence file never blocks startup.
 */
export async function loadRecentFiles(
  path: string,
  opts: RecentFilesOptions = {},
): Promise<RecentFiles> {
  const tracker = new RecentFiles(opts)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return tracker
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return tracker
  }
  if (!isRecentFilesJSON(parsed)) return tracker
  tracker.fromJSON(parsed)
  return tracker
}

/** A `RecentFiles` whose state is mirrored to disk on every `touch`. */
export type PersistentRecentFiles = RecentFiles & {
  /** Force-flush any pending writes. Resolves once disk is up to date. */
  flush(): Promise<void>
}

/**
 * Build a `RecentFiles` that reads its initial state from `path` (if
 * present) and writes back on every `touch` / `forget` / `clear`.
 * Writes are coalesced — there is at most one in-flight write at a
 * time; subsequent state changes mark the tracker dirty and a single
 * follow-up write picks them up when the current one completes.
 *
 * `path` defaults to {@link defaultRecentFilesPath}; pass an explicit
 * override (e.g. a tmpdir path) for tests.
 */
export async function createPersistentRecentFiles(
  opts: RecentFilesOptions & { path?: string } = {},
): Promise<PersistentRecentFiles> {
  const { path: rawPath, ...rest } = opts
  const path = rawPath ?? defaultRecentFilesPath()
  const tracker = await loadRecentFiles(path, rest)

  let writing: Promise<void> | null = null
  let dirty = false

  const scheduleWrite = (): void => {
    dirty = true
    if (writing !== null) return
    writing = (async (): Promise<void> => {
      while (dirty) {
        dirty = false
        try {
          await persistRecentFiles(tracker, path)
        } catch {
          // Swallow — persistence is best-effort. The next touch
          // will retry; we never block the caller on disk errors.
          break
        }
      }
      writing = null
    })()
  }

  // Wrap mutators to fire the writer. We don't subclass RecentFiles
  // (it's not a public extension point) — instead we wrap the methods
  // we care about on the existing instance.
  const origTouch = tracker.touch.bind(tracker)
  const origForget = tracker.forget.bind(tracker)
  const origClear = tracker.clear.bind(tracker)
  const origFromJSON = tracker.fromJSON.bind(tracker)

  tracker.touch = (p: string, ts?: number): void => {
    origTouch(p, ts)
    scheduleWrite()
  }
  tracker.forget = (p: string): void => {
    origForget(p)
    scheduleWrite()
  }
  tracker.clear = (): void => {
    origClear()
    scheduleWrite()
  }
  tracker.fromJSON = (data: RecentFilesJSON): void => {
    origFromJSON(data)
    scheduleWrite()
  }

  const persistent = tracker as PersistentRecentFiles
  persistent.flush = async (): Promise<void> => {
    // If a write is in flight, await it; if more dirty state was
    // queued during that write, scheduleWrite has already chained
    // a follow-up.
    while (writing !== null) {
      await writing
    }
  }
  return persistent
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isRecentFilesJSON(value: unknown): value is RecentFilesJSON {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { v?: unknown; entries?: unknown }
  // We accept `v === 1` only. A different version is treated as
  // "wrong shape" → caller (`loadRecentFiles`) returns an empty tracker
  // rather than risking a misinterpreted future format.
  if (v.v !== 1) return false
  if (!Array.isArray(v.entries)) return false
  // We do NOT pre-validate per-entry fields here. `fromJSON` filters
  // entries with bad fields individually (string path, finite
  // timestamp, finite hits), so a partially-corrupt entry list still
  // yields the good entries. Pre-rejecting the whole file on one bad
  // row would throw away usable history.
  return true
}
