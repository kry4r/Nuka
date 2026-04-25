// src/core/onboarding/wizard.ts
//
// Pure state machine for the onboarding wizard. UI components dispatch
// `WizardEvent`s; this reducer is the single source of truth for what
// screen renders next. Network/IO is owned by the caller (see TUI layer).
//
// State diagram:
//   welcome → pickProvider → apiKey → pickModel → verifying → done
//                                                     ↓ probeErr
//                                                   error → back → apiKey
//
// `cancel` always wins and goes to `cancelled`.

import type { ProviderTemplate } from './templates'
import { PROVIDER_TEMPLATES } from './templates'

export type ConfigPatch = {
  providerId: string
  name: string
  format: 'anthropic' | 'openai'
  baseUrl: string
  apiKey: string
  models: string[]
  selectedModel: string
}

export type WizardKind =
  | 'welcome'
  | 'pickProvider'
  | 'apiKey'
  | 'pickModel'
  | 'verifying'
  | 'done'
  | 'error'
  | 'cancelled'

export type WizardState =
  | { kind: 'welcome' }
  | { kind: 'pickProvider'; choices: ProviderTemplate[] }
  | { kind: 'apiKey'; provider: ProviderTemplate; key: string }
  | {
      kind: 'pickModel'
      provider: ProviderTemplate
      key: string
      models: string[]
      selected?: string
    }
  | {
      kind: 'verifying'
      provider: ProviderTemplate
      key: string
      model: string
    }
  | { kind: 'done'; config: ConfigPatch }
  | {
      kind: 'error'
      message: string
      retryFrom: Exclude<WizardKind, 'done' | 'cancelled' | 'error'>
      // carried forward so going back keeps user inputs:
      provider?: ProviderTemplate
      key?: string
      model?: string
    }
  | { kind: 'cancelled' }

export type WizardEvent =
  | { type: 'start' }
  | { type: 'pickedProvider'; template: ProviderTemplate }
  | { type: 'enteredKey'; key: string }
  | { type: 'pickedModel'; model: string }
  | { type: 'probeOk'; models?: string[] }
  | { type: 'probeErr'; reason: string }
  | { type: 'back' }
  | { type: 'cancel' }

export function initialState(): WizardState {
  return { kind: 'welcome' }
}

export function reducer(state: WizardState, ev: WizardEvent): WizardState {
  // cancel always wins
  if (ev.type === 'cancel') return { kind: 'cancelled' }

  switch (state.kind) {
    case 'welcome': {
      if (ev.type === 'start') {
        return { kind: 'pickProvider', choices: PROVIDER_TEMPLATES }
      }
      return state
    }

    case 'pickProvider': {
      if (ev.type === 'pickedProvider') {
        return { kind: 'apiKey', provider: ev.template, key: '' }
      }
      if (ev.type === 'back') return { kind: 'welcome' }
      return state
    }

    case 'apiKey': {
      if (ev.type === 'enteredKey') {
        const key = ev.key
        return {
          kind: 'pickModel',
          provider: state.provider,
          key,
          models: state.provider.defaultModels.slice(),
          selected: state.provider.defaultModel,
        }
      }
      if (ev.type === 'back') {
        return { kind: 'pickProvider', choices: PROVIDER_TEMPLATES }
      }
      return state
    }

    case 'pickModel': {
      if (ev.type === 'pickedModel') {
        return {
          kind: 'verifying',
          provider: state.provider,
          key: state.key,
          model: ev.model,
        }
      }
      if (ev.type === 'back') {
        return { kind: 'apiKey', provider: state.provider, key: state.key }
      }
      return state
    }

    case 'verifying': {
      if (ev.type === 'probeOk') {
        const models = ev.models && ev.models.length > 0
          ? ev.models
          : state.provider.defaultModels.slice()
        const selected = models.includes(state.model) ? state.model : (models[0] ?? state.model)
        const config: ConfigPatch = {
          providerId: state.provider.id,
          name: state.provider.name,
          format: state.provider.type,
          baseUrl: state.provider.baseUrl,
          apiKey: state.key,
          models,
          selectedModel: selected,
        }
        return { kind: 'done', config }
      }
      if (ev.type === 'probeErr') {
        return {
          kind: 'error',
          message: ev.reason || 'verification failed',
          retryFrom: 'apiKey',
          provider: state.provider,
          key: state.key,
          model: state.model,
        }
      }
      if (ev.type === 'back') {
        return {
          kind: 'pickModel',
          provider: state.provider,
          key: state.key,
          models: state.provider.defaultModels.slice(),
          selected: state.model,
        }
      }
      return state
    }

    case 'error': {
      if (ev.type === 'back') {
        switch (state.retryFrom) {
          case 'welcome':
            return { kind: 'welcome' }
          case 'pickProvider':
            return { kind: 'pickProvider', choices: PROVIDER_TEMPLATES }
          case 'apiKey':
            if (state.provider) {
              return { kind: 'apiKey', provider: state.provider, key: state.key ?? '' }
            }
            return { kind: 'pickProvider', choices: PROVIDER_TEMPLATES }
          case 'pickModel':
            if (state.provider) {
              return {
                kind: 'pickModel',
                provider: state.provider,
                key: state.key ?? '',
                models: state.provider.defaultModels.slice(),
                selected: state.model,
              }
            }
            return { kind: 'pickProvider', choices: PROVIDER_TEMPLATES }
          case 'verifying':
            if (state.provider && state.model) {
              return {
                kind: 'verifying',
                provider: state.provider,
                key: state.key ?? '',
                model: state.model,
              }
            }
            return { kind: 'pickProvider', choices: PROVIDER_TEMPLATES }
        }
      }
      return state
    }

    case 'done':
    case 'cancelled':
      return state
  }
}
