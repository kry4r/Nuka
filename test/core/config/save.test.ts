import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { saveActiveSelection, saveProviderSelectedModel, addProvider } from '../../../src/core/config/save'
import { saveWizardPatch } from '../../../src/core/onboarding/save'

function home(): string {
  const h = mkdtempSync(join(os.tmpdir(), 'nuka-save-'))
  mkdirSync(join(h, '.nuka'))
  writeFileSync(
    join(h, '.nuka', 'config.yaml'),
    `providers:
  - id: p1
    name: A
    format: anthropic
    baseUrl: https://api.anthropic.com
    models: [claude-sonnet-4-6]
    selectedModel: claude-sonnet-4-6
active: { providerId: p1 }
`,
  )
  return h
}

describe('config save', () => {
  it('saveActiveSelection updates active.providerId', async () => {
    const h = home()
    await saveActiveSelection(h, 'p1')
    const txt = readFileSync(join(h, '.nuka', 'config.yaml'), 'utf8')
    expect(txt).toMatch(/providerId:\s*p1/)
  })

  it('saveProviderSelectedModel updates selectedModel for a given provider', async () => {
    const h = home()
    await saveProviderSelectedModel(h, 'p1', 'opus-4-7')
    const txt = readFileSync(join(h, '.nuka', 'config.yaml'), 'utf8')
    expect(txt).toMatch(/selectedModel:\s*opus-4-7/)
  })

  it('addProvider appends a new provider', async () => {
    const h = home()
    await addProvider(h, {
      id: 'p2', name: 'X', format: 'openai', baseUrl: 'https://x', models: ['m1'],
    })
    const txt = readFileSync(join(h, '.nuka', 'config.yaml'), 'utf8')
    expect(txt).toContain('id: p2')
    expect(txt).toContain('id: p1')
  })

  it('addProvider preserves explicit custom ids and configured provider names', async () => {
    const h = home()
    await addProvider(h, {
      id: 'custom',
      name: 'Xiaomi Mimo',
      format: 'openai',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      models: ['mimo-v2-pro'],
      selectedModel: 'mimo-v2-pro',
    })

    const txt = readFileSync(join(h, '.nuka', 'config.yaml'), 'utf8')
    expect(txt).toContain('id: custom')
    expect(txt).toContain('name: Xiaomi Mimo')
    expect(txt).not.toContain('id: xiaomi-mimo')
  })

  it('saveWizardPatch persists custom providers with name-derived ids', async () => {
    const h = mkdtempSync(join(os.tmpdir(), 'nuka-save-empty-'))
    mkdirSync(join(h, '.nuka'))
    writeFileSync(join(h, '.nuka', 'config.yaml'), 'providers: []\n')

    await saveWizardPatch(h, {
      providerId: 'xiaomi-mimo',
      name: 'Xiaomi Mimo',
      format: 'openai',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      apiKey: 'sk-custom',
      models: ['mimo-v2-pro'],
      selectedModel: 'mimo-v2-pro',
    })

    const txt = readFileSync(join(h, '.nuka', 'config.yaml'), 'utf8')
    expect(txt).toContain('id: xiaomi-mimo')
    expect(txt).toContain('name: Xiaomi Mimo')
    expect(txt).toContain('providerId: xiaomi-mimo')
    expect(txt).not.toContain('id: custom')
    expect(txt).not.toContain('id: custom-2')
  })

  it('addProvider updates active selection with the saved custom id', async () => {
    const h = mkdtempSync(join(os.tmpdir(), 'nuka-save-empty-'))
    mkdirSync(join(h, '.nuka'))
    writeFileSync(join(h, '.nuka', 'config.yaml'), 'providers: []\n')

    await addProvider(h, {
      id: 'custom-2',
      name: 'DeepSeek Gateway',
      format: 'openai',
      baseUrl: 'https://gateway.example.test/v1',
      models: ['deepseek-chat'],
    })

    const txt = readFileSync(join(h, '.nuka', 'config.yaml'), 'utf8')
    expect(txt).toContain('id: custom-2')
    expect(txt).toContain('name: DeepSeek Gateway')
    expect(txt).toContain('providerId: custom-2')
  })
})
