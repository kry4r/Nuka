import React from 'react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/tui/App'
import { StatusPanel } from '../../src/tui/Status/StatusPanel'
import { ToolCall } from '../../src/tui/Messages/ToolCall'
import { renderWithViewport } from '../../src/core/testing/explorer/L0/render'
import { runAll } from '../../src/core/testing/explorer/L1'
import { makeMinimalAppDeps } from '../../src/tui/testing/harness'
import type { InkRenderHandle, Viewport } from '../../src/core/testing/explorer/types'

const flushInk = async (): Promise<void> => {
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
}

async function expectNoL1Errors(handle: InkRenderHandle, viewport: Viewport): Promise<void> {
  await flushInk()
  const errors = runAll(handle.grid(), {
    viewport,
    staticWrites: handle.staticWrites(),
    cursorTraces: handle.cursorTraces(),
  }).filter(v => v.severity === 'error')

  expect(errors.map(v => `${v.rule}: ${v.message}`)).toEqual([])
}

async function waitForCursorTrace(handle: InkRenderHandle): Promise<{ positioned: boolean; x?: number }> {
  for (let i = 0; i < 20; i++) {
    const trace = handle.cursorTraces().findLast(cursor => cursor.positioned)
    if (trace) return trace
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for positioned cursor trace')
}

describe('TUI layout guards', () => {
  it('keeps long custom provider and model labels inside the narrow statusline', async () => {
    const handle = renderWithViewport(
      <StatusPanel
        mode="running"
        providerId="custom"
        providerName="VeryLongCustomOpenAICompatibleProviderNameThatWouldNormallyOverflow"
        model="mimo-v2-pro-with-a-very-long-routing-suffix-and-preview-build"
        cwd="/data/xtzhang/Nuka"
        gitBranch={{ branch: 'main', dirty: true }}
        contextUsed={88_000}
        contextMax={100_000}
        inputTokens={59_900}
        outputTokens={186}
        cost={0}
        pluginCount={0}
        sessionPluginCount={0}
        agentInFlight={1}
        hiddenSegments={[]}
        layout="compact"
        iconMode="text"
      />,
      { cols: 50, rows: 8 },
    )
    try {
      await expectNoL1Errors(handle, { cols: 50, rows: 8 })

      const grid = handle.grid()
      expect(grid.asciiView).toContain('VeryLongCustom')
      expect(grid.asciiView).toContain('context:')
    } finally {
      handle.unmount()
    }
  })

  it('keeps bordered tool progress inside a narrow viewport', async () => {
    const handle = renderWithViewport(
      <ToolCall
        name="Bash"
        argSummary="npm test -- a-very-long-filter-that-should-never-break-the-border"
        status="running"
        progressLines={Array.from({ length: 8 }, () => '未截断进度'.repeat(40))}
      />,
      { cols: 54, rows: 12 },
    )
    try {
      await expectNoL1Errors(handle, { cols: 54, rows: 12 })

      const grid = handle.grid()
      expect(grid.asciiView).toContain('Bash')
      expect(grid.boxes.length).toBeGreaterThan(0)
    } finally {
      handle.unmount()
    }
  })

  it('declares a native cursor on the prompt row under viewport rendering', async () => {
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
      const trace = await waitForCursorTrace(handle)
      await expectNoL1Errors(handle, { cols: 80, rows: 24 })

      const frame = handle.lastFrame()
      const promptLine = frame.split('\n').findIndex(line => line.includes('│ >'))
      expect(promptLine).toBeGreaterThanOrEqual(0)
      expect(trace.positioned).toBe(true)
      expect(trace.x).toBeGreaterThan(0)
    } finally {
      handle.unmount()
    }
  })
})
