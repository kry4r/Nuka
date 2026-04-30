// test/tui/Submenu/settings/ProvidersForm.test.tsx
//
// Phase 13 §4.5 — list rendering, edit-mode entry, save round-trip,
// delete confirmation, and Enter-to-activate.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { ProvidersForm } from '../../../../src/tui/Submenu/settings/ProvidersForm'
import type { Config } from '../../../../src/core/config/schema'

function installRawShim() {
  const stdinAny = process.stdin as { setRawMode?: (m: boolean) => unknown; isTTY?: boolean }
  if (stdinAny.setRawMode === undefined) {
    stdinAny.setRawMode = () => process.stdin
  }
}

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

const cfg = (): Config => ({
  providers: [
    { id: 'openai', name: 'openai', format: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', models: ['gpt-4'], selectedModel: 'gpt-4' } as any,
    { id: 'anthro', name: 'anthro', format: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-y', models: ['claude'], selectedModel: 'claude' } as any,
  ],
  active: { providerId: 'openai' },
} as any)

const noOp = () => {}

describe('ProvidersForm', () => {
  it('renders providers list with id and baseUrl', () => {
    installRawShim()
    const { lastFrame, unmount } = render(
      <ProvidersForm
        config={cfg()}
        onSave={async () => {}}
        focused={false}
        fieldIdx={0}
        setFieldIdx={noOp}
        erroredField={null}
        flashError={noOp}
        setFormSave={noOp}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Providers')
    expect(f).toContain('openai')
    expect(f).toContain('https://api.openai.com/v1')
    expect(f).toContain('anthro')
    expect(f).toContain('https://api.anthropic.com')
    expect(f).toContain('a 添加')
    expect(f).toContain('设为 active')
    unmount()
  })

  it('press `e` enters the inline editor for the cursored provider', async () => {
    installRawShim()
    const inst = render(
      <ProvidersForm
        config={cfg()}
        onSave={async () => {}}
        focused={true}
        fieldIdx={0}
        setFieldIdx={noOp}
        erroredField={null}
        flashError={noOp}
        setFormSave={noOp}
      />,
    )
    try {
      await wait()
      inst.stdin.write('e')
      await wait()
      const f = inst.lastFrame() ?? ''
      expect(f).toContain('Edit openai')
      expect(f).toContain('baseUrl')
      expect(f).toContain('apiKey')
      expect(f).toContain('format')
    } finally {
      inst.unmount()
    }
  })

  it('save round-trip: registered formSave persists providers + active', async () => {
    installRawShim()
    let registered: (() => Promise<void>) | null = null
    const seen: any = {}
    const onSave = async (mutate: (obj: any) => void) => {
      const obj: any = { providers: [], active: { providerId: '' } }
      mutate(obj)
      Object.assign(seen, obj)
    }
    render(
      <ProvidersForm
        config={cfg()}
        onSave={onSave}
        focused={false}
        fieldIdx={0}
        setFieldIdx={noOp}
        erroredField={null}
        flashError={noOp}
        setFormSave={fn => { registered = fn }}
      />,
    )
    expect(registered).not.toBeNull()
    await registered!()
    expect(seen.providers).toHaveLength(2)
    expect(seen.providers[0].id).toBe('openai')
    expect(seen.providers[1].id).toBe('anthro')
    expect(seen.active.providerId).toBe('openai')
  })

  it('`d` then `y` deletes the cursored provider', async () => {
    installRawShim()
    let saved: any = null
    const onSave = async (mutate: (obj: any) => void) => {
      const obj: any = { providers: [], active: { providerId: '' } }
      mutate(obj)
      saved = obj
    }
    const inst = render(
      <ProvidersForm
        config={cfg()}
        onSave={onSave}
        focused={true}
        fieldIdx={0}
        setFieldIdx={noOp}
        erroredField={null}
        flashError={noOp}
        setFormSave={noOp}
      />,
    )
    try {
      await wait()
      // cursor starts at index 0 (openai). Press `d` → confirm prompt.
      inst.stdin.write('d')
      await wait()
      const confirm = inst.lastFrame() ?? ''
      expect(confirm).toContain('Delete provider')
      expect(confirm).toContain('openai')
      // Confirm with `y` → deletes openai, persists.
      inst.stdin.write('y')
      await wait()
      expect(saved).not.toBeNull()
      expect(saved.providers).toHaveLength(1)
      expect(saved.providers[0].id).toBe('anthro')
      // active rolls over to the surviving provider.
      expect(saved.active.providerId).toBe('anthro')
    } finally {
      inst.unmount()
    }
  })

  it('Enter sets the cursored provider as active and persists', async () => {
    installRawShim()
    let saved: any = null
    const onSave = async (mutate: (obj: any) => void) => {
      const obj: any = { providers: [], active: { providerId: '' } }
      mutate(obj)
      saved = obj
    }
    const inst = render(
      <ProvidersForm
        config={cfg()}
        onSave={onSave}
        focused={true}
        fieldIdx={0}
        setFieldIdx={noOp}
        erroredField={null}
        flashError={noOp}
        setFormSave={noOp}
      />,
    )
    try {
      await wait()
      // Move cursor down to anthro then press Enter.
      inst.stdin.write('j')
      await wait()
      inst.stdin.write('\r')
      await wait()
      expect(saved).not.toBeNull()
      expect(saved.active.providerId).toBe('anthro')
      expect(saved.providers).toHaveLength(2)
    } finally {
      inst.unmount()
    }
  })
})
