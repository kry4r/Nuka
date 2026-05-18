// src/core/testing/explorer/L0/render.ts
//
// renderWithViewport — mounts an Ink React tree against a FakeStdout with
// explicit cols×rows dimensions and returns an InkRenderHandle.
// See locked spec §4.1.

import React from 'react'
import { render as inkRender } from 'ink'
import { EventEmitter } from 'events'
import { FakeStdout } from './viewport'
import { AnsiGrid } from './grid'
import type { InkRenderHandle, Viewport } from '../types'
import stripAnsi from 'strip-ansi'

// ---------------------------------------------------------------------------
// MockStdin — mimics ink-testing-library's Stdin shim
// ---------------------------------------------------------------------------
class MockStdin extends EventEmitter {
  isTTY = true as const
  data: string | null = null

  write(data: string): void {
    this.data = data
    this.emit('readable')
    this.emit('data', data)
  }

  // ink's App listens on 'readable' and pulls bytes with stdin.read() —
  // mirrors ink-testing-library's Stdin shim. Without this, useInput
  // components crash on the first keystroke (`stdin.read is not a function`).
  read(): string | null {
    const { data } = this
    this.data = null
    return data
  }

  setEncoding(): void { /* noop */ }
  setRawMode(): void { /* noop */ }
  resume(): void { /* noop */ }
  pause(): void { /* noop */ }
  ref(): void { /* noop */ }
  unref(): void { /* noop */ }
}

// ---------------------------------------------------------------------------
// splitFrames — split liveBuffer into individual frame strings
// ---------------------------------------------------------------------------
function splitFrames(buf: string): string[] {
  if (!buf) return []
  // In debug:false mode, ink writes each frame as a plain-text string.
  // Multiple frames accumulate in liveBuffer separated by newlines.
  // Each frame string already ends with '\n'; we split and filter empty.
  const stripped = stripAnsi(buf)
  const frames: string[] = []
  // Split on newline sequences — each non-empty portion is a frame "snapshot"
  // For our purposes the whole buffer content is the last frame's text.
  // Use \n\n as boundary (ink renders a double-newline between frames when
  // multiple repaints occur) with single-newline fallback.
  const parts = stripped.split('\n\n')
  for (const part of parts) {
    const t = part.trim()
    if (t) frames.push(t)
  }
  if (frames.length === 0) {
    const t = stripped.trim()
    if (t) frames.push(t)
  }
  return frames
}

// ---------------------------------------------------------------------------
// lastSnapshot — get the most recent visible frame
// ---------------------------------------------------------------------------
function lastSnapshot(buf: string): string {
  const frames = splitFrames(buf)
  return frames[frames.length - 1] ?? ''
}

// ---------------------------------------------------------------------------
// renderWithViewport
// ---------------------------------------------------------------------------
export function renderWithViewport(
  node: React.ReactElement,
  viewport: Viewport,
  opts?: { stdin?: MockStdin },
): InkRenderHandle {
  const stdout = new FakeStdout(viewport.cols, viewport.rows)
  const stderr = new FakeStdout(viewport.cols, viewport.rows)
  const stdin = opts?.stdin ?? new MockStdin()

  // Apply setRawMode shim on process.stdin if missing (CI / vitest hosts)
  const stdinAny = process.stdin as { setRawMode?: (m: boolean) => unknown; isTTY?: boolean }
  if (stdinAny.setRawMode === undefined) {
    stdinAny.setRawMode = () => process.stdin
  }

  // Use ink's render() with debug:false (production mode) so we get real ANSI
  // output and can intercept Static commits via FakeStdout._inStaticWindow.
  const inst = inkRender(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    debug: false,
  })

  let currentViewport = { ...viewport }

  return {
    frames: () => splitFrames(stdout.liveBuffer),
    lastFrame: () => lastSnapshot(stdout.liveBuffer),
    staticWrites: () => stdout.staticBuffer.split('\n').filter(Boolean),
    grid: (frame?: string) =>
      AnsiGrid.parse(frame ?? lastSnapshot(stdout.liveBuffer), currentViewport),
    stdin: { write: (s: string) => stdin.write(s) },
    resize: (cols: number, rows: number) => {
      currentViewport = { cols, rows }
      stdout.resize(cols, rows)
      stderr.resize(cols, rows)
      inst.rerender(node)
    },
    unmount: () => {
      inst.unmount()
    },
  }
}
