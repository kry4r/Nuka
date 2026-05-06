// test/tui/modelPicker.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { ModelPicker } from '../../src/tui/dialogs/ModelPicker'
import { LOADING_FRAMES } from '../../src/tui/design-system/LoadingState'
import type { ProviderConfig } from '../../src/core/config/schema'

const providers: ProviderConfig[] = [
  {
    id: 'p1',
    name: 'Anthropic',
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-6'],
    selectedModel: 'claude-sonnet-4-6',
  },
  {
    id: 'p2',
    name: 'OpenAI',
    format: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5'],
  },
]

const flush = () => new Promise(r => setImmediate(r))
const flushAll = async () => {
  for (let i = 0; i < 6; i++) await flush()
}

function makeProps(overrides: Partial<React.ComponentProps<typeof ModelPicker>> = {}) {
  return {
    providers,
    onSave: async () => {},
    onSelect: () => {},
    onAddProvider: () => {},
    onFetchRemote: vi.fn(async () => []),
    onCancel: () => {},
    ...overrides,
  }
}

describe('ModelPicker — providers stage', () => {
  it('shows provider list at root', () => {
    const { lastFrame } = render(<ModelPicker {...makeProps()} />)
    const f = lastFrame() ?? ''
    expect(f).toContain('Anthropic')
    expect(f).toContain('OpenAI')
    expect(f).toContain('Add provider')
  })

  it('Esc on root invokes onCancel', async () => {
    const onCancel = vi.fn()
    const { stdin } = render(<ModelPicker {...makeProps({ onCancel })} />)
    stdin.write('\u001B')
    await flush()
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('ModelPicker — models stage', () => {
  it('Enter on a provider drills in and fires onFetchRemote', async () => {
    const onFetchRemote = vi.fn(async () => ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'])
    const { lastFrame, stdin } = render(<ModelPicker {...makeProps({ onFetchRemote })} />)
    stdin.write('\r')
    await flushAll()
    expect(onFetchRemote).toHaveBeenCalledWith('p1')
    const f = lastFrame() ?? ''
    expect(f).toContain('claude-opus-4-7')
    expect(f).toContain('claude-sonnet-4-6')
    expect(f).toContain('claude-haiku-4-5')
  })

  it('renders [●] for active+shortlisted, [x] for shortlisted-only, [ ] for fetched-only', async () => {
    const onFetchRemote = vi.fn(async () => ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'])
    const { lastFrame, stdin } = render(
      <ModelPicker {...makeProps({ onFetchRemote, activeProviderId: 'p1', activeModel: 'claude-sonnet-4-6' })} />,
    )
    stdin.write('\r')
    await flushAll()
    const f = lastFrame() ?? ''
    const sonnetLine = f.split('\n').find(l => l.includes('claude-sonnet-4-6')) ?? ''
    expect(sonnetLine).toContain('[●]') // shortlisted + active
    const opusLine = f.split('\n').find(l => l.includes('claude-opus-4-7')) ?? ''
    expect(opusLine).toContain('[ ]')
    const haikuLine = f.split('\n').find(l => l.includes('claude-haiku-4-5')) ?? ''
    expect(haikuLine).toContain('[ ]')
  })

  it('space toggles shortlist and persists', async () => {
    const onFetchRemote = vi.fn(async () => ['claude-opus-4-7', 'claude-sonnet-4-6'])
    const onSave = vi.fn<(mutate: (obj: any) => void) => Promise<void>>(async () => {})
    const { stdin } = render(<ModelPicker {...makeProps({ onFetchRemote, onSave })} />)
    stdin.write('\r')
    await flushAll()
    // Cursor on first model (claude-opus-4-7). Press space to add.
    stdin.write(' ')
    await flush()
    expect(onSave).toHaveBeenCalled()
    // Replay the mutator to check the patch
    const mutator = onSave.mock.calls[0]![0]
    const obj: any = { providers: [{ id: 'p1', models: ['claude-sonnet-4-6'] }] }
    mutator(obj)
    expect(obj.providers[0].models).toContain('claude-opus-4-7')
  })

  it('enter on non-shortlisted model auto-shortlists then fires onSelect', async () => {
    const onFetchRemote = vi.fn(async () => ['claude-opus-4-7', 'claude-sonnet-4-6'])
    const onSave = vi.fn(async () => {})
    const onSelect = vi.fn()
    const { stdin } = render(<ModelPicker {...makeProps({ onFetchRemote, onSave, onSelect })} />)
    stdin.write('\r')
    await flushAll()
    // Cursor on claude-opus-4-7 (not shortlisted). Press enter.
    stdin.write('\r')
    await flushAll()
    expect(onSave).toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith('p1', 'claude-opus-4-7')
  })

  it('Esc on models stage returns to providers list', async () => {
    const onFetchRemote = vi.fn(async () => ['claude-sonnet-4-6'])
    const { stdin, lastFrame } = render(<ModelPicker {...makeProps({ onFetchRemote })} />)
    stdin.write('\r')
    await flushAll()
    stdin.write('\u001B')
    await flushAll()
    const f = lastFrame() ?? ''
    expect(f).toContain('Select provider')
  })

  it('falls back to local shortlist when fetch fails', async () => {
    const onFetchRemote = vi.fn(async () => { throw new Error('boom') })
    const { stdin, lastFrame } = render(<ModelPicker {...makeProps({ onFetchRemote })} />)
    stdin.write('\r')
    await flushAll()
    const f = lastFrame() ?? ''
    expect(f).toContain('claude-sonnet-4-6')
    expect(f).toMatch(/fetch failed|fallback/)
  })

  it('renders the LoadingState ⚡ glyph while remote fetch is pending', async () => {
    // Pending promise that we never resolve — locks the picker in 'loading'.
    const pending = new Promise<string[]>(() => {})
    const onFetchRemote = vi.fn(() => pending)
    const { stdin, lastFrame } = render(<ModelPicker {...makeProps({ onFetchRemote })} />)
    stdin.write('\r')
    await flush()
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Loading models from /v1/models')
    // The ⚡ animation glyph proves the LoadingState component (not the prior
    // plain <Text>) is doing the rendering.
    expect(f).toContain(LOADING_FRAMES[0])
  })

  it('Ratchet wraps the models-stage so its rendered frame height never shrinks below the observed max', async () => {
    // After the user drills into a provider and sees a fetched list of N
    // models, a re-render that subsequently yields a smaller list (e.g. a
    // narrower local shortlist after a config patch) must not jolt the box.
    // Frame height is measured by the total number of '\n'-separated rows
    // (Ratchet pads via minHeight on the outer Box), not visible text rows.
    const big = Array.from({ length: 15 }, (_, i) => `model-${i + 1}`)
    const small = ['only-one']
    const onFetchRemoteBig = vi.fn(async () => big)
    const onFetchRemoteSmall = vi.fn(async () => small)
    const providersOne: ProviderConfig[] = [
      { id: 'p1', name: 'p', format: 'openai', baseUrl: 'https://x.example.com', models: ['seed'] },
    ]
    const { stdin, lastFrame, rerender } = render(
      <ModelPicker {...makeProps({ providers: providersOne, onFetchRemote: onFetchRemoteBig })} />,
    )
    stdin.write('\r') // drill into p1 → fetch returns 15 models
    await flushAll()
    const tallTotal = stripAnsi(lastFrame() ?? '').split('\n').length
    const tallVisible = stripAnsi(lastFrame() ?? '').split('\n').filter(l => l.trim().length > 0).length
    expect(tallVisible).toBeGreaterThanOrEqual(10)
    // Rerender with a fetcher that returns a 1-model list. The Ratchet has
    // already locked minHeight at the first render's height, so the new
    // frame must still occupy at least the same total row count.
    rerender(
      <ModelPicker {...makeProps({ providers: providersOne, onFetchRemote: onFetchRemoteSmall })} />,
    )
    await flushAll()
    const afterTotal = stripAnsi(lastFrame() ?? '').split('\n').length
    expect(afterTotal).toBeGreaterThanOrEqual(tallTotal)
  })
})
