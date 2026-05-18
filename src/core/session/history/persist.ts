// src/core/session/history/persist.ts
import { SessionStore, DebouncedMetaWriter } from '../store'
import { sessionsDir } from '../paths'

export const PERSIST_ENV = 'NUKA_SESSION_PERSIST'

/**
 * B4 opt-in gate: when true the cli.tsx boot path wires SessionStore +
 * DebouncedMetaWriter into the SessionManager. When false the manager
 * runs in-memory only — matches pre-B4 behaviour. Defaults to false so
 * upgrading users do not silently start writing transcripts to disk.
 */
export function isPersistEnabled(env: NodeJS.ProcessEnv): boolean {
  const v = env[PERSIST_ENV]
  if (v === undefined) return false
  const lower = v.trim().toLowerCase()
  return lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on'
}

export type SessionPersistence = {
  store?: SessionStore
  metaWriter?: DebouncedMetaWriter
}

/**
 * Build the SessionManager persistence bundle gated by NUKA_SESSION_PERSIST.
 * When the gate is off (default), both fields are undefined and the manager
 * runs in-memory only — `--resume`/`/history` are unavailable. When on,
 * wires a SessionStore at `~/.nuka/sessions/` plus the debounced meta writer.
 */
export function buildSessionPersistence(opts: {
  home: string
  env: NodeJS.ProcessEnv
}): SessionPersistence {
  if (!isPersistEnabled(opts.env)) return {}
  const store = new SessionStore({ dir: sessionsDir(opts.home) })
  const metaWriter = new DebouncedMetaWriter(store)
  return { store, metaWriter }
}
