// src/core/session/history/persist.ts
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
