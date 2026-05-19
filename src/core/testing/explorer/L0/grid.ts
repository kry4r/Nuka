// src/core/testing/explorer/L0/grid.ts
//
// AnsiGrid — parse an ANSI terminal frame into a positional grid of cells.
// See locked spec §4.1 (Cell / Box / AnsiGrid shapes) and §4.2.
//
// parse() steps:
//   1. strip-ansi → plain text; concurrent SGR state machine over original.
//   2. Walk char-by-char with string-width to allocate 1 or 2 cells.
//   3. Wrap rows at `cols` (catches PromptInput overrun).
//   4. Detect boxes by tracing connected box-drawing characters.
//   5. Compute SHA-256 of asciiView for cache keying.

import { createHash } from 'crypto'
import stripAnsi from 'strip-ansi'
import { stringWidth } from '../common/stringWidth'
import type { Cell, Box, AnsiGrid as AnsiGridType, Viewport } from '../types'

// ---------------------------------------------------------------------------
// Box-drawing character sets
// ---------------------------------------------------------------------------

// Unicode box-drawing block: U+2500–U+257F
const BOX_CHARS = new Set<string>([
  '─','━','│','┃','┄','┅','┆','┇','┈','┉','┊','┋','┌','┍','┎','┏',
  '┐','┑','┒','┓','└','┕','┖','┗','┘','┙','┚','┛','├','┝','┞','┟',
  '┠','┡','┢','┣','┤','┥','┦','┧','┨','┩','┪','┫','┬','┭','┮','┯',
  '┰','┱','┲','┳','┴','┵','┶','┷','┸','┹','┺','┻','┼','┽','┾','┿',
  '╀','╁','╂','╃','╄','╅','╆','╇','╈','╉','╊','╋','╌','╍','╎','╏',
  '═','║','╒','╓','╔','╕','╖','╗','╘','╙','╚','╛','╜','╝','╞','╟',
  '╠','╡','╢','╣','╤','╥','╦','╧','╨','╩','╪','╫','╬','╭','╮','╯','╰',
])

function isBoxChar(ch: string): boolean {
  return BOX_CHARS.has(ch)
}

// ---------------------------------------------------------------------------
// SGR (Select Graphic Rendition) state machine — parse ANSI escape codes
// ---------------------------------------------------------------------------
type SgrState = {
  fg?: string
  bg?: string
  bold: boolean
  dim: boolean
  underline: boolean
  inverse: boolean
}

function resetSgr(): SgrState {
  return { bold: false, dim: false, underline: false, inverse: false }
}

/** Parse ANSI escape sequences from `ansi` string, returning per-character SGR states. */
function parseSgrStates(ansi: string): SgrState[] {
  const states: SgrState[] = []
  let cur = resetSgr()
  let i = 0
  while (i < ansi.length) {
    if (ansi[i] === '\u001b' && ansi[i + 1] === '[') {
      // Find end of CSI sequence
      let j = i + 2
      while (j < ansi.length && (ansi[j]! < '@' || ansi[j]! > '~')) j++
      const final = ansi[j]
      if (final === 'm') {
        const params = ansi.slice(i + 2, j)
        applySgr(cur, params)
      }
      i = j + 1
    } else {
      // Visible character — record current state
      states.push({ ...cur })
      i++
    }
  }
  return states
}

function applySgr(state: SgrState, params: string): void {
  const codes = params === '' ? ['0'] : params.split(';')
  let k = 0
  while (k < codes.length) {
    const n = Number(codes[k])
    if (n === 0 || Number.isNaN(n)) {
      Object.assign(state, resetSgr())
    } else if (n === 1) { state.bold = true }
    else if (n === 2) { state.dim = true }
    else if (n === 4) { state.underline = true }
    else if (n === 7) { state.inverse = true }
    else if (n === 22) { state.bold = false; state.dim = false }
    else if (n === 24) { state.underline = false }
    else if (n === 27) { state.inverse = false }
    else if (n >= 30 && n <= 37) { state.fg = `ansi${n - 30}` }
    else if (n === 38) {
      // 38;5;n or 38;2;r;g;b
      if (codes[k + 1] === '5') {
        state.fg = `ansi256:${codes[k + 2] ?? '0'}`
        k += 2
      } else if (codes[k + 1] === '2') {
        state.fg = `rgb(${codes[k + 2] ?? 0},${codes[k + 3] ?? 0},${codes[k + 4] ?? 0})`
        k += 4
      }
    }
    else if (n === 39) { delete state.fg }
    else if (n >= 40 && n <= 47) { state.bg = `ansi${n - 40}` }
    else if (n === 48) {
      if (codes[k + 1] === '5') {
        state.bg = `ansi256:${codes[k + 2] ?? '0'}`
        k += 2
      } else if (codes[k + 1] === '2') {
        state.bg = `rgb(${codes[k + 2] ?? 0},${codes[k + 3] ?? 0},${codes[k + 4] ?? 0})`
        k += 4
      }
    }
    else if (n === 49) { delete state.bg }
    else if (n >= 90 && n <= 97) { state.fg = `bright${n - 90}` }
    else if (n >= 100 && n <= 107) { state.bg = `bright${n - 100}` }
    k++
  }
}

// ---------------------------------------------------------------------------
// Box detection — simple pass: find top-left corners and try to trace rects
// ---------------------------------------------------------------------------
type BoxStyle = 'single' | 'double' | 'round' | 'bold'

const CORNERS_SINGLE = new Set(['┌','┐','└','┘'])
const CORNERS_ROUND  = new Set(['╭','╮','╯','╰'])
const CORNERS_BOLD   = new Set(['┏','┓','┗','┛'])
const CORNERS_DOUBLE = new Set(['╔','╗','╚','╝'])

