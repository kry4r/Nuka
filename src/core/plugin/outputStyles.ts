// src/core/plugin/outputStyles.ts
/**
 * Registry and matcher for plugin-provided custom tool-result renderers.
 * Plugins declare `outputStyles` in their manifest; each entry specifies:
 *  - which tool name to match (glob, `*` only)
 *  - optionally which source to match
 *  - the path to the React component to render the result
 */

import type { ContentBlock } from '../tools/types'

export type OutputStyleDef = {
  name: string
  /** Glob pattern for the tool name, e.g. "myplugin__*". Uses `*` only. */
  matchToolName?: string
  /** Match on tool source. */
  matchToolSource?: 'plugin' | 'skill' | 'builtin'
  /** Relative path (from plugin root) to the React component module. */
  componentPath: string
}

export type OutputStyleProps = {
  toolName: string
  input: unknown
  output: string | ContentBlock[]
  isError: boolean
}

/** Module-level registry of registered output styles (in registration order). */
const _registry: OutputStyleDef[] = []

export function registerOutputStyle(def: OutputStyleDef): void {
  _registry.push(def)
}

export function getRegistry(): readonly OutputStyleDef[] {
  return _registry
}

/** Clear the registry (used in tests). */
export function clearRegistry(): void {
  _registry.length = 0
}

/**
 * Minimal glob match: supports `*` as a wildcard that matches any sequence
 * of characters (but not across segments for correctness). This is a flat
 * string matcher — no path-segment semantics needed here.
 */
export function globMatch(pattern: string, value: string): boolean {
  // Escape regex special characters, then replace \* with .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
}

/**
 * Find the first OutputStyleDef that matches the given tool name and source.
 * Returns `undefined` if no match.
 */
export function matchStyle(
  toolName: string,
  source: 'builtin' | 'skill' | 'plugin' | undefined,
  defs: OutputStyleDef[],
): OutputStyleDef | undefined {
  for (const def of defs) {
    if (def.matchToolName !== undefined && !globMatch(def.matchToolName, toolName)) {
      continue
    }
    if (def.matchToolSource !== undefined && def.matchToolSource !== source) {
      continue
    }
    return def
  }
  return undefined
}
