import * as fs from 'node:fs'
import * as path from 'node:path'
import { tasksDir, forksDir, recapsDir, eventsDir } from '../paths'

const DAY = 24 * 60 * 60 * 1000

const RULES: Array<{ dir: (h: string) => string; ageMs: number; recurse: boolean }> = [
  { dir: tasksDir,  ageMs: 14 * DAY, recurse: false },
  { dir: forksDir,  ageMs:  1 * DAY, recurse: true  },
  { dir: recapsDir, ageMs: 90 * DAY, recurse: false },
  { dir: eventsDir, ageMs:  7 * DAY, recurse: false },
]

export type SweepOpts = { now?: number }

export function runRetentionSweep(home: string, opts: SweepOpts = {}): void {
  const now = opts.now ?? Date.now()
  for (const r of RULES) {
    const root = r.dir(home)
    if (!fs.existsSync(root)) continue
    sweep(root, now - r.ageMs, r.recurse)
  }
}

function sweep(dir: string, threshold: number, recurse: boolean): void {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) {
      if (recurse) sweep(p, threshold, recurse)
      continue
    }
    if (st.mtimeMs < threshold) {
      try { fs.unlinkSync(p) } catch { /* swallow */ }
    }
  }
}
