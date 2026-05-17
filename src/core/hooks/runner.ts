// src/core/hooks/runner.ts
import { execa } from 'execa'
import type { HookEntry, HookEvent, HookResult } from './types'
import type { HookRegistry } from './registry'
import {
  fireShellHookExecuted,
  hookEntryToHookId,
  truncatePreview,
  type ShellHookExecutedPayload,
} from './shellBridge'

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Run a single hook entry and return the result.
 *
 * Iter OOOO — also returns the raw execa metrics (exitCode, stderr, duration)
 * so {@link runHooks} can fire the optional in-process `shellHookExecuted`
 * bridge event with full context. The legacy {@link HookResult} return shape
 * is unchanged — the metrics ride alongside on a sibling field so existing
 * call sites don't shift.
 */
async function runOne(
  entry: HookEntry,
  payload: unknown,
): Promise<{ result: HookResult; exitCode: number; stderr: string; durationMs: number }> {
  const startedAt = Date.now()
  try {
    const execResult = await execa('sh', ['-c', entry.command], {
      input: JSON.stringify(payload),
      timeout: entry.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      reject: false,
    })
    const stdout = execResult.stdout
    const stderr = execResult.stderr
    const exitCode = typeof execResult.exitCode === 'number' ? execResult.exitCode : -1

    let parsed: unknown = null
    try {
      parsed = JSON.parse(stdout)
    } catch {
      // non-JSON stdout is fine; cancel defaults to false
    }

    const cancel =
      exitCode !== 0 &&
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>)['cancel'] === true

    const reason =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['reason'] === 'string'
        ? ((parsed as Record<string, unknown>)['reason'] as string)
        : undefined

    return {
      result: { ok: true, cancel, reason, stdout },
      exitCode,
      stderr,
      durationMs: Date.now() - startedAt,
    }
  } catch (err: unknown) {
    return {
      result: { ok: false, error: (err as Error).message },
      exitCode: -1,
      stderr: '',
      durationMs: Date.now() - startedAt,
    }
  }
}

/**
 * Options accepted by {@link runHooks}.
 *
 * - `tool`: existing tool-name filter (only fires hooks whose entry-level
 *   `tool` field matches OR is unset).
 * - `registry`: Iter OOOO — when supplied, fire an in-process
 *   `shellHookExecuted` event on the registry after each shell hook
 *   execution. Backward-compatible: omit to keep the legacy behaviour
 *   (no bridge fires). The registry never influences the shell hook's
 *   own outcome — handlers are pure observers.
 */
export type RunHooksOptions = {
  tool?: string
  registry?: HookRegistry
}

/**
 * Run all hooks matching the given event (and optional tool name).
 * Returns the first cancel=true veto found, or { cancel: false } if none.
 * Non-fatal failures are logged as warnings.
 *
 * Iter OOOO — when `opts.registry` is supplied, after every shell hook
 * execution (success, failure, cancel, or non-cancel) the registry's
 * `shellHookExecuted` event is fired with a digest of the run. The bridge
 * fire is best-effort and CANNOT influence the shell hook's outcome — the
 * shell runner's veto loop is untouched.
 */
export async function runHooks(
  hooks: HookEntry[],
  event: HookEvent,
  payload: unknown,
  opts?: RunHooksOptions,
): Promise<{ cancel: boolean; reason?: string }> {
  const candidates = hooks.filter(h => {
    if (h.event !== event) return false
    if (h.tool !== undefined && opts?.tool !== undefined && h.tool !== opts.tool) return false
    return true
  })

  for (const entry of candidates) {
    const { result, exitCode, stderr, durationMs } = await runOne(entry, payload)

    if (opts?.registry) {
      // `command` is required on the bridge payload; `entry.command` is
      // typed as `string`, so the truncate is non-null. The other previews
      // can legitimately be `undefined` (e.g. when launch failed), so we
      // pass them through as-is.
      const commandPreview = truncatePreview(entry.command, 500) ?? ''
      const bridgePayload: ShellHookExecutedPayload = {
        event,
        hookId: hookEntryToHookId(entry),
        command: commandPreview,
        exitCode,
        stdoutPreview: result.ok ? truncatePreview(result.stdout, 500) : undefined,
        stderrPreview: truncatePreview(stderr, 500),
        canceled: result.ok ? Boolean(result.cancel) : false,
        durationMs,
        ...(result.ok ? {} : { errorMessage: result.error }),
        ...(opts.tool !== undefined ? { tool: opts.tool } : {}),
      }
      // Bridge fire is fire-and-forget — observer handlers must never
      // affect the shell hook outcome. We await so handlers see the event
      // in deterministic order, but swallow any registry-level throw so
      // a buggy registry can't crash the shell veto loop.
      try {
        await fireShellHookExecuted(opts.registry, bridgePayload)
      } catch {
        // swallow — bridge is best-effort
      }
    }

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
