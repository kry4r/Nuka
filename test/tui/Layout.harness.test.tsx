// test/tui/Layout.harness.test.tsx
//
// Phase 12 §4.1 — asserts the four-zone layout in `normal` UIState:
// Conversation (chrome) is hidden when there are no messages (Welcome
// renders raw); Prompt and Status are always visible. The Tasks zone
// is empty in M2 (M3 plumbs Plan/Subagent/Background data) — so the
// collapse summary appears only after Ctrl+T.

import { describe, it, expect } from 'vitest'
import { mountApp } from '../../src/tui/testing/harness'

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

describe('Phase 12 layout', () => {
  it('renders Welcome (raw) + Prompt + Status in a fresh session', async () => {
    const h = mountApp({ target: 'app' })
    try {
      await wait()
      const frame = h.frames().pop() ?? ''
      // Welcome renders raw (no Conversation chrome) when no messages exist.
      expect(frame).toContain('NUKA')
      expect(frame).not.toContain('Conversation')
      // PromptInput visible (the bordered prompt box is part of the
      // chrome — assert presence of the input frame rather than a free-
      // standing `>` line, since ink-testing-library renders the box).
      expect(frame).toMatch(/│ >/)
      // Status panel six-row dense layout — assert two anchor segments.
      expect(frame).toMatch(/⬢ idle/)
      expect(frame).toMatch(/⏱/)
    } finally {
      h.unmount()
    }
  })

  it('Ctrl+T collapses the Tasks zone summary (Tasks data is empty in M2)', async () => {
    const h = mountApp({ target: 'app' })
    try {
      await wait()
      const baseline = h.frames().pop() ?? ''
      // Pre-toggle: no Tasks frame.
      expect(baseline).not.toMatch(/Tasks ▸/)
      // Ctrl+T → tasks-collapsed UIState.
      h.stdin.write('\u0014') // Ctrl+T
      await wait()
      const collapsed = h.frames().pop() ?? ''
      expect(collapsed).toMatch(/Tasks ▸/)
      // Ctrl+T toggles back.
      h.stdin.write('\u0014')
      await wait()
      const back = h.frames().pop() ?? ''
      expect(back).not.toMatch(/Tasks ▸/)
    } finally {
      h.unmount()
    }
  })
})
