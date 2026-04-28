// test/tui/Submenu/config/ConfigSubmenu.harness.test.tsx
//
// Phase 12 §4.7 — j/k navigation in the left rail, right-pane re-renders
// to the selected category's form.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { ConfigSubmenu } from '../../../../src/tui/Submenu/config/ConfigSubmenu'
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

describe('ConfigSubmenu harness', () => {
  it('renders all nine categories in fixed order on first paint', () => {
    installRawShim()
    const { lastFrame, unmount } = render(
      <ConfigSubmenu
        config={baseConfig}
        onSave={async () => {}}
        onOpenEditor={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Provider')
    expect(f).toContain('Model')
    expect(f).toContain('Theme')
    expect(f).toContain('StatusBar')
    expect(f).toContain('Vim')
    expect(f).toContain('Plugins')
    expect(f).toContain('Skills')
    expect(f).toContain('Welcome')
    expect(f).toContain('Compact')
    // First category (Provider) is selected; the right pane should show
    // its content.
    expect(f).toContain('baseUrl')
    unmount()
  })

  it('j moves the cursor to the next category and the right pane re-renders', async () => {
    installRawShim()
    const inst = render(
      <ConfigSubmenu
        config={baseConfig}
        onSave={async () => {}}
        onOpenEditor={() => {}}
      />,
    )
    try {
      // Baseline: Provider form active.
      await wait()
      const baseline = (inst as any).frames.slice().pop() ?? ''
      expect(baseline).toContain('baseUrl')

      // j → Model.
      inst.stdin.write('j')
      await wait()
      const after = (inst as any).frames.slice().pop() ?? ''
      // Model form contains "Model · p" header (Provider.name = 'p').
      expect(after).toContain('Model')
      expect(after).not.toContain('apiKey') // ProviderForm hidden now
    } finally {
      inst.unmount()
    }
  })

  it('o triggers onOpenEditor for the external-editor escape hatch', async () => {
    installRawShim()
    let opened = false
    const inst = render(
      <ConfigSubmenu
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