function detectBoxStyle(tl: string): BoxStyle | null {
  if (CORNERS_SINGLE.has(tl)) return 'single'
  if (CORNERS_ROUND.has(tl)) return 'round'
  if (CORNERS_BOLD.has(tl)) return 'bold'
  if (CORNERS_DOUBLE.has(tl)) return 'double'
  return null
}

// Expected top-right and bottom-right corner characters by box style.
// A candidate Box has a verified right edge only when its TR cell is the
// style-matched top-right corner (not merely any box char such as `─`).
// Likewise for the bottom edge via BR.  This discriminates phantom narrow
// boxes (whose TR/BR are edge chars from the real outer border) from genuine
// boxes whose TR/BR are proper corners.
const TR_BY_STYLE: Record<string, string> = { single: '┐', round: '╮', bold: '┓', double: '╗' }
const BL_BY_STYLE: Record<string, string> = { single: '└', round: '╰', bold: '┗', double: '╚' }
const BR_BY_STYLE: Record<string, string> = { single: '┘', round: '╯', bold: '┛', double: '╝' }

function detectBoxesClean(cells: Cell[][], cols: number, rows: number): Box[] {
  const boxes: Box[] = []
  const getChar = (r: number, c: number): string => cells[r]?.[c]?.char ?? ' '

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = getChar(r, c)
      const style = detectBoxStyle(tl)
      if (!style) continue

      // Scan right along top edge to find width
      let w = 1
      while (c + w < cols && isBoxChar(getChar(r, c + w))) w++
      if (w < 2) continue

      const tr = getChar(r, c + w - 1)
      if (!isBoxChar(tr)) continue

      // Scan down along left edge to find height
      let h = 1
      while (r + h < rows && isBoxChar(getChar(r + h, c))) h++
      if (h < 2) continue

      const br = getChar(r + h - 1, c + w - 1)
      const bl = getChar(r + h - 1, c)
      if (isBoxChar(br) && isBoxChar(bl)) {
        // A side is "verified" when its far corner is the style-matched corner
        // character (not just any box char).  Phantom narrow boxes arise when
        // the scan stops early and the far corner cell is actually an edge char
        // (e.g. `─`) from the real outer border — those are not real corners.
        const verifiedRight  = tr === TR_BY_STYLE[style] && br === BR_BY_STYLE[style]
        const verifiedBottom = bl === BL_BY_STYLE[style] && br === BR_BY_STYLE[style]

        boxes.push({
          x: c, y: r, w, h, style,
          verifiedSides: { top: true, right: verifiedRight, bottom: verifiedBottom, left: true },
        })
      }
    }
  }
  return boxes
}

// ---------------------------------------------------------------------------
// AnsiGrid.parse — main entry point (value object with static method)
// ---------------------------------------------------------------------------
export const AnsiGrid = {
  parse(ansiStr: string, viewport: Viewport): AnsiGridType {
    const { cols, rows } = viewport
    const plain = stripAnsi(ansiStr)
    const sgrStates = parseSgrStates(ansiStr)

    // Build a 2D cell grid, rows × cols, default to space
    const cells: Cell[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ char: ' ', width: 1 as const }))
    )

    let row = 0
    let col = 0
    let sgrIdx = 0  // index into sgrStates (one per visible char in ansiStr)

    for (const ch of plain) {
      if (ch === '\n') {
        row++
        col = 0
        sgrIdx++  // newline is a visible char in plain but we skip SGR
        continue
      }
      if (ch === '\r') {
        col = 0
        continue
      }

      const sgr = sgrStates[sgrIdx] ?? resetSgr()
      sgrIdx++

      if (row >= rows) break

      const w = stringWidth(ch) as 0 | 1 | 2

      if (col + w > cols) {
        // Wrap to next row
        row++
        col = 0
        if (row >= rows) break
      }

      if (w === 0) {
        // Combining char — attach to previous cell if possible
        if (col > 0) {
          const prev = cells[row]![col - 1]!
          prev.char += ch
        }
        continue
      }

      const cell: Cell = {
        char: ch,
        width: w,
        ...(sgr.fg ? { fg: sgr.fg } : {}),
        ...(sgr.bg ? { bg: sgr.bg } : {}),
        ...(sgr.bold ? { bold: true } : {}),
        ...(sgr.dim ? { dim: true } : {}),
        ...(sgr.underline ? { underline: true } : {}),
        ...(sgr.inverse ? { inverse: true } : {}),
      }
      cells[row]![col] = cell

      if (w === 2 && col + 1 < cols) {
        // Wide char occupies next cell too — mark as zero-width continuation
        cells[row]![col + 1] = { char: '', width: 0 }
      }

      col += w
    }

    // Build asciiView: strip-ansi text padded to cols×rows
    const lines = plain.split('\n')
    const paddedLines: string[] = []
    for (let r = 0; r < rows; r++) {
      const line = lines[r] ?? ''
      // Pad to cols using visible width
      const vw = stringWidth(line)
      const padded = vw < cols ? line + ' '.repeat(cols - vw) : line.slice(0, cols)
      paddedLines.push(padded)
    }
    const asciiView = paddedLines.join('\n')
    const hash = createHash('sha256').update(asciiView).digest('hex')
    const boxes = detectBoxesClean(cells, cols, rows)

    const grid: AnsiGridType = {
      cols,
      rows,
      cells,
      boxes,
      asciiView,
      hash,
      toJSON() {
        return { cols, rows, asciiView, hash, boxes, cells: undefined }
      },
    }
    return grid
  },
}
