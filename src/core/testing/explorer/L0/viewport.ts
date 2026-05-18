// src/core/testing/explorer/L0/viewport.ts
//
// FakeStdout — a writable stream that Ink can use as stdout (debug:false mode),
// capturing writes into liveBuffer / staticBuffer channels.
// See locked spec §4.1.
//
// Static detection heuristic (ink 6.8, non-debug mode):
//   Ink emits Static content as a plain write that arrives BEFORE the
//   ESC[?25l (cursor-hide) sequence that precedes each live-frame repaint.
//   We classify writes as follows:
//     - "mode-set" write (ESC[?2026h / ESC[?25l / ESC[?25h / ESC[?2026l) → control, skip
//     - plain text write following ESC[?2026h but before ESC[?25l → staticBuffer
//     - plain text write following ESC[?25l → liveBuffer (live frame content)
//
// ESC[?2026h = enable synchronized output (BSR Synchronized Output)
// ESC[?25l   = cursor hide (marks start of live-frame rendering)
// ESC[?25h   = cursor show (marks cleanup)
// ESC[?2026l = disable synchronized output

import { Writable } from 'stream'

const CTRL_WRITE_RE = /^\u001b\[/   // any write starting with ESC[  = control
const CURSOR_HIDE   = '\u001b[?25l' // live-frame start marker

export class FakeStdout extends Writable {
  columns: number
  rows: number
  isTTY = true as const

  liveBuffer = ''
  staticBuffer = ''

  /** Internal: true while we are in the "between BSR and cursor-hide" window */
  private _inStaticWindow = false

  constructor(cols: number, rows: number) {
    super()
    this.columns = cols
    this.rows = rows
  }

  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

    if (str === CURSOR_HIDE) {
      // Cursor-hide: any subsequent plain writes are live-frame content
      this._inStaticWindow = false
      cb(); return
    }

    if (CTRL_WRITE_RE.test(str)) {
      // Other control write (ESC[?2026h, ESC[?2026l, ESC[?25h, etc.)
      // BSR enable opens the static window
      if (str.includes('?2026h')) this._inStaticWindow = true
      cb(); return
    }

    // Plain-text content write
    if (this._inStaticWindow) {
      this.staticBuffer += str
    } else {
      this.liveBuffer += str
    }
    cb()
  }

  clear(): void {
    this.liveBuffer = ''
    this.staticBuffer = ''
    this._inStaticWindow = false
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
