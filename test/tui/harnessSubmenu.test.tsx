// test/tui/harnessSubmenu.test.tsx
//
// Phase 14d — HarnessSubmenu unit tests.
//
// Drives the component via ink-testing-library, asserting the four
// callback wirings (Mode / Stage / Transition / Retriage) and the
// internal subpage state machine (menu | mode-list | transition-list
// | error).

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import { HarnessSubmenu, type HarnessSubmenuProps } from '../../src/tui/Submenu/harness/HarnessSubmenu'
import { ThemeProvider } from '../../src/core/theme/context'
import { resolveTheme } from '../../src/core/theme/themes'
import type { HarnessStage } from '../../src/core/harness/types'

const flush = () => new Promise(r => setImmediate(r))
const flushAll = async () => {
  for (let i = 0; i < 4; i++) await flush()
}

const ALL_STAGES: readonly HarnessStage[] = [
  'brainstorm', 'spec', 'plan', 'search', 'implement', 'review', 'recap',
] as const

const theme = resolveTheme('default-dark')

function renderSubmenu(overrides: Partial<HarnessSubmenuProps> = {}) {
  const props: HarnessSubmenuProps = {
    snapshot: { mode: 'deep', stage: 'plan', sessionId: 's1' },
    availableStages: ALL_STAGES,
    onSetMode: () => {},
    onTransition: async () => {},
    onRetriage: () => {},
    onClose: () => {},
    ...overrides,
  }
  return render(
    <ThemeProvider theme={theme}>
      <HarnessSubmenu {...props} />
    </ThemeProvider>,
  )
}

describe('HarnessSubmenu', () => {
  it('renders top-level menu with Mode / Stage / Transition / Retriage rows', () => {
    const { lastFrame } = renderSubmenu()
    const f = lastFrame() ?? ''
    expect(f).toContain('Harness')
    expect(f).toContain('Mode')
    expect(f).toContain('Stage')
    expect(f).toContain('Transition')
    expect(f).toContain('Retriage')
    // Mode value displayed.
    expect(f).toContain('deep')
    // Current stage value displayed.
    expect(f).toContain('plan')
  })

  it('Stage row is disabled — Enter on it is a no-op', async () => {
    const onSetMode = vi.fn()
    const onTransition = vi.fn()
    const onRetriage = vi.fn()
    const onClose = vi.fn()
    const { stdin } = renderSubmenu({ onSetMode, onTransition, onRetriage, onClose })
    // Move down to Stage row (index 1).
    stdin.write('\u001B[B')
    await flushAll()
    stdin.write('\r')
    await flushAll()
    expect(onSetMode).not.toHaveBeenCalled()
    expect(onTransition).not.toHaveBeenCalled()
    expect(onRetriage).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('selecting Mode navigates into the 3-item mode list', async () => {
    const { lastFrame, stdin } = renderSubmenu()
    // Top-level cursor is on Mode (index 0). Enter to descend.
    stdin.write('\r')
    await flushAll()
    const f = lastFrame() ?? ''
    expect(f).toContain('Harness · Mode')
    expect(f).toContain('deep')
    expect(f).toContain('fast')
    expect(f).toContain('off')
    // Active marker present for current mode.
    expect(f).toContain('(active)')
  })

  it('selecting a mode calls onSetMode and returns to menu', async () => {
    const onSetMode = vi.fn()
    const { lastFrame, stdin } = renderSubmenu({ onSetMode })
    // Open Mode list.
    stdin.write('\r')
    await flushAll()
    // Move down to "fast" (index 1).
    stdin.write('\u001B[B')
    await flushAll()
    stdin.write('\r')
    await flushAll()
    expect(onSetMode).toHaveBeenCalledTimes(1)
    expect(onSetMode).toHaveBeenCalledWith('fast')
    // Back on top-level menu.
    const f = lastFrame() ?? ''
    expect(f).toContain('Mode')
    expect(f).toContain('Retriage')
  })

  it('selecting Transition navigates into the stage list (current stage filtered out)', async () => {
    const { lastFrame, stdin } = renderSubmenu({
      snapshot: { mode: 'deep', stage: 'plan', sessionId: 's1' },
    })
    // Move down to Transition (index 2).
    stdin.write('\u001B[B')
    await flushAll()
    stdin.write('\u001B[B')
    await flushAll()
    stdin.write('\r')
    await flushAll()
    const f = lastFrame() ?? ''
    expect(f).toContain('Harness · Transition')
    expect(f).toContain('brainstorm')
    expect(f).toContain('implement')
    // Current stage excluded from list rows (still appears in title? title is just "Transition")
    const planLines = f.split('\n').filter(l => /\bplan\b/.test(l))
    expect(planLines.length).toBe(0)
  })

  it('selecting a stage calls onTransition; rejection flashes error then returns to menu', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const onTransition = vi.fn().mockRejectedValue(new Error('refused: forbidden by profile×difficulty'))
      const { lastFrame, stdin } = renderSubmenu({ onTransition })
      // Navigate: down twice to Transition, Enter.
      stdin.write('\u001B[B')
      await flushAll()
      stdin.write('\u001B[B')
      await flushAll()
      stdin.write('\r')
      await flushAll()
      // Pick first stage in the filtered list (brainstorm) — Enter at top.
      stdin.write('\r')
      await flushAll()
      expect(onTransition).toHaveBeenCalledTimes(1)
      expect(onTransition).toHaveBeenCalledWith('brainstorm')
      // Error flash visible.
      const fErr = lastFrame() ?? ''
      expect(fErr).toContain('refused')
      // Advance past 1.5s — auto-pop back to menu.
      vi.advanceTimersByTime(1600)
      await flushAll()
      const fMenu = lastFrame() ?? ''
      expect(fMenu).toContain('Retriage')
    } finally {
      vi.useRealTimers()
    }
  })

  it('successful transition returns to menu without error flash', async () => {
    const onTransition = vi.fn().mockResolvedValue(undefined)
    const { lastFrame, stdin } = renderSubmenu({ onTransition })
    stdin.write('\u001B[B')
    await flushAll()
    stdin.write('\u001B[B')
    await flushAll()
    stdin.write('\r')
    await flushAll()
    stdin.write('\r')
    await flushAll()
    expect(onTransition).toHaveBeenCalledTimes(1)
    const f = lastFrame() ?? ''
    expect(f).toContain('Retriage')
    expect(f).not.toMatch(/refused/i)
  })

  it('Retriage row calls onRetriage AND onClose', async () => {
    const onRetriage = vi.fn()
    const onClose = vi.fn()
    const { stdin } = renderSubmenu({ onRetriage, onClose })
    // Move to last item (index 3 = Retriage).
    for (let i = 0; i < 3; i++) {
      stdin.write('\u001B[B')
      await flushAll()
    }
    stdin.write('\r')
    await flushAll()
    expect(onRetriage).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc on top-level menu calls onClose', async () => {
    const onClose = vi.fn()
    const { stdin } = renderSubmenu({ onClose })
    stdin.write('\u001B') // Esc
    await flushAll()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc on mode-list pops back to menu (does NOT call onClose)', async () => {
    const onClose = vi.fn()
    const { lastFrame, stdin } = renderSubmenu({ onClose })
    // Open mode list.
    stdin.write('\r')
    await flushAll()
    expect(lastFrame() ?? '').toContain('Harness · Mode')
    // Esc — pop back.
    stdin.write('\u001B')
    await flushAll()
    expect(onClose).not.toHaveBeenCalled()
    expect(lastFrame() ?? '').not.toContain('Harness · Mode')
  })
})
