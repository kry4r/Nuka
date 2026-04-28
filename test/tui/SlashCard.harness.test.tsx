// test/tui/SlashCard.harness.test.tsx
//
// Replaces the old SlashSuggest.harness.test.tsx.
// Verifies that:
//  - Typing `/` shows the grouped command list.
//  - Commands appear in the correct groups.
//  - The dropdown paginates when many commands are registered.
//  - Typing a space after a command name switches to arg-hint mode.
//  - StatusBar / Hud are hidden while the card is open.

import { describe, it, expect } from 'vitest'
import { mountApp } from '../../src/tui/testing/harness'
import { SlashRegistry } from '../../src/slash/registry'
import { HelpCommand } from '../../src/slash/help'
import { ExitCommand } from '../../src/slash/exit'
import { ThemeCommand } from '../../src/slash/theme'

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

describe('SlashCard grouped dropdown', () => {
  it('shows the slash command list when the user types `/`', async () => {
    const slash = new SlashRegistry()
    slash.register(HelpCommand)
    slash.register(ExitCommand)
    slash.register(ThemeCommand)

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      h.stdin.write('/')
      await h.waitFor({ contains: '/help' })
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('/help')
      expect(frame).toContain('/exit')
      expect(frame).toContain('/theme')
    } finally {
      h.unmount()
    }
  })

  it('shows the "builtins" group heading for built-in commands', async () => {
    const slash = new SlashRegistry()
    slash.register({ ...HelpCommand, source: 'builtin' })
    slash.register({ ...ExitCommand, source: 'builtin' })

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      h.stdin.write('/')
      await h.waitFor({ contains: 'builtins' })
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('builtins')
      expect(frame).toContain('/help')
      expect(frame).toContain('/exit')
    } finally {
      h.unmount()
    }
  })

  it('shows plugin and skill group headings when those sources are present', async () => {
    const slash = new SlashRegistry()
    slash.register({ name: 'foo', description: 'a plugin command', source: 'plugin', async run() { return { type: 'text', text: '' } } })
    slash.register({ name: 'bar', description: 'a skill command', source: 'skill', async run() { return { type: 'text', text: '' } } })

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      h.stdin.write('/')
      await h.waitFor({ contains: '/foo' })
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('plugins')
      expect(frame).toContain('skills')
      expect(frame).toContain('/foo')
      expect(frame).toContain('/bar')
    } finally {
      h.unmount()
    }
  })

  it('hides StatusBar / Hud while the submenu is open', async () => {
    const slash = new SlashRegistry()
    slash.register(HelpCommand)
    slash.register(ExitCommand)

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      // Baseline frame includes the StatusPanel rows (mode badge / elapsed / counts).
      const baseline = h.frames().pop() ?? ''
      expect(baseline).toMatch(/⬢ idle|⏱|plugins/)
      // Open the submenu.
      h.stdin.write('/')
      await h.waitFor({ contains: '/help' })
      const open = h.frames().pop() ?? ''
      expect(open).toContain('/help')
      // While open, StatusPanel is replaced — the elapsed-time row is not visible.
      expect(open).not.toMatch(/⏱\s+\d/)
      // Close the submenu.
      h.stdin.write('\u007F') // backspace
      await h.waitFor({ regex: '⬢ idle|⏱|plugins' })
      const closed = h.frames().pop() ?? ''
      expect(closed).toMatch(/⬢ idle|⏱|plugins/)
    } finally {
      h.unmount()
    }
  })

  it('paginates beyond the visible window when many commands are registered', async () => {
    const slash = new SlashRegistry()
    // Register 20 dummy commands so the dropdown must scroll.
    for (let i = 0; i < 20; i++) {
      slash.register({
        name: `cmd${String(i).padStart(2, '0')}`,
        description: `dummy ${i}`,
        async run() { return { type: 'text', text: '' } },
      })
    }
    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      h.stdin.write('/')
      await h.waitFor({ contains: '/cmd00' })
      const frame = h.frames().pop() ?? ''
      // Either the "more above"/"more below" hints or the first command
      // are visible — confirms the dropdown rendered.
      expect(frame).toContain('/cmd00')
      expect(frame).toMatch(/more (above|below)/)
    } finally {
      h.unmount()
    }
  })

  it('switches to arg-hint mode after typing a space after the command name', async () => {
    const slash = new SlashRegistry()
    slash.register({
      ...HelpCommand,
      source: 'builtin' as const,
      usage: '/help',
      description: 'Show help',
      examples: ['/help'],
    })

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      // Type '/help ' — list mode switches to arg-hint mode.
      h.stdin.write('/help ')
      await h.waitFor({ contains: 'Usage' })
      const frame = h.frames().pop() ?? ''
      // Arg-hint mode shows Usage line.
      expect(frame).toContain('Usage')
      expect(frame).toContain('/help')
      // The grouped list headings should NOT appear in arg-hint mode.
      expect(frame).not.toContain('builtins (')
    } finally {
      h.unmount()
    }
  })

  it('lists /skill and /help when those slashes are registered', async () => {
    const { SkillCommand } = await import('../../src/slash/skill')
    const slash = new SlashRegistry()
    slash.register(SkillCommand)
    slash.register(HelpCommand)
    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      h.stdin.write('/')
      await h.waitFor({ contains: '/skill' })
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('/skill')
      expect(frame).toContain('/help')
    } finally {
      h.unmount()
    }
  })
})
