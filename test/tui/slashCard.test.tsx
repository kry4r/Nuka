// test/tui/slashCard.test.tsx
//
// Bug A regression test: with the full builtin command set registered, /fork
// must be visible in the command list at first render (selectedIndex=0).
// Previously, when the total number of registered slash commands exceeded
// CommandList's WINDOW_SIZE (10) the sliding window could hide /fork once the
// cursor moved off the top, and even at first render the display surface was
// uncomfortably small.
//
// We exercise the CommandList directly so the assertion does not depend on
// the App harness or unrelated UI chrome.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { CommandList } from '../../src/tui/SlashCard/CommandList'
import { ExitCommand } from '../../src/slash/exit'
import { HelpCommand } from '../../src/slash/help'
import { ClearCommand } from '../../src/slash/clear'
import { NewCommand } from '../../src/slash/new'
import { ForkCommand } from '../../src/slash/fork'
import { BtwCommand } from '../../src/slash/btw'
import { CostCommand } from '../../src/slash/cost'
import { ModelCommand } from '../../src/slash/model'
import { EffortCommand } from '../../src/slash/effort'
import { SettingsCommand } from '../../src/slash/settings'
import { CompactCommand } from '../../src/slash/compact'
import { ResumeCommand } from '../../src/slash/resume'
import { MemdirCommand } from '../../src/slash/memdir'
import { VimCommand } from '../../src/slash/vim'
import { DoctorCommand } from '../../src/slash/doctor'
import { RewindCommand } from '../../src/slash/rewind'
import { TasksCommand } from '../../src/slash/tasks'
import { ThemeCommand } from '../../src/slash/theme'
import { StatsCommand } from '../../src/slash/stats'
import { PlanCommand } from '../../src/slash/plan'
import { IdeCommand } from '../../src/slash/ide'
import { StatusBarCommand } from '../../src/slash/statusBar'
import { SkillCommand } from '../../src/slash/skill'
import { RecapCommand } from '../../src/slash/recap'
import { monitorCommand } from '../../src/slash/monitor'
import type { SlashCommand } from '../../src/slash/types'

const FULL_BUILTINS: SlashCommand[] = [
  ExitCommand, HelpCommand, ClearCommand, NewCommand, ForkCommand, BtwCommand,
  CostCommand, ModelCommand, EffortCommand, SettingsCommand, CompactCommand, ResumeCommand,
  MemdirCommand, VimCommand, DoctorCommand,
  RewindCommand, TasksCommand, ThemeCommand, StatsCommand, PlanCommand, IdeCommand,
  StatusBarCommand, SkillCommand, RecapCommand, monitorCommand,
]

describe('CommandList — /fork visibility', () => {
  it('renders /fork on first render with the full builtin set (selectedIndex=0)', () => {
    const { lastFrame } = render(
      <CommandList commands={FULL_BUILTINS} selectedIndex={0} />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('/fork')
  })

  it('keeps /fork in the visible window for typical cursor positions near the top', () => {
    // /fork is at globalIdx=4 → rowPos=5 (after the "builtins" heading).
    // With WINDOW_SIZE=10 and half=5, the window keeps rowPos=5 in view as
    // long as start ≤ 5, i.e. sel ≤ 9. Once the cursor moves past index 9
    // the user has scrolled deep enough that letting /fork drop off the top
    // is expected pagination behaviour.
    for (const sel of [0, 3, 6, 9]) {
      const { lastFrame } = render(
        <CommandList commands={FULL_BUILTINS} selectedIndex={sel} />,
      )
      const frame = lastFrame() ?? ''
      expect(frame, `selectedIndex=${sel}`).toContain('/fork')
    }
  })

  it('renders every builtin when the list is short enough to fit', () => {
    // Filtered list shorter than the window must show every entry — no
    // pagination chrome should hide candidates.
    const short = FULL_BUILTINS.slice(0, 6)
    const { lastFrame } = render(
      <CommandList commands={short} selectedIndex={0} />,
    )
    const frame = lastFrame() ?? ''
    for (const c of short) {
      expect(frame).toContain('/' + c.name)
    }
    expect(frame).not.toMatch(/more above|more below/)
  })
})
