// src/core/onboarding/templates.ts
//
// Provider templates used by the first-run onboarding wizard.
// Each template carries enough info to render the picker, prefill
// sensible defaults, and run a cheap "is this key valid?" probe.

export type ProviderTemplateId = 'anthropic' | 'openai' | 'custom'

export type ProviderTemplate = {
  /** stable, machine-readable id */
  id: ProviderTemplateId
  /** provider format used by the resolver/clients */
  type: 'anthropic' | 'openai'
  /** display name */
  name: string
  /** API base URL */
  baseUrl: string
  /** the model selected by default if user accepts the suggestion */
  defaultModel: string
  /** seed list shown to the user before any /v1/models probe overrides it */
  defaultModels: string[]
  /** environment variable typically used for this provider's key */
  apiKeyEnvVar: string
  /** human-readable URL pointing to where to obtain a key */
  helpUrl: string
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'anthropic',
    type: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    defaultModels: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    helpUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5',
    defaultModels: [
      'gpt-5',
      'gpt-4o',
      'gpt-4o-mini',
    ],
    apiKeyEnvVar: 'OPENAI_API_KEY',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    // Free-form provider — user supplies the name, baseUrl, format and model.
    id: 'custom',
    type: 'openai',
    name: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    defaultModel: '',
    defaultModels: [],
    apiKeyEnvVar: '',
    helpUrl: 'https://github.com/kry4r/Nuka#custom-providers',
  },
]

export function findTemplate(id: ProviderTemplateId): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find(t => t.id === id)
}
