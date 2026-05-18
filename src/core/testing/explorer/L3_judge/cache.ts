// src/core/testing/explorer/L3_judge/cache.ts
//
// L3' Judge — grid-hash dedup cache for two-tier verdicts.
//
// ## Deliberate divergence from locked spec §4.5
//
// Spec §4.5 specifies a single `.ink-explorer/judge-cache.json` file. This
// implementation instead writes one JSON file per cache entry into a
// directory-sharded layout:
//
//     <root>/<componentHash[0..2]>/<fullHash>.json
//
//   where  componentHash = sha256(component).slice(0, 2)
//          fullHash      = sha256(gridHash + '|' + component + '|' + viewportKey)
//
// **Reason for divergence**: a single JSON file forces every put() to
// re-serialise + re-write the whole document. With 10k+ entries this is
// ~MB-class I/O on every cache miss across a sweep, and any concurrent
// `judge` invocation (sweep + manual re-judge) would corrupt the file
// without an external lock. The directory-shard layout is O(1) per
// entry, naturally collision-free under sha256, and trivially safe under
// concurrent writers because each file maps to a unique key.
//
// This divergence is recorded in:
//   * docs/superpowers/plans/2026-05-18-ink-ui-explorer-bringup-plan.md §M4.T3
//   * src/core/testing/explorer/common/tracingFs.ts header comment

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/** Verdict shape persisted to disk and returned by the two-tier judge. */
export type JudgeVerdict = {
  ok: boolean
  issues?: { invariant: string; description: string }[]
  /** Which model produced the final verdict. */
  judgedBy: 'haiku' | 'opus'
  /** Unix milliseconds. */
  judgedAt: number
}

/** On-disk envelope — verdict + original key for audit/integrity. */
type Envelope = {
  key: {
    gridHash: string
    component: string
    viewportKey: string
  }
  verdict: JudgeVerdict
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** Directory-sharded grid-hash → verdict cache (see file header). */
export class JudgeCache {
  private readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
    mkdirSync(this.root, { recursive: true })
  }

  /**
   * Resolve the on-disk path for a cache key. The component hash forms a
   * 2-char shard prefix; the full hash includes all three key fields so
   * collisions across components or viewports are impossible at sha256
   * preimage strength.
   */
  private pathFor(key: {
    gridHash: string
    component: string
    viewportKey: string
  }): string {
    const componentHash = sha256(key.component).slice(0, 2)
    const fullHash = sha256(
      `${key.gridHash}|${key.component}|${key.viewportKey}`,
    )
    return path.join(this.root, componentHash, `${fullHash}.json`)
  }

  /** Returns the cached verdict, or null if no entry exists. */
  get(key: {
    gridHash: string
    component: string
    viewportKey: string
  }): JudgeVerdict | null {
    const filePath = this.pathFor(key)
    if (!existsSync(filePath)) return null
    try {
      const raw = readFileSync(filePath, 'utf8')
      const env = JSON.parse(raw) as Envelope
      return env.verdict
    } catch {
      // Corrupt entry — treat as miss; caller will re-judge and overwrite.
      return null
    }
  }

  /** Writes (or overwrites) the verdict for the given key. */
  put(
    key: { gridHash: string; component: string; viewportKey: string },
    verdict: JudgeVerdict,
  ): void {
    const filePath = this.pathFor(key)
    mkdirSync(path.dirname(filePath), { recursive: true })
    const envelope: Envelope = { key, verdict }
    writeFileSync(filePath, JSON.stringify(envelope, null, 2), 'utf8')
  }
}
