// test/tui/modelPicker.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { ModelPicker } from '../../src/tui/dialogs/ModelPicker'
import type { ProviderConfig } from '../../src/core/config/schema'

const providers: ProviderConfig[] = [
  { id: 'p1', name: 'Anthropic', format: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-6'] },
  { id: 'p2', name: 'OpenAI', format: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5'] },
]

const flush = () => new Promise(r => setImmediate(r))

describe('ModelPicker', () => {
  it('shows provider list at root', () => {
    const { lastFrame } = render(
      <ModelPicker providers={providers} onSelect={() => {}} onAddProvider={() => {}} onRefresh={async () => []} onCancel={() => {}} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Anthropic')
    expect(f).toContain('OpenAI')
    expect(f).toContain('Add provider')
  })

  it('enter on a provider drills into its model list', async () => {
    const { lastFrame, stdin } = render(
      <ModelPicker providers={providers} onSelect={() => {}} onAddProvider={() => {}} onRefresh={async () => []} onCancel={() => {}} />,
    )
    stdin.write('\r') // pick first provider = Anthropic
    await flush()
    expect(lastFrame()).toContain('claude-sonnet-4-6')
    expect(lastFrame()).toContain('Back')
    expect(lastFrame()).toContain('Refresh')
  })

  it('onSelect fires with provider + model after drill-down selection', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <ModelPicker providers={providers} onSelect={onSelect} onAddProvider={() => {}} onRefresh={async () => []} onCancel={() => {}} />,
    )
    stdin.write('\r')      // into Anthropic
    await flush()
    stdin.write('\r')      // pick claude-sonnet-4-6
    await flush()
    expect(onSelect).toHaveBeenCalledWith('p1', 'claude-sonnet-4-6')
  })
})
