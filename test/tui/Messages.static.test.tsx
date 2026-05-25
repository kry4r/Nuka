// test/tui/Messages.static.test.tsx
//
// Regression coverage for the main transcript. Earlier iterations moved old
// messages through Ink's <Static>, which looked acceptable in debug-mode tests
// but in the real TUI pushed previous turns into terminal scrollback and left
// the newest turn pinned near the top of the live conversation area.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { Text } from 'ink'
import { Messages } from '../../src/tui/Messages/Messages'
import { renderWithViewport } from '../../src/core/testing/explorer/L0/render'
import { staticTap } from '../../src/core/testing/explorer/L0/staticTap'
import type { Message } from '../../src/core/message/types'

function userMsg(id: string, text: string): Message {
  return { role: 'user', id, ts: 1, content: [{ type: 'text', text }] }
}

function assistantMsg(id: string, text: string): Message {
  return { role: 'assistant', id, ts: 2, content: [{ type: 'text', text }] }
}

function assistantToolUse(id: string, toolUseId: string, toolName: string, input: unknown = {}): Message {
  return {
    role: 'assistant',
    id,
    ts: 3,
    content: [{ type: 'tool_use', id: toolUseId, name: toolName, input }],
  }
}

function toolResult(id: string, toolUseId: string, output: string): Message {
  return {
    role: 'tool',
    id,
    ts: 4,
    toolUseId,
    content: output,
    isError: false,
  }
}

const PROLOGUE = <Text>WELCOME-HERO-MARKER</Text>
const flushInk = async (): Promise<void> => {
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
}

