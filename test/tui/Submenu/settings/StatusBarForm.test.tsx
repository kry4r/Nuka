// test/tui/Submenu/settings/StatusBarForm.test.tsx
//
// Phase 12 §4.7 — canonical StatusBar form. Verifies the layout select
// updates statusBar.layout and the per-segment toggle list round-trips
// through the saved hidden array.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { StatusBarForm } from '../../../../src/tui/Submenu/settings/StatusBarForm'
import type { Config } from '../../../../src/core/config/schema'

const baseConfig: Config = {
  providers: [{ id: 'p', name: 'p', format: 'openai', baseUrl: 'https://x.example.com', models: [] } as any],
  active: { providerId: 'p' },
  statusBar: { hidden: ['model'], layout: 'compact' },
} as any

describe('StatusBarForm', () => {
  it('renders current layout + per-segment hidden toggles', () => {
    const { lastFrame } = render(
      <StatusBarForm
        config={baseConfig}
        onSave={async () => {}}
        focused={false}
        fieldIdx={0}
        setFieldIdx={() => {}}
        erroredField={null}
        flashError={() => {}}
        setFormSave={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('StatusBar')
    expect(f).toContain('layout')
    expect(f).toContain('compact')
    // hidden:model is on (was in config); hidden:cwd is off.
    expect(f).toContain('hide:model')
    expect(f).toContain('☑') // model is hidden
    expect(f).toContain('hide:cwd')
    expect(f).toContain('☐') // cwd is shown
  })

  it('save-all writes layout + hidden round-trip via mutator', async () => {
    let registered: (() => Promise<void>) | null = null
    const seen: any = {}
    const onSave = async (mutate: (obj: any) => void) => {
      const obj: any = { statusBar: {} }
      mutate(obj)
      Object.assign(seen, obj)
    }
    render(
      <StatusBarForm
        config={baseConfig}
        onSave={onSave}
        focused={false}
        fieldIdx={0}
        setFieldIdx={() => {}}
        erroredField={null}
        flashError={() => {}}
        setFormSave={(fn) => { registered = fn }}
      />,
    )
    await registered!()
    expect(seen.statusBar.layout).toBe('compact')
    expect(seen.statusBar.hidden).toEqual(['model'])
  })
})
