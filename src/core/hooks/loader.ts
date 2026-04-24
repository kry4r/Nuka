// src/core/hooks/loader.ts
import { readFile } from 'node:fs/promises'
import type { HookEntry, HookEvent } from './types'

const VALID_EVENTS = new Set<HookEvent>([
  'beforeToolCall',
  'afterToolCall',
  'afterTurn',
  'beforeAutoCompact',
])

function isHookEvent(v: unknown): v is HookEvent {
  return typeof v === 'string' && VALID_EVENTS.has(v as HookEvent)
}

function parseEntry(raw: unknown, index: number): HookEntry | null {
  if (!raw || typeof raw !== 'object') {
    console.warn(`[plugin:hooks] entry[${index}] is not an object; skipping`)
    return null
  }
  const o = raw as Record<string, unknown>

  if (!isHookEvent(o['event'])) {
    console.warn(`[plugin:hooks] entry[${index}] has invalid event '${String(o['event'])}'; skipping`)
    return null
  }
  if (typeof o['command'] !== 'string' || o['command'].trim() === '') {
    console.warn(`[plugin:hooks] entry[${index}] has missing or empty command; skipping`)
    return null
  }

  const entry: HookEntry = { event: o['event'], command: o['command'] }
  if (typeof o['tool'] === 'string') entry.tool = o['tool']
  if (typeof o['timeoutMs'] === 'number' && o['timeoutMs'] > 0) entry.timeoutMs = o['timeoutMs']

  return entry
}

/**
 * Load hook entries from a hooks.json file.
 * Returns an empty array if the file is missing or malformed (with a warning).
 */
export async function loadHooks(hooksJsonPath: string): Promise<HookEntry[]> {
  let raw: string
  try {
    raw = await readFile(hooksJsonPath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    console.warn(`[plugin:hooks] cannot read ${hooksJsonPath}: ${(err as Error).message}`)
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err: unknown) {
    console.warn(`[plugin:hooks] failed to parse ${hooksJsonPath}: ${(err as Error).message}`)
    return []
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Record<string, unknown>)['hooks'])) {
    console.warn(`[plugin:hooks] ${hooksJsonPath}: expected { hooks: [...] }; ignoring`)
    return []
  }

  const entries = (parsed as { hooks: unknown[] }).hooks
  const result: HookEntry[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = parseEntry(entries[i], i)
    if (entry !== null) result.push(entry)
  }
  return result
}
