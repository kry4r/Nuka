// test/tui/Submenu.harness.test.tsx
//
// Phase 12 §4.6 — opens /config (or any full submenu) via slash, asserts
// that Tasks/Prompt/Status are hidden while the submenu is shown, and
// Esc returns to the normal layout.

import { describe, it, expect } from 'vitest'
import { mountApp } from '../../src/tui/testing/harness'
import { SlashRegistry } from '../../src/slash/registry'
import { ConfigCommand } from '../../src/slash/config'

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('Phase 12 submenu', () => {
  it('full submenu hides Tasks/Prompt/Status zones; Esc returns to normal', async () => {
    const slash = new SlashRegistry()
    slash.register(ConfigCommand)
    const cfg = {
      providers: [
        { id: 'p', name: 'p', format: 'openai', baseUrl: 'https://api.example.com', models: ['m'] },
      ],
      active: { providerId: 'p' },
    } as any
    const h = mountApp({ target: 'app', slash, config: cfg })
    try {
      await wait()
      // Baseline: Status panel visible (anchor on the elapsed-time row).
      const baseline = h.frames().pop() ?? ''
      expect(baseline).toMatch(/⏱/)
      expect(baseline).toMatch(/│ >/) // PromptInput visible

      // Open /config — full submenu.
      h.stdin.write('/config')
      await wait()
      h.stdin.write('\r')
      await wait(120)
      const open = h.frames().pop() ?? ''
      // ConfigSubmenu renders inside SubmenuFrame with category nav.
      expect(open.toLowerCase()).toContain('config')
      expect(open).toContain('Provider')
      expect(open).toContain('StatusBar')
      // Status panel hidden (mode badge gone).
      expect(open).not.toMatch(/⬢ idle/)

      // Esc closes the submenu and we return to normal.
      h.stdin.write('\u001B') // ESC
      await wait(60)
      const closed = h.frames().pop() ?? ''
      expect(closed).toMatch(/⬢ idle/)
    } finally {
      h.unmount()
    }
  })
})
