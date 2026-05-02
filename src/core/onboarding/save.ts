// src/core/onboarding/save.ts
//
// Glue between the wizard's terminal `ConfigPatch` and the on-disk
// `~/.nuka/config.yaml`.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
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

/** Read the existing provider id list (best-effort; returns [] on any error). */
async function readExistingProviderIds(home: string): Promise<string[]> {
  try {
    const file = path.join(home, '.nuka', 'config.yaml')
    const text = await readFile(file, 'utf8')
    const obj = parseYaml(text) ?? {}
    const list = Array.isArray(obj.providers) ? obj.providers : []
    return list
      .map((p: { id?: unknown }) => (typeof p?.id === 'string' ? p.id : ''))
      .filter((s: string) => s.length > 0)
  } catch {
    return []
  }
}

/**
 * Pick a non-colliding provider id. If `desired` is free, returns it;
 * otherwise appends `-2`, `-3`, … until a free id is found. Used so that
 * adding a second "Custom" provider through the wizard doesn't fail with
 * "provider id already exists".
 */
export function uniqueProviderId(desired: string, existing: readonly string[]): string {
  if (!existing.includes(desired)) return desired
  for (let n = 2; n < 1000; n++) {
    const candidate = `${desired}-${n}`
    if (!existing.includes(candidate)) return candidate
  }
  // Fallback that is virtually guaranteed to be unique even on pathological inputs.
  return `${desired}-${Date.now()}`
}

/**
 * Persist a wizard-produced config patch:
 *   - adds the provider entry (auto-suffixing the id on collision so a
 *     second "Custom" provider doesn't clobber the first)
 *   - sets it as the active provider
 */
export async function saveWizardPatch(home: string, patch: ConfigPatch): Promise<void> {
  const existing = await readExistingProviderIds(home)
  const id = uniqueProviderId(patch.providerId, existing)
  const provider = patchToProvider({ ...patch, providerId: id })
  await addProvider(home, provider)
  await saveActiveSelection(home, provider.id)
}
