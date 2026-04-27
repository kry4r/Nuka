import { describe, it, expect } from 'vitest'
import { mountApp } from '../../../src/tui/testing/harness'
import { SlashRegistry } from '../../../src/slash/registry'
import { HelpCommand } from '../../../src/slash/help'
import { ExitCommand } from '../../../src/slash/exit'
import { ThemeCommand } from '../../../src/slash/theme'

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

describe('PromptInput slash dropdown', () => {
  it('shows the slash submenu when the user types `/`', async () => {
    const slash = new SlashRegistry()
    slash.register(HelpCommand)
    slash.register(ExitCommand)
    slash.register(ThemeCommand)

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      h.stdin.write('/')
      await wait()
      const frame = h.frames().pop() ?? ''
      // The dropdown lists each registered command name beneath the
      // input box. We assert at least two (the harness sees only
      // characters that ink-testing-library can render).
      expect(frame).toContain('/help')
      expect(frame).toContain('/exit')
      expect(frame).toContain('/theme')
    } finally {
      h.unmount()
    }
  })

  it('hides the StatusBar / Hud while the submenu is open', async () => {
    const slash = new SlashRegistry()
    slash.register(HelpCommand)
    slash.register(ExitCommand)

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      // Baseline frame includes the categorised StatusBar labels (session/runtime/hint).
      const baseline = h.frames().pop() ?? ''
      expect(baseline).toMatch(/session|runtime|hint/)
      // Open the submenu.
      h.stdin.write('/')
      await wait()
      const open = h.frames().pop() ?? ''
      expect(open).toContain('/help')
      // While open, the categorised status bar rows are gone.
      expect(open).not.toMatch(/session\s+⬢|runtime\s+\d/)
      // Close the submenu.
      h.stdin.write('\u007F') // backspace
      await wait()
      const closed = h.frames().pop() ?? ''
      expect(closed).toMatch(/session|runtime|hint/)
    } finally {
      h.unmount()
    }
  })

  it('lists /mcp and /skill when those slashes are registered', async () => {
    const { McpCommand } = await import('../../../src/slash/mcp')
    const { SkillCommand } = await import('../../../src/slash/skill')
    const slash = new SlashRegistry()
    slash.register(McpCommand)
    slash.register(SkillCommand)
    slash.register(HelpCommand)
    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      h.stdin.write('/')
      await wait()
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('/mcp')
      expect(frame).toContain('/skill')
    } finally {
      h.unmount()
    }
  })

  it('paginates beyond the visible window when many commands registered', async () => {
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
      await wait()
      const frame = h.frames().pop() ?? ''
      // Either the "more above"/"more below" hints or the first command
      // are visible — confirms the dropdown rendered.
      expect(frame).toContain('/cmd00')
      expect(frame).toMatch(/more (above|below)/)
    } finally {
      h.unmount()
    }
  })
})
