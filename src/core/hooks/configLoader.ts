// src/core/hooks/configLoader.ts
//
// In-process hook config loader — sibling to `loader.ts` (which handles
// shell-command hooks). This loader dynamically `import()`s a JS/TS module
// that exports an array of `{ event, handler, id?, priority? }` entries
// and registers them against a `HookRegistry`.
//
// Why a JS module rather than JSON: in-process hooks are *functions*. The
// shell-hook loader handles the JSON declarative case (entries are strings
// describing shell commands); the in-process system mirrors upstream
// Nuka-Code's plugin-as-module pattern by importing user code directly.
//
// Default search paths: `${cwd}/.nuka/hooks.config.{js,mjs}` and
// `${home}/.nuka/hooks.config.{js,mjs}`. Missing files are a no-op (graceful
// — the typical install has none); only files that *exist* and fail to
// import or validate produce errors.
//
// Wiring: `cli.tsx` calls `applyHookConfig(hookRegistry, path)` for each
// default path during startup. Errors are collected and surfaced via
// `console.warn`; they do not block boot.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HookHandler, InProcessHookEvent } from './events'
import type { HookRegistry } from './registry'

/**
 * One declarative hook entry. The `handler` is a function the module
 * exports inline (since in-process hooks are functions, not strings).
 */
export interface HookConfigEntry {
  event: InProcessHookEvent
  handler: HookHandler
  /** Stable handler ID — see `RegisterOptions.id`. */
  id?: string
  /** Higher runs earlier — see `RegisterOptions.priority`. */
  priority?: number
}

/**
 * Shape of a hooks-config module. Either a `default` export or a named
 * `hooks` export is accepted; the loader prefers `default` when both exist.
 */
export interface HookConfigModule {
  default?: HookConfigEntry[]
  hooks?: HookConfigEntry[]
}

/**
 * Result of applying a single config file. `registered` counts handlers
 * that were successfully registered; `errors` includes both the
 * import/validation error (if the file existed but couldn't be loaded)
 * and per-entry registration errors (rare — `HookRegistry.register` throws
 * on invalid event / non-function handler, both of which `loadHookConfigFile`
 * pre-validates anyway).
 */
export interface ApplyHookConfigResult {
  registered: number
  errors: Error[]
}

/**
 * Load (and validate) entries from a hook-config JS module. Missing path →
 * returns `[]` (so callers can blindly iterate default search paths).
 *
 * Validation: every entry must have an `event` and a function `handler`.
 * Anything else throws — descriptive `Error` with the offending entry
 * JSON-stringified for grepability.
 */
export async function loadHookConfigFile(configPath: string): Promise<HookConfigEntry[]> {
  if (!existsSync(configPath)) return []

  // Resolve to an absolute file:// URL — ESM dynamic import on Node treats
  // bare strings as package specifiers, so e.g. `./.nuka/hooks.config.js`
  // would fail with ERR_UNSUPPORTED_ESM_URL_SCHEME. `pathToFileURL` handles
  // OS-specific path quirks (Windows drive letters etc.) too.
  const absolutePath = resolve(configPath)
  const fileUrl = pathToFileURL(absolutePath).href
  const mod = (await import(fileUrl)) as HookConfigModule
  const entries = mod.default ?? mod.hooks ?? []

  if (!Array.isArray(entries)) {
    throw new Error(
      `Invalid hook config in ${configPath}: expected an array export (default or 'hooks'), got ${typeof entries}`,
    )
  }

  for (const e of entries) {
    if (!e || typeof e !== 'object') {
      throw new Error(`Invalid hook entry in ${configPath}: ${JSON.stringify(e)}`)
    }
    if (typeof e.event !== 'string' || (e.event as string) === '') {
      throw new Error(`Invalid hook entry in ${configPath}: missing or empty 'event' — ${JSON.stringify(e)}`)
    }
    if (typeof e.handler !== 'function') {
      throw new Error(`Invalid hook entry in ${configPath}: 'handler' must be a function — ${JSON.stringify({ ...e, handler: typeof e.handler })}`)
    }
  }

  return entries
}

/**
 * Load + register every entry from `configPath` against `registry`. The
 * function never throws — file-level errors (missing module, invalid
 * shape) and per-entry errors (registry rejection) are both collected
 * into `errors`. Successfully registered entries continue to count
 * toward `registered` even if a sibling entry fails.
 */
export async function applyHookConfig(
  registry: HookRegistry,
  configPath: string,
): Promise<ApplyHookConfigResult> {
  const errors: Error[] = []
  let registered = 0
  let entries: HookConfigEntry[] = []

  try {
    entries = await loadHookConfigFile(configPath)
  } catch (e) {
    errors.push(e instanceof Error ? e : new Error(String(e)))
    return { registered, errors }
  }

  for (const entry of entries) {
    try {
      const opts: { id?: string; priority?: number } = {}
      if (entry.id !== undefined) opts.id = entry.id
      if (entry.priority !== undefined) opts.priority = entry.priority
      registry.register(entry.event, entry.handler, opts)
      registered++
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)))
    }
  }

  return { registered, errors }
}

/**
 * Default search locations for hook config modules. Returns paths in
 * priority order: cwd-local first, then user-home. Callers iterate the
 * full list — each path is independently optional.
 */
export function defaultHookConfigPaths(cwd: string = process.cwd(), home: string = process.env['HOME'] ?? ''): string[] {
  const paths: string[] = [
    `${cwd}/.nuka/hooks.config.js`,
    `${cwd}/.nuka/hooks.config.mjs`,
  ]
  if (home) {
    paths.push(`${home}/.nuka/hooks.config.js`)
    paths.push(`${home}/.nuka/hooks.config.mjs`)
  }
  return paths
}
