// src/core/onboarding/save.ts
//
// Glue between the wizard's terminal `ConfigPatch` and the on-disk
// `~/.nuka/config.yaml`.

import type { ConfigPatch } from './wizard'
import type { ProviderConfig } from '../config/schema'
import { addProvider, saveActiveSelection } from '../config/save'

export function patchToProvider(patch: ConfigPatch): ProviderConfig {
  return {
    id: patch.providerId,
    name: patch.name,
    format: patch.format,
    baseUrl: patch.baseUrl,
    apiKey: patch.apiKey,
    models: patch.models,
    selectedModel: patch.selectedModel,
  }
}

/**
 * Persist a wizard-produced config patch:
 *   - adds the provider entry (errors if id already exists)
 *   - sets it as the active provider
 */
export async function saveWizardPatch(home: string, patch: ConfigPatch): Promise<void> {
  const provider = patchToProvider(patch)
  await addProvider(home, provider)
  await saveActiveSelection(home, provider.id)
}
