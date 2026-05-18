// src/core/cost/displayEnabled.ts
//
// Single env-gate predicate for the real-time cost display. Centralised so
// every callsite (CLI bootstrap, TUI banner, exit summary) reads the same
// env var with the same parsing rules.
//
// Strict literal `'1'` semantics match the rest of the codebase
// (NUKA_RECENT_FILES_NO_PERSIST, NUKA_JSON_FORMAT_HOOK, etc.). We deliberately
// do not accept 'true'/'yes' to keep the on/off contract unambiguous.

export const COST_DISPLAY_ENV = 'NUKA_COST_DISPLAY'

/**
 * Returns `true` iff the cost-display env var is set to exactly `'1'`.
 *
 * @param env Optional environment map; defaults to `process.env`. Useful for
 *            tests that need to override without mutating the real env.
 */
export function isCostDisplayEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env[COST_DISPLAY_ENV] === '1'
}
