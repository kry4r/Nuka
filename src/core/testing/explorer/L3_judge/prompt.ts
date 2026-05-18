// src/core/testing/explorer/L3_judge/prompt.ts
//
// L3' Judge — prompt builders for the two-tier dispatch.
// See locked spec §4.5 prompt requirements.
//
// Two builders:
//   * buildHaikuPrompt — terse, optimized for a fast yes/no triage.
//   * buildOpusPrompt  — precise, includes the invariant taxonomy from
//                        spec §4.2 so Opus can emit structured violations.
//
// Both prompts cap the rendered asciiView so the total prompt body stays
// ≤ 6 KB even at the 200×50 stress viewport (raw view alone is ~10 KB).
// The cap is enforced by `clipView()`: the head and tail of the view are
// preserved (head shows the top border + first rows; tail shows the bottom
// border) with an ellipsis marker in the middle.

import type { Viewport } from '../types'

/** Input shape consumed by both prompt builders. */
export type JudgeInput = {
  componentName: string
  caseName: string
  viewport: Viewport
  asciiView: string
  mustContain?: string[]
  expectsHugContent?: boolean
}

/** Hard cap on the asciiView portion alone. Leaves ~2 KB headroom for
 *  surrounding system+user text in either prompt. */
const MAX_VIEW_BYTES = 4096

/** Cap on bytes per asciiView line when clipping (keeps a wide stress view
 *  from blowing through MAX_VIEW_BYTES with just two rows). */
const MAX_LINE_BYTES = 120

/**
 * Clip an asciiView so the resulting block stays ≤ MAX_VIEW_BYTES.
 *
 * Strategy:
 *   1. If the raw view fits, return it unchanged.
 *   2. Otherwise, truncate each line to MAX_LINE_BYTES (preserves the
 *      left edge which is where borders live).
 *   3. If still too large, keep the first N and last M rows with a
 *      single "... <K rows clipped> ..." marker between them.
 */
function clipView(view: string): string {
  if (Buffer.byteLength(view, 'utf8') <= MAX_VIEW_BYTES) return view

  const rawLines = view.split('\n')
  const lines = rawLines.map((l) =>
    Buffer.byteLength(l, 'utf8') > MAX_LINE_BYTES
      ? l.slice(0, MAX_LINE_BYTES - 1) + '…'
      : l,
  )
  let joined = lines.join('\n')
  if (Buffer.byteLength(joined, 'utf8') <= MAX_VIEW_BYTES) return joined

  // Still too big — keep head + tail rows. Binary-search for the row
  // budget. Reserve ~30 bytes for the clipped-rows marker.
  let head = Math.floor(lines.length / 4)
  let tail = Math.floor(lines.length / 4)
  while (head + tail < lines.length) {
    const marker = `… <${lines.length - head - tail} rows clipped> …`
    const candidate =
      lines.slice(0, head).join('\n') + '\n' + marker + '\n' + lines.slice(-tail).join('\n')
    if (Buffer.byteLength(candidate, 'utf8') <= MAX_VIEW_BYTES) {
      joined = candidate
      // try to grow proportionally; bail out once we can't fit any larger
      const nextHead = head + 1
      const nextTail = tail + 1
      const nextMarker = `… <${lines.length - nextHead - nextTail} rows clipped> …`
      const next =
        lines.slice(0, nextHead).join('\n') +
        '\n' +
        nextMarker +
        '\n' +
        lines.slice(-nextTail).join('\n')
      if (Buffer.byteLength(next, 'utf8') > MAX_VIEW_BYTES) return joined
      head = nextHead
      tail = nextTail
    } else {
      head = Math.max(1, head - 1)
      tail = Math.max(1, tail - 1)
      if (head === 1 && tail === 1) {
        // last-resort: just head + marker
        const marker2 = `… <${lines.length - 2} rows clipped> …`
        return lines[0] + '\n' + marker2 + '\n' + lines[lines.length - 1]
      }
    }
  }
  return joined
}

function formatMeta(input: JudgeInput): string {
  const parts: string[] = []
  if (input.mustContain && input.mustContain.length > 0) {
    parts.push(`mustContain: ${JSON.stringify(input.mustContain)}`)
  }
  if (input.expectsHugContent !== undefined) {
    parts.push(`expectsHugContent (frame should hug its content): ${input.expectsHugContent}`)
  }
  return parts.length > 0 ? parts.join('\n') + '\n' : ''
}

/**
 * Build the Haiku quick-pass prompt — terse yes/no triage.
 * Body is intentionally short; Haiku only needs to decide whether
 * structural issues exist (Opus does the precise enumeration).
 */
export function buildHaikuPrompt(input: JudgeInput): {
  system: string
  user: string
} {
  const system = [
    'You are a fast structural triage judge for terminal UI grids.',
    'Report only structural problems (overflow, overlap, broken borders,',
    'content escaping the frame, cramped/inflated regions).',
    'Judge structural-only; do not consider color or style.',
    'Respond with a single JSON object: {"issues": boolean, "why": string}.',
  ].join(' ')

  const view = clipView(input.asciiView)
  const user = [
    `Component: ${input.componentName}`,
    `Case: ${input.caseName}`,
    `Viewport: ${input.viewport.cols}x${input.viewport.rows}`,
    formatMeta(input),
    'Grid:',
    '```',
    view,
    '```',
    'Do issues exist? Reply JSON only.',
  ]
    .filter((x) => x !== '')
    .join('\n')

  return { system, user }
}

/**
 * Build the Opus precise-pass prompt — includes invariant definitions
 * and the fail-mode taxonomy from spec §4.5. Opus must emit per-issue
 * objects with rule + short description.
 */
export function buildOpusPrompt(input: JudgeInput): {
  system: string
  user: string
} {
  const system = [
    'You are a precise structural judge for terminal UI grids.',
    'Judge structural-only; do not consider color or style.',
    'Known structural fail modes:',
    '  - overflow: content extends past the declared cols/rows.',
    '  - overlap: two distinct zones occupy the same cells.',
    '  - border bleed: box-drawing characters appear outside the frame.',
    '  - lossy truncation: required text was clipped away.',
    '  - cramped/inflated region: a flex zone is starved or unbounded.',
    'For each issue, output JSON: {"invariant": "...", "description": "..."}.',
    'If no issues, output {"issues": []}.',
  ].join('\n')

  const view = clipView(input.asciiView)
  const user = [
    `Component: ${input.componentName}`,
    `Case: ${input.caseName}`,
    `Viewport (cols x rows): ${input.viewport.cols}x${input.viewport.rows}`,
    formatMeta(input),
    'Rendered grid:',
    '```',
    view,
    '```',
    'Enumerate every structural issue using the JSON object form above.',
    'Group output as: {"issues": [ ... ]}.',
  ]
    .filter((x) => x !== '')
    .join('\n')

  return { system, user }
}
