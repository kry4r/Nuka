// test/core/testing/explorer/L0/render.test.ts
//
// M1.T1 — renderWithViewport + FakeStdout tests (RED until impl lands)

import { describe, it, expect } from 'vitest'
import React from 'react'
import { Text } from 'ink'

// Will fail with "Cannot find module" until L0/render.ts is created
import { renderWithViewport } from '../../../../../src/core/testing/explorer/L0/render'

describe('renderWithViewport — FakeStdout + InkRenderHandle', () => {
  it('mounts <Text>hi</Text> at cols=40; lastFrame width ≤ 40', async () => {
    const handle = renderWithViewport(React.createElement(Text, null, 'hi'), { cols: 40, rows: 10 })
    // Wait one tick for ink to render
    await new Promise(r => setImmediate(r))
    const frame = handle.lastFrame()
    expect(frame).toBeTruthy()
    // Every line must be ≤ 40 chars wide
    for (const line of frame.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40)
    }
    handle.unmount()
  })

  it('resize(120, 20) triggers a re-render with new cols reported', async () => {
    const handle = renderWithViewport(React.createElement(Text, null, 'test'), { cols: 40, rows: 10 })
    await new Promise(r => setImmediate(r))
    handle.resize(120, 20)
    await new Promise(r => setImmediate(r))
    // After resize the grid should reflect the new cols
    const grid = handle.grid()
    expect(grid.cols).toBe(120)
    expect(grid.rows).toBe(20)
    handle.unmount()
  })

  it('unmount() flushes pending writes without throwing', async () => {
    const handle = renderWithViewport(React.createElement(Text, null, 'bye'), { cols: 40, rows: 10 })
    await new Promise(r => setImmediate(r))
    expect(() => handle.unmount()).not.toThrow()
    // frames collected before unmount are still accessible
    expect(handle.frames().length).toBeGreaterThan(0)
  })
})
