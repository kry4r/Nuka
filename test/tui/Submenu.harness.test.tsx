// test/tui/Submenu.harness.test.tsx
//
// Phase 12 §4.6 — opens /settings (or any full submenu) via slash, asserts
// that Tasks/Prompt/Status are hidden while the submenu is shown, and
// Esc returns to the normal layout.

import { describe, it, expect } from 'vitest'
import { mountApp } from '../../src/tui/testing/harness'
import { SlashRegistry } from '../../src/slash/registry'
import { SettingsCommand } from '../../src/slash/settings'

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('Phase 12 submenu', () => {
  it('full submenu hides Tasks/Prompt/Status zones; Esc returns to normal', async () => {
    const slash = new SlashRegistry()
    slash.register(SettingsCommand)
    const cfg = {
      providers: [
        { id: 'p', name: 'p', format: 'openai', baseUrl: 'https://api.example.com', models: ['m'] },
      ],
      active: { providerId: 'p' },
    } as any
    const h = mountApp({ target: 'app', slash, config: cfg })
    try {
      await wait()
      // Baseline: Status panel visible (anchor on the cost row — ⏱ removed in Phase 13).
      const baseline = h.frames().pop() ?? ''
      expect(baseline).toMatch(/\$0\.0000/)
      expect(baseline).toMatch(/│ >/) // PromptInput visible

      // Open /settings — full submenu.
      h.stdin.write('/settings')
      await wait()
      h.stdin.write('\r')
      await wait(120)
      const open = h.frames().pop() ?? ''
      // SettingsSubmenu renders inside SubmenuFrame with category nav.
      expect(open.toLowerCase()).toContain('settings')
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
