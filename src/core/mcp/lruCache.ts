/**
 * A simple LRU (Least-Recently-Used) map backed by a native `Map`.
 *
 * `Map` preserves insertion order since ES2015.  The "oldest" entry is the
 * one at the beginning of the iteration (inserted earliest and not yet
 * re-accessed). Accessing an entry via `get` promotes it to most-recent by
 * deleting and re-inserting it.
 */
import crypto from 'node:crypto'

export class LruMap<K, V> {
  private max: number
  private map: Map<K, V>

  constructor(max: number) {
    if (max < 1) throw new RangeError('LruMap max must be >= 1')
    this.max = max
    this.map = new Map()
  }

  /** Get a value and promote it to most-recent. Returns undefined if absent. */
  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined
    const v = this.map.get(k)!
    // Re-insert to promote to most-recent position
    this.map.delete(k)
    this.map.set(k, v)
    return v
  }

  /** Set a value. Evicts the oldest entry if size would exceed max. */
  set(k: K, v: V): void {
    if (this.map.has(k)) {
      // Update in-place: delete first so re-insert moves it to most-recent
      this.map.delete(k)
    }
    this.map.set(k, v)
    // Evict oldest (first inserted) if over budget
    if (this.map.size > this.max) {
      const oldestKey = this.map.keys().next().value as K
      this.map.delete(oldestKey)
    }
  }

  /** Remove an entry by key. No-op if absent. */
  delete(k: K): void {
    this.map.delete(k)
  }

  /** Remove all entries. */
  clear(): void {
    this.map.clear()
  }

  /** Number of entries currently stored. */
  size(): number {
    return this.map.size
  }

  /** Iterate over keys in insertion (oldest-first) order. */
  keys(): IterableIterator<K> {
    return this.map.keys()
  }
}

/**
 * Compute a short (8 hex chars) SHA-256 hash of a JSON-serialized config
 * object. Used as part of the cache key for `McpManager`.
 */
export function configHash(cfg: unknown): string {
  const json = JSON.stringify(cfg)
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 8)
}
