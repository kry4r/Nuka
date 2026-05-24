// test/core/onboarding/wizard.test.ts
import { describe, it, expect } from 'vitest'
import { reducer, initialState, type WizardState } from '../../../src/core/onboarding/wizard'
import { findTemplate } from '../../../src/core/onboarding/templates'

const ANTHROPIC = findTemplate('anthropic')!
const OPENAI = findTemplate('openai')!
const CUSTOM = findTemplate('custom')!

describe('onboarding wizard reducer', () => {
  it('welcome + start → pickProvider', () => {
    const s = reducer(initialState(), { type: 'start' })
    expect(s.kind).toBe('pickProvider')
    if (s.kind === 'pickProvider') expect(s.choices.length).toBeGreaterThanOrEqual(2)
  })

  it('pickProvider + pickedProvider → apiKey', () => {
    const a: WizardState = { kind: 'pickProvider', choices: [] }
    const s = reducer(a, { type: 'pickedProvider', template: ANTHROPIC })
    expect(s.kind).toBe('apiKey')
    if (s.kind === 'apiKey') {
      expect(s.provider.id).toBe('anthropic')
      expect(s.key).toBe('')
    }
  })

  it('apiKey + enteredKey → pickModel with template defaults', () => {
    const a: WizardState = { kind: 'apiKey', provider: ANTHROPIC, key: '' }
    const s = reducer(a, { type: 'enteredKey', key: 'sk-ant-xxx' })
    expect(s.kind).toBe('pickModel')
    if (s.kind === 'pickModel') {
      expect(s.key).toBe('sk-ant-xxx')
      expect(s.models).toEqual(ANTHROPIC.defaultModels)
      expect(s.selected).toBe(ANTHROPIC.defaultModel)
    }
  })

  it('pickModel + pickedModel → verifying', () => {
    const a: WizardState = {
      kind: 'pickModel',
      provider: ANTHROPIC,
      key: 'sk-ant-xxx',
      models: ANTHROPIC.defaultModels.slice(),
    }
    const s = reducer(a, { type: 'pickedModel', model: 'claude-haiku-4-5' })
    expect(s.kind).toBe('verifying')
    if (s.kind === 'verifying') expect(s.model).toBe('claude-haiku-4-5')
  })

  it('verifying + probeOk → done with ConfigPatch', () => {
    const a: WizardState = {
      kind: 'verifying',
      provider: OPENAI,
      key: 'sk-x',
      model: 'gpt-5',
    }
    const s = reducer(a, { type: 'probeOk', models: ['gpt-5', 'gpt-4o'] })
    expect(s.kind).toBe('done')
    if (s.kind === 'done') {
      expect(s.config.providerId).toBe('openai')
      expect(s.config.format).toBe('openai')
      expect(s.config.apiKey).toBe('sk-x')
      expect(s.config.selectedModel).toBe('gpt-5')
      expect(s.config.models).toEqual(['gpt-5', 'gpt-4o'])
    }
  })

  it('custom provider preserves the custom provider id and stores display name separately', () => {
    const picked = reducer(
      { kind: 'pickProvider', choices: [] },
      { type: 'pickedProvider', template: CUSTOM },
    )
    expect(picked.kind).toBe('customDetails')
    if (picked.kind !== 'customDetails') return

    const withDetails = reducer(picked, {
      type: 'enteredCustom',
      details: {
        name: 'Xiaomi Mimo',
        format: 'openai',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
        model: 'mimo-v2-pro',
      },
    })
    expect(withDetails.kind).toBe('apiKey')
    if (withDetails.kind !== 'apiKey') return

    const verifying = reducer(withDetails, { type: 'enteredKey', key: 'sk-custom' })
    expect(verifying.kind).toBe('verifying')
    if (verifying.kind !== 'verifying') return

    const done = reducer(verifying, { type: 'probeOk' })
    expect(done.kind).toBe('done')
    if (done.kind === 'done') {
      expect(done.config.providerId).toBe('custom')
      expect(done.config.name).toBe('Xiaomi Mimo')
    }
  })

  it('verifying + probeOk falls back to defaults if probe returns no models', () => {
    const a: WizardState = {
      kind: 'verifying',
      provider: ANTHROPIC,
      key: 'sk-ant',
      model: 'claude-sonnet-4-6',
    }
    const s = reducer(a, { type: 'probeOk' })
    expect(s.kind).toBe('done')
    if (s.kind === 'done') {
      expect(s.config.models).toEqual(ANTHROPIC.defaultModels)
      expect(s.config.selectedModel).toBe('claude-sonnet-4-6')
    }
  })

  it('verifying + probeErr → error{retryFrom:apiKey}', () => {
    const a: WizardState = {
      kind: 'verifying',
      provider: ANTHROPIC,
      key: 'sk-bad',
      model: 'claude-sonnet-4-6',
    }
    const s = reducer(a, { type: 'probeErr', reason: 'bad key' })
    expect(s.kind).toBe('error')
    if (s.kind === 'error') {
      expect(s.retryFrom).toBe('apiKey')
      expect(s.message).toBe('bad key')
      expect(s.provider?.id).toBe('anthropic')
      expect(s.key).toBe('sk-bad')
    }
  })

  it('error + back retraces per retryFrom (apiKey case)', () => {
    const a: WizardState = {
      kind: 'error',
      message: 'bad',
      retryFrom: 'apiKey',
      provider: ANTHROPIC,
      key: 'sk-bad',
    }
    const s = reducer(a, { type: 'back' })
    expect(s.kind).toBe('apiKey')
    if (s.kind === 'apiKey') {
      expect(s.provider.id).toBe('anthropic')
      expect(s.key).toBe('sk-bad')
    }
  })

  it('cancel from any state → cancelled', () => {
    const states: WizardState[] = [
      { kind: 'welcome' },
      { kind: 'apiKey', provider: ANTHROPIC, key: '' },
      { kind: 'verifying', provider: ANTHROPIC, key: 'k', model: 'm' },
    ]
    for (const st of states) {
      const s = reducer(st, { type: 'cancel' })
      expect(s.kind).toBe('cancelled')
    }
  })

  it('back from pickProvider → welcome; back from apiKey → pickProvider', () => {
    const s1 = reducer({ kind: 'pickProvider', choices: [] }, { type: 'back' })
    expect(s1.kind).toBe('welcome')
    const s2 = reducer({ kind: 'apiKey', provider: ANTHROPIC, key: 'x' }, { type: 'back' })
    expect(s2.kind).toBe('pickProvider')
  })

  it('done is terminal', () => {
    const a: WizardState = {
      kind: 'done',
      config: {
        providerId: 'x', name: 'X', format: 'openai',
        baseUrl: 'https://x', apiKey: 'k', models: ['m'], selectedModel: 'm',
      },
    }
    expect(reducer(a, { type: 'start' })).toBe(a)
  })
})
