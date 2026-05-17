// src/core/outputStyles/resolve.ts
//
// Resolution layer that sits between the loader (which only knows how
// to read `.nuka/output-styles/*.md` off disk) and the agent's system
// prompt assembler (which only knows how to splice text). This module
// answers two questions:
//
//   1. Which style — if any — does the user want active right now?
//      Resolved via `selectActiveStyleName(env, config?)`. Currently
//      driven by the `NUKA_OUTPUT_STYLE` environment variable, with an
//      optional `config.outputStyle` field that the env var overrides.
//      Both unset → `undefined` → no style applied (default behaviour
//      is byte-for-byte unchanged from before this module existed).
//
//   2. Given an active name and the loaded styles, what's the matching
//      OutputStyle? Resolved via `resolveActiveOutputStyle`. Unknown
//      names silently resolve to `null` (matches the loader's
//      "malformed files are dropped" philosophy — a typo'd
//      NUKA_OUTPUT_STYLE shouldn't tear down the agent).
//
// The actual prompt-merge happens in `applyOutputStyle`, which
// implements the `keepCodingInstructions` semantics:
//
//   - `keepCodingInstructions: true` (default)  → APPEND the style
//     body to the base system prompt under a `## Output Style` header.
//     Base instructions stay intact; the style steers tone / format.
//
//   - `keepCodingInstructions: false`           → REPLACE the base
//     system prompt entirely with the style body. Used when a style
//     wants to fully redirect the agent (e.g. a research-only mode).
//
// All three exports are pure functions so the call-site integrations
// in `agent/systemPrompt.ts` (main loop) and `agents/dispatch.ts`
// (subagents) share identical merge semantics.
//
// Invariants honoured here:
//   • strict TS, no `any`, no new deps.
//   • Additive only: unset env + unset config → caller observes the
//     exact same prompt as before this file existed.
//   • Env var follows Nuka's `NUKA_<UPPER>` pattern (see
//     `NUKA_ACTIVE_PROVIDER_ID` in src/core/config/load.ts).

import type { OutputStyle } from './types'

/**
 * Environment variable name. Convention matches existing Nuka env vars
 * (`NUKA_ACTIVE_PROVIDER_ID`, etc) so users / scripts have a
 * predictable place to look.
 */
export const OUTPUT_STYLE_ENV_VAR = 'NUKA_OUTPUT_STYLE'

/**
 * Header injected before the style body when appending. Stable string
 * so prompt-caching layers see consistent boundaries across turns.
 */
export const OUTPUT_STYLE_SECTION_HEADER = '## Output Style'

/**
 * Pick the active output-style *name* (not the resolved entry). The
 * caller does the loader-lookup separately because (a) loader I/O
 * shouldn't be coupled to env-var parsing, and (b) the lookup step
 * needs to gracefully handle "name set but file missing" — easier when
 * the two steps are split.
 *
 * Precedence (highest wins):
 *   1. `env[NUKA_OUTPUT_STYLE]` — runtime override, useful for one-off
 *      invocations / CI.
 *   2. `config.outputStyle` — persistent project / user preference.
 *
 * Empty strings and whitespace-only values are treated as unset so
 * `NUKA_OUTPUT_STYLE=` (clearing the var inline) does the right thing.
 *
 * Returns `undefined` when neither source supplies a usable name —
 * callers MUST treat this as "no style; do nothing".
 */
export function selectActiveStyleName(
  env: NodeJS.ProcessEnv,
  config?: { outputStyle?: string },
): string | undefined {
  const envRaw = env[OUTPUT_STYLE_ENV_VAR]
  const envName = typeof envRaw === 'string' ? envRaw.trim() : ''
  if (envName.length > 0) return envName

  const cfgRaw = config?.outputStyle
  const cfgName = typeof cfgRaw === 'string' ? cfgRaw.trim() : ''
  if (cfgName.length > 0) return cfgName

  return undefined
}

/**
 * Look up a loaded OutputStyle by name. Case-sensitive (matches the
 * loader's storage key — there's no case-folding anywhere upstream so
 * introducing it here would create a confusing asymmetry). Returns
 * `null` for an unknown name; callers should fall back to the base
 * prompt unchanged in that case.
 */
export function resolveActiveOutputStyle(
  styles: readonly OutputStyle[],
  name: string | undefined,
): OutputStyle | null {
  if (name === undefined) return null
  for (const s of styles) {
    if (s.name === name) return s
  }
  return null
}

/**
 * Merge an output style into a base system prompt.
 *
 * Semantics driven by `style.keepCodingInstructions`:
 *
 *   - undefined / true → APPEND. Base stays verbatim, style body lands
 *     under `## Output Style` separated by a blank line. Trailing
 *     whitespace on the base is normalised so the joined string never
 *     has a doubled blank line.
 *
 *   - false → REPLACE. The entire base prompt is discarded; the style
 *     body alone is returned.
 *
 * Empty style body collapses to base in either mode (an output-style
 * file with only frontmatter shouldn't blank out the agent's
 * instructions).
 */
export function applyOutputStyle(
  basePrompt: string,
  style: OutputStyle,
): string {
  const body = style.prompt.trim()
  if (body.length === 0) return basePrompt

  const keep = style.keepCodingInstructions ?? true
  if (!keep) return body

  const base = basePrompt.replace(/\s+$/, '')
  return `${base}\n\n${OUTPUT_STYLE_SECTION_HEADER}\n\n${body}`
}
