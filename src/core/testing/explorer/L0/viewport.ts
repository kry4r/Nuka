// src/core/testing/explorer/L0/viewport.ts
//
// FakeStdout — a writable stream that Ink can use as stdout (debug:false mode),
// capturing writes into liveBuffer / staticBuffer channels.
// See locked spec §4.1.
//
// Static-vs-live classification (ink 6.8, non-debug mode):
//   * Pure-control writes (single escape like ESC[?2026h / ESC[?25l) carry
//     no printable payload and are dropped.
//   * BSR-enable (ESC[?2026h) opens a frame transaction. We clear liveBuffer
//     so subsequent live-frame content overwrites (not appends to) the
//     previous frame; staticBuffer accumulates across frames.
//   * Mixed writes that contain BOTH cursor-positioning escapes (e.g.
//     ESC[2K, ESC[<n>A, ESC[G) AND printable content come from ink's
//     in-place rerender path — they are **live-frame content**, regardless
//     of whether ESC[?25l has been seen yet in this transaction.
//   * Plain-text writes (no ANSI escapes at all) that arrive BEFORE
//     ESC[?25l are Static commits → staticBuffer. After ESC[?25l, plain
//     text is live-frame content.
//
// ESC[?2026h = enable synchronized output (BSR Synchronized Output)
// ESC[?25l   = cursor hide (marks start of live-frame rendering)
// ESC[?25h   = cursor show (marks cleanup)
// ESC[?2026l = disable synchronized output

import { Writable } from 'stream'

const CURSOR_HIDE = '\u001b[?25l' // live-frame start marker
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g
const CURSOR_MOVE_RE = /\u001b\[(?:\d*[ABCDGJKfH]|\d*;\d*[fH]|2K)/

export class FakeStdout extends Writable {
  columns: number
  rows: number
  isTTY = true as const

  liveBuffer = ''
  staticBuffer = ''

  /** True between BSR-enable and the first cursor-hide of a transaction. */
  private _beforeCursorHide = false

  constructor(cols: number, rows: number) {
    super()
    this.columns = cols
    this.rows = rows
  }

  override _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

    if (str === CURSOR_HIDE) {
      this._beforeCursorHide = false
      cb(); return
    }

    // BSR-enable opens a new frame transaction.
    if (str.includes('?2026h')) {
      this._beforeCursorHide = true
      // Reset liveBuffer so the next live-frame write *overwrites* the
      // previous frame. Static commits (already routed to staticBuffer)
      // are untouched.
      // reset: each transaction overwrites; frames() returns latest, not history
      this.liveBuffer = ''
    }

    // Strip ANSI escapes; keep printable residue.
    const stripped = str.replace(ANSI_RE, '')
    if (stripped.length === 0) {
      cb(); return
    }

    // Mixed writes containing cursor-positioning escapes (e.g. ink's
    // in-place rerender `[2K[1A[2K[GBROKEN\n`) are live-frame content
    // even before ESC[?25l in the same transaction.
    const looksLikeRedraw = CURSOR_MOVE_RE.test(str)

    if (!looksLikeRedraw && this._beforeCursorHide) {
      this.staticBuffer += stripped
    } else {
      this.liveBuffer += stripped
    }
    cb()
  }

  clear(): void {
    this.liveBuffer = ''
    this.staticBuffer = ''
    this._beforeCursorHide = false
  }

  resize(cols: number, rows: number): void {
    this.columns = cols
    this.rows = rows
    // Ink listens for the 'resize' event on the stdout stream
    this.emit('resize')
  }

  // ink checks for hasColors / isColorSupported — provide truthy shim
  hasColors(): boolean { return true }
}
