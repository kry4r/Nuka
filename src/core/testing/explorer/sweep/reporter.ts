// src/core/testing/explorer/sweep/reporter.ts
//
// ASCII summary table for `nuka explore sweep` output.
// Follows plan M2.T4: fixture/case/profile/violations columns, ANSI colours,
// trailing "N passed, M failed" line.

import type { SweepResult, FailureRecord } from '../types'

// ANSI colour helpers (no external dep — these are plain escape codes)
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

function pass(s: string) { return `${GREEN}${s}${RESET}` }
function fail(s: string) { return `${RED}${s}${RESET}` }
function bold(s: string) { return `${BOLD}${s}${RESET}` }
function dim(s: string) { return `${DIM}${s}${RESET}` }

/** Pad a string to width (left-aligned). */
function col(s: string, w: number): string {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '')
  const pad = Math.max(0, w - plain.length)
  return s + ' '.repeat(pad)
}

/** Format a single run-result line for the summary table. */
type RunRow = {
  fixture: string
  caseName: string
  profile: string
  failed: boolean
  violations: number
}

/**
 * Render a summary table from the sweep result to a multi-line string.
 */
export function formatSummary(result: SweepResult, allRows: RunRow[]): string {
  const lines: string[] = []

  // Header
  lines.push('')
  lines.push(
    bold(col('Fixture', 28)) +
    bold(col('Case', 20)) +
    bold(col('Viewport', 12)) +
    bold(col('Result', 8)) +
    bold('Violations'),
  )
  lines.push(dim('─'.repeat(76)))

  for (const row of allRows) {
    const resultCell = row.failed ? fail('FAIL') : pass('PASS')
    const violCell = row.violations > 0 ? fail(String(row.violations)) : dim('0')
    lines.push(
      col(row.fixture, 28) +
      col(row.caseName, 20) +
      col(row.profile, 12) +
      col(resultCell, 8) +
      violCell,
    )
  }

  lines.push(dim('─'.repeat(76)))

  // Footer totals
  const passedStr = pass(`${result.passed} passed`)
  const failedStr = result.failed > 0 ? fail(`${result.failed} failed`) : dim('0 failed')
  lines.push(`${passedStr}, ${failedStr}  (${result.totalRuns} total)`)
  lines.push('')

  return lines.join('\n')
}

/**
 * Build the per-run row list from failure records + total count.
 * We don't have per-pass records, so we reconstruct: all runs minus failures.
 * Returns rows for all failures; pass rows are implied by total - failures.
 */
export function buildRunRows(result: SweepResult): RunRow[] {
  return result.records.map((rec: FailureRecord) => ({
    fixture: rec.component,
    caseName: rec.fixtureCase,
    profile: `${rec.viewport.cols}×${rec.viewport.rows}`,
    failed: true,
    violations: rec.violations.length,
  }))
}
