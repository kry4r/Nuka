// src/core/stats/chart.ts
// Phase 8 §4.2 — ASCII bar chart for tokens-by-model.
//
// chart(byModel, width) returns an array of strings, one per model, with a
// proportional filled bar (Unicode block), token count, and USD.

import type { ModelStats } from './aggregate'

const BAR_CHAR = '█'

/**
 * Format token count compactly (e.g. "3.2M", "800k", "400").
 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

/**
 * Format USD compactly (e.g. "$9.20", "$0.30").
 */
function fmtUsd(usd: number): string {
  return '$' + usd.toFixed(2)
}

/**
 * Build ASCII bar chart lines from a `byModel` map.
 *
 * @param byModel  Map of model name → { tokens, usd }
 * @param width    Total line width budget (default 60). The bar portion is
 *                 allocated after the label is sized.
 * @returns        Array of lines, one per model, sorted by tokens descending.
 *                 Returns `['(no data yet)']` when the map is empty.
 */
export function chart(byModel: Map<string, ModelStats>, width = 60): string[] {
  if (byModel.size === 0) return ['(no data yet)']

  // Sort by tokens descending
  const entries = [...byModel.entries()].sort((a, b) => b[1].tokens - a[1].tokens)
  const maxTokens = entries[0]![1].tokens

  // Fixed-width label column (widest model name)
  const maxLabelLen = Math.max(...entries.map(([name]) => name.length))
  // Right side: "  1.2M  $9.20" — reserve ~16 chars
  const SUFFIX_LEN = 16
  const barWidth = Math.max(4, width - maxLabelLen - SUFFIX_LEN - 2)

  return entries.map(([name, stats]) => {
    const filled = maxTokens > 0 ? Math.round((stats.tokens / maxTokens) * barWidth) : 0
    const bar = BAR_CHAR.repeat(filled).padEnd(barWidth, ' ')
    const label = name.padEnd(maxLabelLen)
    const suffix = ` ${fmtTokens(stats.tokens).padStart(5)}  ${fmtUsd(stats.usd)}`
    return `${label} ${bar}${suffix}`
  })
}
