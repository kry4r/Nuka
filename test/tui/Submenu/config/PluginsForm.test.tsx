// test/tui/Submenu/config/PluginsForm.test.tsx
//
// Phase 13 §4.5 — checklist render, space-toggle round-trip via formSave,
// and placeholder when no plugins are detected.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { PluginsForm } from '../../../../src/tui/Submenu/config/PluginsForm'
import type { Config } from '../../../../src/core/config/schema'

function installRawShim() {
  const stdinAny = process.stdin as { setRawMode?: (m: boolean) => unknown; isTTY?: boolean }
  if (stdinAny.setRawMode === undefined) {
    stdinAny.setRawMode = () => process.stdin
  }
}

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

const baseConfig: Config = {
  providers: [{ id: 'p', name: 'p', format: 'openai', baseUrl: 'https://x.example.com', models: [] } as any],
  active: { providerId: 'p' },
  plugins: { enabled: ['alpha'] },
} as any

const noOp = () => {}

describe('PluginsForm', () => {
  it('renders every loaded plugin as a checklist', () => {
    installRawShim()
    const { lastFrame, unmount } = render(
      <PluginsForm
        config={baseConfig}
        onSave={async () => {}}
        focused={false}
        fieldIdx={0}
        setFieldIdx={noOp}
        erroredField={null}
        flashError={noOp}
        setFormSave={noOp}
        loadedPlugins={[
          { name: 'alpha', description: 'first plugin' },
          { name: 'beta', description: 'second plugin' },
        ]}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Plugins')
    expect(f).toContain('[x] alpha')
    expect(f).toContain('first plugin')
    expect(f).toContain('[ ] beta')
    expect(f).toContain('second plugin')
    unmount()
  })

  it('shows placeholder when no plugins are detected', () => {
    installRawShim()
    const { lastFrame, unmount } = render(
      <PluginsForm
        config={baseConfig}
        onSave={async () => {}}
        focused={false}
        fieldIdx={0}
        setFieldIdx={noOp}
        erroredField={null}
        flashError={noOp}
        setFormSave={noOp}
        loadedPlugins={[]}
      />,
    )
    expect(lastFrame() ?? '').toContain('(no plugins detected)')
    unmount()
  })

  it('space toggles enabled list and save persists', async () => {
    installRawShim()
    let registered: (() => Promise<void>) | null = null
    let saved: any = null
    const onSave = async (mutate: (obj: any) => void) => {
      const obj: any = { plugins: {} }
      mutate(obj)
      saved = obj
    }
    const inst = render(
      <PluginsForm
        config={baseConfig}
        onSave={onSave}
        focused={true}
        fieldIdx={0}
        setFieldIdx={noOp}
        erroredField={null}
        flashError={noOp}
        setFormSave={fn => { registered = fn }}
        loadedPlugins={[
          { name: 'alpha' },
          { name: 'beta' },
        ]}
      />,
    )
    try {
      await wait()
      // Cursor starts at index 0 = alpha (currently enabled). Toggle off.
      inst.stdin.write(' ')
      await wait()
      // Move down to beta and toggle on.
      inst.stdin.write('j')
      await wait()
      inst.stdin.write(' ')
      await wait()
      // Persist.
      expect(registered).not.toBeNull()
      await registered!()
      expect(saved).not.toBeNull()
      expect(saved.plugins.enabled).toEqual(['beta'])
    } finally {
      inst.unmount()
    }
  })
})
