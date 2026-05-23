// test/tui/Submenu/settings/CompactForm.test.tsx
//
// Compact settings should expose the same efficiency controls the manual
// compact path consumes. In particular, retainedMessageBudget is the
// Codex-style cap on how many raw tail messages survive after compaction.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { CompactForm } from '../../../../src/tui/Submenu/settings/CompactForm'
import type { Config } from '../../../../src/core/config/schema'

const baseConfig: Config = {
  providers: [{ id: 'p', name: 'p', format: 'openai', baseUrl: 'https://x.example.com', models: [] } as any],
  active: { providerId: 'p' },
  compact: {
    keepTurns: 4,
    retainedMessageBudget: 8,
    autoThreshold: 0.75,
    contextWindow: 100_000,
  },
} as any

const wait = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))

describe('CompactForm', () => {
  it('renders tail budget alongside the existing compact fields', () => {
    const { lastFrame } = render(
      <CompactForm
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
    expect(f).toContain('keepTurns')
    expect(f).toContain('tailBudget')
    expect(f).toContain('8')
  })

  it('save-all writes retainedMessageBudget through the mutator', async () => {
    let registered: (() => Promise<void>) | null = null
    const seen: any = {}
    const onSave = async (mutate: (obj: any) => void) => {
      const obj: any = { compact: {} }
      mutate(obj)
      Object.assign(seen, obj)
    }

    render(
      <CompactForm
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
    expect(seen.compact).toMatchObject({
      keepTurns: 4,
      retainedMessageBudget: 8,
      autoThreshold: 0.75,
      contextWindow: 100_000,
    })
  })

  it('save-all clears an existing retainedMessageBudget when the field is blank', async () => {
    let registered: (() => Promise<void>) | null = null
    const seen: any = {}
    const onSave = async (mutate: (obj: any) => void) => {
      const obj: any = { compact: { retainedMessageBudget: 8 } }
      mutate(obj)
      Object.assign(seen, obj)
    }

    const inst = render(
      <CompactForm
        config={baseConfig}
        onSave={onSave}
        focused
        fieldIdx={1}
        setFieldIdx={() => {}}
        erroredField={null}
        flashError={() => {}}
        setFormSave={(fn) => { registered = fn }}
      />,
    )
    try {
      inst.stdin.write('\r')
      await wait()
      inst.stdin.write('\u007F')
      await wait()
      inst.stdin.write('\r')
      await wait()
      await registered!()
      expect(seen.compact.retainedMessageBudget).toBeUndefined()
    } finally {
      inst.unmount()
    }
  })
})