describe('Messages — live transcript', () => {
  it('empty messages with prologue stay in the live frame', async () => {
    const handle = renderWithViewport(
      <Messages items={[]} streaming={null} prologue={PROLOGUE} />,
      { cols: 80, rows: 24 },
    )
    try {
      await flushInk()

      expect(staticTap(handle).staticLines).toEqual([])
      expect(handle.lastFrame()).toContain('WELCOME-HERO-MARKER')
    } finally {
      handle.unmount()
    }
  })

  it('keeps previous turns in the live frame instead of terminal Static scrollback', async () => {
    const items: Message[] = [
      userMsg('u1', 'first-msg'),
      userMsg('u2', 'second-msg'),
      userMsg('u3', 'third-msg'),
      userMsg('u4', 'fourth-msg'),
      userMsg('u5', 'fifth-msg'),
    ]
    const handle = renderWithViewport(
      <Messages items={items} streaming={null} prologue={PROLOGUE} />,
      { cols: 80, rows: 24 },
    )
    try {
      await flushInk()

      expect(staticTap(handle).staticLines).toEqual([])
      const f = handle.lastFrame() ?? ''
      expect(f).toContain('first-msg')
      expect(f).toContain('second-msg')
      expect(f).toContain('third-msg')
      expect(f).toContain('fourth-msg')
      expect(f).toContain('fifth-msg')

      const idxFirst = f.indexOf('first-msg')
      const idxFifth = f.indexOf('fifth-msg')
      expect(idxFirst).toBeGreaterThanOrEqual(0)
      expect(idxFirst).toBeLessThan(idxFifth)
    } finally {
      handle.unmount()
    }
  })

  it('adds breathing room between turns without splitting wrapped message lines', async () => {
    const items: Message[] = [
      userMsg('u1', 'alpha-line-1\nalpha-line-2'),
      assistantMsg('a1', 'beta-line-1'),
    ]
    const handle = renderWithViewport(
      <Messages items={items} streaming={null} />,
      { cols: 80, rows: 18 },
    )
    try {
      await flushInk()

      const lines = (handle.lastFrame() ?? '').split('\n')
      const alpha1 = lines.findIndex(line => line.includes('alpha-line-1'))
      const alpha2 = lines.findIndex(line => line.includes('alpha-line-2'))
      const beta = lines.findIndex(line => line.includes('beta-line-1'))

      expect(alpha1).toBeGreaterThanOrEqual(0)
      expect(alpha2).toBe(alpha1 + 1)
      expect(beta).toBe(alpha2 + 2)
      expect(lines[alpha2 + 1]?.trim()).toBe('')
    } finally {
      handle.unmount()
    }
  })

  it('summarizes scroll state without keybinding instructions', async () => {
    const items: Message[] = Array.from({ length: 12 }, (_, i) => (
      userMsg(`u${i + 1}`, `scroll-state-${i + 1}`)
    ))
    const handle = renderWithViewport(
      <Messages items={items} streaming={null} availableRows={6} />,
      { cols: 80, rows: 18 },
    )
    try {
      await flushInk()

      const f = handle.lastFrame() ?? ''
      expect(f).toContain('history:')
      expect(f).toContain('visible')
      expect(f).toContain('older')
      expect(f).not.toMatch(/PageUp|PageDown|PgUp|PgDn|press|use/i)
    } finally {
      handle.unmount()
    }
  })

  it('streaming message in flight stays in the live frame', async () => {
    const items: Message[] = [userMsg('u1', 'historical')]
    const streaming: Message = {
      role: 'assistant',
      id: 'streaming-1',
      ts: 5,
      content: [{ type: 'text', text: 'live-stream-marker' }],
    }
    const handle = renderWithViewport(
      <Messages items={items} streaming={streaming} prologue={PROLOGUE} />,
      { cols: 80, rows: 24 },
    )
    try {
      await flushInk()

      expect(staticTap(handle).staticLines).toEqual([])
      const f = handle.lastFrame() ?? ''
      expect(f).toContain('live-stream-marker')
      expect(f).toContain('historical')
    } finally {
      handle.unmount()
    }
  })

  it('assistant message with unresolved tool_use stays in the live frame', async () => {
    const items: Message[] = [
      userMsg('u1', 'kick-off'),
      assistantToolUse('a1', 'tu-pending', 'someTool'),
      assistantMsg('a2', 'after-tool'),
    ]
    const handle = renderWithViewport(
      <Messages items={items} streaming={null} />,
      { cols: 80, rows: 24 },
    )
    try {
      await flushInk()

      expect(staticTap(handle).staticLines).toEqual([])
      const f = handle.lastFrame() ?? ''
      expect(f).toContain('kick-off')
      expect(f).toContain('someTool')
      expect(f).toContain('after-tool')
    } finally {
      handle.unmount()
    }
  })

  it('resolved tool results remain in the live frame with newer turns', async () => {
    const items: Message[] = [
      userMsg('u1', 'kick-off'),
      assistantToolUse('a1', 'tu-done', 'someTool'),
      toolResult('t1', 'tu-done', 'tool-output-marker'),
      assistantMsg('a2', 'after-tool'),
    ]
    const handle = renderWithViewport(
      <Messages items={items} streaming={null} />,
      { cols: 80, rows: 24 },
    )
    try {
      await flushInk()

      expect(staticTap(handle).staticLines).toEqual([])
      const f = handle.lastFrame() ?? ''
      expect(f).toContain('kick-off')
      expect(f).toContain('someTool')
      expect(f).toContain('after-tool')
      expect(f).toContain('tool-output-marker')
    } finally {
      handle.unmount()
    }
  })

  it('collapses read tool results until that result id is expanded', async () => {
    const longOutput = [
      '1\tconst first = true',
      '2\tconst hiddenReadLine = "should not be visible while collapsed"',
      '3\texport const last = true',
    ].join('\n')
    const items: Message[] = [
      userMsg('u1', 'read request'),
      assistantToolUse('a1', 'read-1', 'Read', { path: '/tmp/example.ts' }),
      toolResult('t1', 'read-1', longOutput),
      assistantMsg('a2', 'after-read'),
    ]

    const collapsed = renderWithViewport(
      <Messages items={items} streaming={null} />,
      { cols: 80, rows: 24 },
    )
    try {
      await flushInk()
      const frame = collapsed.lastFrame() ?? ''
      expect(frame).toContain('Read result: /tmp/example.ts')
      expect(frame).toContain('3 lines collapsed')
      expect(frame).toContain('after-read')
      expect(frame).not.toContain('hiddenReadLine')
    } finally {
      collapsed.unmount()
    }

    const expanded = renderWithViewport(
      <Messages items={items} streaming={null} expandedReadResultIds={new Set(['read-1'])} />,
      { cols: 80, rows: 24 },
    )
    try {
      await flushInk()
      const frame = expanded.lastFrame() ?? ''
      expect(frame).toContain('hiddenReadLine')
      expect(frame).not.toContain('3 lines collapsed')
    } finally {
      expanded.unmount()
    }
  })
})
