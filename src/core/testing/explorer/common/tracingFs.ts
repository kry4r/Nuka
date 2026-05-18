// src/core/testing/explorer/common/tracingFs.ts
//
// Safe filesystem helpers for the ink-ui-explorer per-project working
// directory.  See locked spec §3.3 for the directory layout:
//
//   <root>/.ink-explorer/
//     failures/   ← transient failure dumps written by sweep/fuzz
//     resolved/   ← dumps moved here after successful repair
//     captures/   ← ASCII grids written by the capture verb
//     judge-cache/← sharded verdict cache (directory; see plan deviation note)
//     runs/       ← raw JSONL run logs
//
// Plan deviation (M4.T3): locked spec §4.5 specifies `.ink-explorer/judge-cache.json`
// (single file). We use `.ink-explorer/judge-cache/` (directory, sharded by
// component) to scale past 10k entries. Documented as deliberate in plan.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { FailureRecord } from '../types'

/** All resolved absolute paths under the .ink-explorer/ root. */
export type ExplorerPaths = {
  /** .ink-explorer root */
  root: string
  /** transient failure dumps */
  failures: string
  /** repair-cleared dumps (audit trail) */
  resolved: string
  /** capture verb outputs */
  captures: string
  /** verdict cache directory (sharded by component) */
  judgeCache: string
  /** raw JSONL run logs */
  runs: string
}

const EXPLORER_DIR = '.ink-explorer'

/**
 * Ensure the `.ink-explorer/` tree exists under `root` (first call creates;
 * subsequent calls are idempotent — mkdirSync recursive is a no-op if the
 * directory already exists).
 *
 * @param root   Project root directory (absolute path).
 * @returns      Typed set of resolved absolute paths.
 */
export function ensureExplorerDir(root: string): ExplorerPaths {
  const base = path.resolve(root, EXPLORER_DIR)
  const subdirs = {
    root: base,
    failures: path.join(base, 'failures'),
    resolved: path.join(base, 'resolved'),
    captures: path.join(base, 'captures'),
    judgeCache: path.join(base, 'judge-cache'),
    runs: path.join(base, 'runs'),
  }

  // Create all in one pass — mkdirSync({recursive:true}) is idempotent.
  for (const dir of Object.values(subdirs)) {
    mkdirSync(dir, { recursive: true })
  }

  return subdirs
}

/**
 * Serialise a `FailureRecord` to a Markdown file under
 * `paths.failures/<record.id>.md` and return the written path.
 *
 * The format is human-readable so reviewers can inspect failures without
 * tooling, and machine-parseable by `dumpReader.ts` (M5).
 */
export function writeFailureDump(
  paths: ExplorerPaths,
  rec: FailureRecord,
): string {
  const filePath = path.join(paths.failures, `${rec.id}.md`)

  const lines: string[] = [
    `# Failure dump: ${rec.id}`,
    ``,
    `- **component:** ${rec.component}`,
    `- **case:** ${rec.fixtureCase}`,
    `- **viewport:** ${rec.viewport.cols}×${rec.viewport.rows}`,
    `- **timestamp:** ${rec.timestamp}`,
  ]
  // M5.T1 / M4-review-1 fix: emit gridHash so dumpReader can round-trip the
  // judge cache key. Optional — omitted when the producer never set it.
  if (rec.gridHash) {
    lines.push(`- **gridHash:** ${rec.gridHash}`)
  }
  // M5.T4: fixturePath lets the repair subagent know what to re-mount via
  // the verify tool. Optional for legacy M2 dumps that pre-date M5.
  if (rec.fixturePath) {
    lines.push(`- **fixturePath:** ${rec.fixturePath}`)
  }
  lines.push(``)
  lines.push(`## Violations`)
  lines.push(``)

  for (const v of rec.violations) {
    lines.push(`### ${v.rule} (${v.severity})`)
    lines.push(``)
    lines.push(v.message)
    if (v.excerpt) {
      lines.push(``)
      lines.push('```')
      lines.push(v.excerpt)
      lines.push('```')
    }
    if (v.cells && v.cells.length > 0) {
      const coords = v.cells.map((c) => `(${c.x},${c.y})`).join(' ')
      lines.push(``)
      lines.push(`Cells: ${coords}`)
    }
    lines.push(``)
  }

  lines.push(`## ASCII view`)
  lines.push(``)
  lines.push('```')
  lines.push(rec.asciiView)
  lines.push('```')
  lines.push(``)

  if (rec.stdinSequence && rec.stdinSequence.length > 0) {
    lines.push(`## Stdin sequence (minimal repro)`)
    lines.push(``)
    lines.push('```json')
    lines.push(JSON.stringify(rec.stdinSequence, null, 2))
    lines.push('```')
    lines.push(``)
  }

  writeFileSync(filePath, lines.join('\n'), 'utf8')
  return filePath
}
