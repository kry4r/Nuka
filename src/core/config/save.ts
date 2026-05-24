import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import path from 'node:path'
import type { ProviderConfig } from './schema'
import { ConfigSchema } from './schema'

function globalConfigFile(home: string): string {
  return path.join(home, '.nuka', 'config.yaml')
}

async function readConfig(home: string): Promise<any> {
  try {
    const text = await readFile(globalConfigFile(home), 'utf8')
    return parseYaml(text) ?? {}
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

async function writeConfig(home: string, obj: unknown): Promise<void> {
  await mkdir(path.join(home, '.nuka'), { recursive: true })
  ConfigSchema.parse(obj) // validate before writing
  await writeFile(globalConfigFile(home), stringifyYaml(obj), { encoding: 'utf8', mode: 0o600 })
}

export async function saveActiveSelection(home: string, providerId: string): Promise<void> {
  const obj = await readConfig(home)
  obj.active = { providerId }
  await writeConfig(home, obj)
}

export async function saveProviderSelectedModel(
  home: string,
  providerId: string,
  model: string,
): Promise<void> {
  const obj = await readConfig(home)
  const list: any[] = Array.isArray(obj.providers) ? obj.providers : []
  const p = list.find(x => x.id === providerId)
  if (!p) throw new Error(`provider not found: ${providerId}`)
  p.selectedModel = model
  if (!p.models?.includes(model)) p.models = [...(p.models ?? []), model]
  obj.providers = list
  await writeConfig(home, obj)
}

export async function saveVimEnabled(home: string, enabled: boolean): Promise<void> {
  const obj = await readConfig(home)
  obj.vim = { ...(obj.vim ?? {}), enabled }
  await mkdir(path.join(home, '.nuka'), { recursive: true })
  // Only validate the full schema when there is a provider selection;
  // in offline mode (no providers) we still want to persist the toggle.
  if (obj.active?.providerId) ConfigSchema.parse(obj)
  await writeFile(globalConfigFile(home), stringifyYaml(obj), { encoding: 'utf8', mode: 0o600 })
}

export async function saveTheme(home: string, themeName: string): Promise<void> {
  const obj = await readConfig(home)
  obj.theme = { ...(obj.theme ?? {}), name: themeName }
  await mkdir(path.join(home, '.nuka'), { recursive: true })
  // Only validate when there is a provider selection (same pattern as saveVimEnabled).
  if (obj.active?.providerId) ConfigSchema.parse(obj)
  await writeFile(globalConfigFile(home), stringifyYaml(obj), { encoding: 'utf8', mode: 0o600 })
}

export async function saveStatusBarHidden(home: string, hidden: string[]): Promise<void> {
  const obj = await readConfig(home)
  obj.statusBar = { ...(obj.statusBar ?? {}), hidden }
  await mkdir(path.join(home, '.nuka'), { recursive: true })
  if (obj.active?.providerId) ConfigSchema.parse(obj)
  await writeFile(globalConfigFile(home), stringifyYaml(obj), { encoding: 'utf8', mode: 0o600 })
}

/**
 * Phase 12 §4.7 — generic config patch helper used by ConfigSubmenu forms.
 * Reads YAML, runs the supplied mutator against the parsed object,
 * validates against ConfigSchema (only when there is an active provider, to
 * preserve the offline-mode behaviour of saveVimEnabled / saveTheme), and
 * writes back. Throws zod errors verbatim so the caller can pinpoint the
 * offending field for an inline error flash.
 */
export async function saveConfigPatch(
  home: string,
  mutate: (obj: any) => void,
): Promise<void> {
  const obj = await readConfig(home)
  mutate(obj)
  await mkdir(path.join(home, '.nuka'), { recursive: true })
  if (obj.active?.providerId) ConfigSchema.parse(obj)
  await writeFile(globalConfigFile(home), stringifyYaml(obj), { encoding: 'utf8', mode: 0o600 })
}

export async function addProvider(home: string, provider: ProviderConfig): Promise<void> {
  const obj = await readConfig(home)
  const list: any[] = Array.isArray(obj.providers) ? obj.providers : []
  if (list.some(p => p.id === provider.id)) {
    throw new Error(`provider id already exists: ${provider.id}`)
  }
  list.push(provider)
  obj.providers = list
  if (!obj.active) obj.active = { providerId: provider.id }
  await writeConfig(home, obj)
}
