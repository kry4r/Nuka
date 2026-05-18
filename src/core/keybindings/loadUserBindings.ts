import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { KeybindingsSchema } from './schema'
import type { KeybindingBlock } from './types'

/**
 * Read and validate `~/.nuka/keybindings.yaml`.
 * Returns null on ENOENT (no user file). Throws on schema validation errors
 * so misconfigurations surface immediately instead of silently dropping bindings.
 */
export async function readUserBindings(home: string): Promise<KeybindingBlock[] | null> {
  const filePath = path.join(home, '.nuka', 'keybindings.yaml')
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const parsed = parseYaml(raw)
  const file = KeybindingsSchema.parse(parsed)
  // Re-cast to KeybindingBlock[] — schema validates context/action enums so
  // the cast is sound. The record-value union (action | null) is preserved.
  return file.bindings as KeybindingBlock[]
}
