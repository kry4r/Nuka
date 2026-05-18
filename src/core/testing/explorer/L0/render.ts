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
  // In debug:true mode each write() call in ink appends a single rendered
  // frame.  Frames are separated by '\n\n' (double newline) or just accumulated
  // — treat the entire buffer as a collection of writes.
  // For simplicity we split on double-newline boundaries and return non-empty.
  const parts = buf.split('\n\n')
  const frames: string[] = []
  for (const part of parts) {
    const stripped = stripAnsi(part).trim()
    if (stripped) frames.push(stripped)
  }
  // Fallback: if no double-newline boundaries, treat whole buffer as one frame
  if (frames.length === 0) {
    const stripped = stripAnsi(buf).trim()
    if (stripped) frames.push(stripped)
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

  // Use ink's render() with debug:true so writes are plain text (no escape codes
  // for cursor positioning).  This mirrors what ink-testing-library does.
  const inst = inkRender(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    debug: true,
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
