// test/tui/Submenu/settings/SettingsSubmenu.harness.test.tsx
//
// j/k navigation in the left rail, right-pane re-renders to the selected
// category's form.

import React from 'react'
import { describe, it, expect } from 'vitest'
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
  it('renders all ten categories in fixed order on first paint', () => {
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
    // First category (Providers) is selected; the right pane shows the
    // providers list and the action footer.
    expect(f).toContain('https://api.x.example.com')
    expect(f).toContain('a 添加')
    unmount()
  })

  it('j moves the cursor to the next category and the right pane re-renders', async () => {
    installRawShim()
    const inst = render(
      <SettingsSubmenu
        config={baseConfig}
        onSave={async () => {}}
        onOpenEditor={() => {}}
      />,
    )
    try {
      // Baseline: Providers form active.
      await wait()
      const baseline = (inst as any).frames.slice().pop() ?? ''
      expect(baseline).toContain('https://api.x.example.com')

      // j → Model.
      inst.stdin.write('j')
      await wait()
      const after = (inst as any).frames.slice().pop() ?? ''
      // Model form shows "Model · …" header (Provider.name = 'p').
      expect(after).toContain('Model')
      expect(after).not.toContain('a 添加') // Providers footer hidden now
    } finally {
      inst.unmount()
    }
  })

  it('Effort category renders the level select with current value', async () => {
    installRawShim()
    const cfgWithEffort = { ...baseConfig, effort: 'high' } as Config
    const inst = render(
      <SettingsSubmenu
        config={cfgWithEffort}
        onSave={async () => {}}
        onOpenEditor={() => {}}
      />,
    )
    try {
      await wait()
      // j twice (Providers -> Model -> Effort).
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('j')
      await wait()
      const after = (inst as any).frames.slice().pop() ?? ''
      expect(after).toContain('Effort')
      expect(after).toContain('level')
      expect(after).toContain('high')
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
