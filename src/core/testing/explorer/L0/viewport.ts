// src/core/testing/explorer/L0/viewport.ts
//
// FakeStdout — a writable stream that Ink can use as stdout (debug:true mode),
// capturing writes into liveBuffer / staticBuffer channels.
// See locked spec §4.1.
//
// We operate in ink's debug mode (no ANSI escape codes for cursor positioning).
// Each call to write() appends the rendered frame text to liveBuffer.
// Static commits are detected by the staticTap module which wraps the write
// method; static content is segregated into staticBuffer.

import { Writable } from 'stream'

export class FakeStdout extends Writable {
  columns: number
  rows: number
  isTTY = true as const

  liveBuffer = ''
  staticBuffer = ''

  /** When true, the next write is classified as a Static commit */
  _staticPending = false

  constructor(cols: number, rows: number) {
    super()
    this.columns = cols
    this.rows = rows
  }

  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    if (this._staticPending) {
      this.staticBuffer += str
      this._staticPending = false
    } else {
      this.liveBuffer += str
    }
    cb()
  }

  clear(): void {
    this.liveBuffer = ''
    this.staticBuffer = ''
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
