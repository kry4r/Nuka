// src/core/hooks/runner.ts
import { execa } from 'execa'
import type { HookEntry, HookEvent, HookResult } from './types'

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Run a single hook entry and return the result.
 */
async function runOne(entry: HookEntry, payload: unknown): Promise<HookResult> {
  try {
    const result = await execa('sh', ['-c', entry.command], {
      input: JSON.stringify(payload),
      timeout: entry.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      reject: false,
    })
    const stdout = result.stdout

    let parsed: unknown = null
    try {
      parsed = JSON.parse(stdout)
    } catch {
      // non-JSON stdout is fine; cancel defaults to false
    }

    const cancel =
      result.exitCode !== 0 &&
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>)['cancel'] === true

    const reason =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['reason'] === 'string'
        ? ((parsed as Record<string, unknown>)['reason'] as string)
        : undefined

    return { ok: true, cancel, reason, stdout }
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Run all hooks matching the given event (and optional tool name).
 * Returns the first cancel=true veto found, or { cancel: false } if none.
 * Non-fatal failures are logged as warnings.
 */
export async function runHooks(
  hooks: HookEntry[],
  event: HookEvent,
  payload: unknown,
  opts?: { tool?: string },
): Promise<{ cancel: boolean; reason?: string }> {
  const candidates = hooks.filter(h => {
    if (h.event !== event) return false
    if (h.tool !== undefined && opts?.tool !== undefined && h.tool !== opts.tool) return false
    return true
  })

  for (const entry of candidates) {
    const result = await runOne(entry, payload)
    if (!result.ok) {
      console.warn(`[plugin:hooks] ${event} hook failed: ${result.error}`)
      continue
    }
    if (result.cancel) {
      return { cancel: true, reason: result.reason }
    }
  }

  return { cancel: false }
}
