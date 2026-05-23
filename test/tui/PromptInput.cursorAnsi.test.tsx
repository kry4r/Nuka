// test/tui/PromptInput.cursorAnsi.test.tsx
//
// Production-mode cursor regression coverage. This test observes Ink's actual
// cursor ANSI suffix instead of mocking useCursor, because the bug is visible
// only after Ink converts the declared position into terminal movement.

import React from 'react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/tui/App'
import { PromptInput } from '../../src/tui/PromptInput/PromptInput'
import { renderWithViewport } from '../../src/core/testing/explorer/L0/render'
import { makeMinimalAppDeps } from '../../src/tui/testing/harness'
import type { InkRenderHandle } from '../../src/core/testing/explorer/types'

const flushInk = async (): Promise<void> => {
  await new Promise(r => setTimeout(r, 50))
}

async function waitForCursorTrace(handle: InkRenderHandle): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (handle.cursorTraces().length > 0) return
    await flushInk()
  }
}

function promptLineIndex(frame: string): number {
  return frame.split('\n').findIndex(line => line.includes('│ >'))
}

function cursorLineIndexFromTrailingNewlineOutput(frame: string, up: number | undefined): number {
  return frame.split('\n').length - (up ?? 0)
}

function cursorLineIndexFromFullscreenOutput(frame: string, up: number | undefined): number {
  return frame.split('\n').length - 1 - (up ?? 0)
}

describe('PromptInput terminal cursor ANSI position', () => {
  it('places the native cursor on the input text row, not the top border', async () => {
    const handle = renderWithViewport(
      <PromptInput
        value="hello"
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={false}
        focused
      />,
      { cols: 80, rows: 24 },
    )

    try {
      await waitForCursorTrace(handle)

      const last = handle.cursorTraces().at(-1)
      expect(last?.positioned).toBe(true)
      expect(cursorLineIndexFromTrailingNewlineOutput(handle.lastFrame(), last?.up))
        .toBe(promptLineIndex(handle.lastFrame()))
    } finally {
      handle.unmount()
    }
  })

  it('keeps the cursor on the prompt row when App fills the viewport', async () => {
    const deps = makeMinimalAppDeps(undefined, {}, process.cwd())
    const handle = renderWithViewport(
      <App
        sessions={deps.sessions}
        slash={deps.slash}
        providers={deps.providers}
        config={deps.config}
        runAgent={async function* () { /* noop */ }}
        permissionBridge={deps.permissionBridge}
        onExit={() => {}}
        onOpenEditor={() => {}}
        compactSession={async () => {}}
        cwd={deps.cwd}
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.0.0-test"
        tools={deps.tools}
        costTracker={deps.costTracker}
      />,
      { cols: 80, rows: 24 },
    )

    try {
      await waitForCursorTrace(handle)

      const frame = handle.lastFrame()
      expect(frame.split('\n')).toHaveLength(24)

      const last = handle.cursorTraces().at(-1)
      expect(last?.positioned).toBe(true)
      expect(cursorLineIndexFromFullscreenOutput(frame, last?.up))
        .toBe(promptLineIndex(frame))
    } finally {
      handle.unmount()
    }
  })
})
