// test/tui/PromptInput.cursor.test.tsx
//
// Regression coverage for the native terminal cursor. The prompt used to draw
// a fake inverse-space cursor but never declared a real Ink cursor position, so
// terminal emulators left the blinking cursor at the bottom-right of the frame.

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const cursorMock = vi.hoisted(() => ({
  setCursorPosition: vi.fn(),
}))

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>()
  return {
    ...actual,
    useCursor: () => ({ setCursorPosition: cursorMock.setCursorPosition }),
  }
})

import { render } from 'ink-testing-library'
import { PromptInput } from '../../src/tui/PromptInput/PromptInput'

const flushInk = async (): Promise<void> => {
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
}

describe('PromptInput terminal cursor', () => {
  beforeEach(() => {
    cursorMock.setCursorPosition.mockClear()
  })

  it('declares the native terminal cursor at the editable prompt cell', async () => {
    const handle = render(
      <PromptInput
        value="hello"
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={false}
        focused
      />,
    )
    try {
      await flushInk()

      const declaredPositions = cursorMock.setCursorPosition.mock.calls
        .map(([position]) => position)
        .filter((position): position is { x: number; y: number } => position !== undefined)

      expect(declaredPositions.length).toBeGreaterThan(0)
      expect(declaredPositions.at(-1)).toEqual({
        x: expect.any(Number),
        y: expect.any(Number),
      })
      expect(declaredPositions.at(-1)!.x).toBeGreaterThanOrEqual(7)
    } finally {
      handle.unmount()
    }
  })

  it('clears the native terminal cursor declaration when disabled', async () => {
    const handle = render(
      <PromptInput
        value="hello"
        onChange={() => {}}
        onSubmit={() => {}}
        disabled
        focused={false}
      />,
    )
    try {
      await flushInk()

      expect(cursorMock.setCursorPosition).toHaveBeenCalledWith(undefined)
    } finally {
      handle.unmount()
    }
  })
})
