// test/tui/Submenu/settings/SettingsSubmenu.harness.test.tsx
//
// Issue #4 + #6 — Claude Code style settings menu.
//
// First paint shows a single-column list of all ten categories with a
// per-row summary. Activating Theme (a regular form category) pushes
// into a subpage; Esc/← pops back. Activating Model or Effort hands off
// to an external picker via `onRequestExternalPicker` and STAYS on the
// menu (no subpage push).

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { SettingsSubmenu } from '../../../../src/tui/Submenu/settings/SettingsSubmenu'
import type { Config } from '../../../../src/core/config/schema'

// ink-testing-library's stdin doesn't always preserve key state across
// re-renders without a setRawMode shim — install one before render.
function installRawShim() {
  const stdinAny = process.stdin as { setRawMode?: (m: boolean) => unknown; isTTY?: boolean }
  if (stdinAny.setRawMode === undefined) {
    stdinAny.setRawMode = () => process.stdin
  }
}

const baseConfig: Config = {
  providers: [
    { id: 'p', name: 'p', format: 'openai', baseUrl: 'https://api.x.example.com', models: ['m1'], selectedModel: 'm1' } as any,
  ],
  active: { providerId: 'p' },
  vim: { enabled: true },
} as any

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

describe('SettingsSubmenu harness', () => {
  it('renders all ten categories on first paint as a single-column menu', () => {
    installRawShim()
    const { lastFrame, unmount } = render(
      <SettingsSubmenu
        config={baseConfig}
        onSave={async () => {}}
        onOpenEditor={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Providers')
    expect(f).toContain('Model')
    expect(f).toContain('Effort')
    expect(f).toContain('Theme')
    expect(f).toContain('StatusBar')
    expect(f).toContain('Vim')
    expect(f).toContain('Plugins')
    expect(f).toContain('Skills')
    expect(f).toContain('Welcome')
    expect(f).toContain('Compact')
    // Menu shows the per-row summary value (e.g. Vim 'on').
    expect(f).toContain('on')
    // No form rendered yet — the providers form footer should be absent.
    expect(f).not.toContain('a 添加')
    unmount()
  })

  it('↓ then ⏎ on Theme pushes to a subpage and renders the ThemeForm', async () => {
    installRawShim()
    const inst = render(
      <SettingsSubmenu
        config={baseConfig}
        onSave={async () => {}}
        onOpenEditor={() => {}}
      />,
    )
    try {
      await wait()
      // Providers (0) -> Model (1) -> Effort (2) -> Theme (3): three j
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('\r') // Enter
      await wait()
      const after = (inst as any).frames.slice().pop() ?? ''
      // Subpage footer hint replaces the menu footer.
      expect(after).toContain('← back')
      // ThemeForm content visible (heading 'Theme' or its 'themeName' field).
      expect(after).toContain('Theme')
    } finally {
      inst.unmount()
    }
  })

  it('← in subpage returns to the menu', async () => {
    installRawShim()
    const inst = render(
      <SettingsSubmenu
        config={baseConfig}
        onSave={async () => {}}
        onOpenEditor={() => {}}
      />,
    )
    try {
      await wait()
      // Push to Theme subpage (3 × j + Enter).
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('\r')
      await wait()
      const inSub = (inst as any).frames.slice().pop() ?? ''
      expect(inSub).toContain('← back')

      // ← (leftArrow) → back to menu. (Esc is intercepted by App's global
      // handler in production and closes the entire submenu; only ← pops
      // a single subpage level.)
      inst.stdin.write('\u001B[D')
      await wait()
      const back = (inst as any).frames.slice().pop() ?? ''
      // Menu footer reappears.
      expect(back).toContain('↑↓ select')
      expect(back).toContain('Esc close')
    } finally {
      inst.unmount()
    }
  })

  it('activating Model invokes onRequestExternalPicker("model-picker") and stays on the menu', async () => {
    installRawShim()
    const onRequestExternalPicker = vi.fn()
    const inst = render(
      <SettingsSubmenu
        config={baseConfig}
        onSave={async () => {}}
        onOpenEditor={() => {}}
        onRequestExternalPicker={onRequestExternalPicker}
      />,
    )
    try {
      await wait()
      // Providers (0) -> Model (1): one j
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('\r')
      await wait()
      expect(onRequestExternalPicker).toHaveBeenCalledWith('model-picker')
      // Did NOT push to subpage — menu footer still visible.
      const after = (inst as any).frames.slice().pop() ?? ''
      expect(after).toContain('↑↓ select')
    } finally {
      inst.unmount()
    }
  })

  it('activating Effort invokes onRequestExternalPicker("effort-picker") and stays on the menu', async () => {
    installRawShim()
    const onRequestExternalPicker = vi.fn()
    const cfgWithEffort = { ...baseConfig, effort: 'high' } as Config
    const inst = render(
      <SettingsSubmenu
        config={cfgWithEffort}
        onSave={async () => {}}
        onOpenEditor={() => {}}
        onRequestExternalPicker={onRequestExternalPicker}
      />,
    )
    try {
      await wait()
      // Providers (0) -> Model (1) -> Effort (2): two j
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('\r')
      await wait()
      expect(onRequestExternalPicker).toHaveBeenCalledWith('effort-picker')
      const after = (inst as any).frames.slice().pop() ?? ''
      expect(after).toContain('↑↓ select')
    } finally {
      inst.unmount()
    }
  })

  it('o triggers onOpenEditor for the external-editor escape hatch', async () => {
    installRawShim()
    let opened = false
    const inst = render(
      <SettingsSubmenu
        config={baseConfig}
        onSave={async () => {}}
        onOpenEditor={() => { opened = true }}
      />,
    )
    try {
      await wait()
      inst.stdin.write('o')
      await wait()
      expect(opened).toBe(true)
    } finally {
      inst.unmount()
    }
  })
})
