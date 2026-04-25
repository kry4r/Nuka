// test/tui/Onboarding/wizard.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Wizard } from '../../../src/tui/Onboarding/Wizard'

const flush = () => new Promise(r => setImmediate(r))
const wait = async (n = 6) => {
  for (let i = 0; i < n; i++) await flush()
}
async function type(stdin: { write: (s: string) => void }, s: string): Promise<void> {
  for (const c of s) {
    stdin.write(c)
    await wait(3)
  }
}

describe('Onboarding Wizard', () => {
  it('welcome screen shows banner + Enter prompt', () => {
    const { lastFrame } = render(<Wizard onDone={() => {}} onCancel={() => {}} />)
    const f = lastFrame() ?? ''
    expect(f).toContain('Welcome to Nuka')
    expect(f).toMatch(/Enter/)
  })

  it('Enter advances to pickProvider with both templates listed', async () => {
    const { lastFrame, stdin } = render(<Wizard onDone={() => {}} onCancel={() => {}} />)
    stdin.write('\r')
    await wait()
    const f = lastFrame() ?? ''
    expect(f).toContain('Choose a provider')
    expect(f).toContain('Anthropic')
    expect(f).toContain('OpenAI')
  })

  it('pick anthropic, type a key, then Enter goes to pickModel', async () => {
    const { lastFrame, stdin } = render(<Wizard onDone={() => {}} onCancel={() => {}} />)
    stdin.write('\r')
    await wait()
    stdin.write('\r')           // pick first (anthropic)
    await wait()
    expect(lastFrame() ?? '').toContain('Enter API key')
    await type(stdin, 'sk-ant-test')
    await wait()
    expect(lastFrame() ?? '').toMatch(/11 chars/)
    stdin.write('\r')           // submit key → pickModel
    await wait()
    const f = lastFrame() ?? ''
    expect(f).toContain('Pick default model')
    expect(f).toContain('claude-')
  })

  it('Esc on welcome fires onCancel', async () => {
    const onCancel = vi.fn()
    const { stdin } = render(<Wizard onDone={() => {}} onCancel={onCancel} />)
    stdin.write('\u001B') // ESC
    await wait()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('full happy path with mocked probe → onDone fires with ConfigPatch', async () => {
    const onDone = vi.fn()
    const probeFn = vi.fn(async () => ({ ok: true as const, models: ['claude-sonnet-4-6', 'claude-haiku-4-5'] }))
    const { stdin } = render(
      <Wizard onDone={onDone} onCancel={() => {}} probeFn={probeFn} />,
    )
    stdin.write('\r'); await wait() // welcome
    stdin.write('\r'); await wait() // pick anthropic
    await type(stdin, 'sk-ant-x')
    stdin.write('\r'); await wait() // submit key
    stdin.write('\r'); await wait(10) // pick model + give async probe ticks
    expect(probeFn).toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledOnce()
    const cfg = onDone.mock.calls[0]?.[0]
    expect(cfg.providerId).toBe('anthropic')
    expect(cfg.format).toBe('anthropic')
    expect(cfg.apiKey).toBe('sk-ant-x')
    expect(cfg.models).toContain('claude-sonnet-4-6')
  })

  it('probe failure routes to error screen', async () => {
    const probeFn = vi.fn(async () => ({ ok: false as const, reason: 'bad-key-401' }))
    const { stdin, lastFrame } = render(
      <Wizard onDone={() => {}} onCancel={() => {}} probeFn={probeFn} />,
    )
    stdin.write('\r'); await wait()
    stdin.write('\r'); await wait()
    await type(stdin, 'k')
    stdin.write('\r'); await wait()
    stdin.write('\r'); await wait(10)
    const f = lastFrame() ?? ''
    expect(f).toContain('Verification failed')
    expect(f).toContain('bad-key-401')
  })
})
