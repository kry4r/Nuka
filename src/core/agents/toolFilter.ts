// src/core/agents/toolFilter.ts
import type { Tool } from '../tools/types'

/**
 * Filter a tool list by an agent's allow/deny declarations.
 *
 * Rules:
 * - No allowedTools + no deniedTools → return all tools unchanged.
 * - `allowedTools` is an exact-name whitelist (matches plugin namespaced
 *   names like `plugin__myplugin__readFile` directly).
 * - `deniedTools` removes names from the result of the whitelist step.
 *
 * When both are provided the result is `allowedTools - deniedTools`.
 */
export function filterTools(
  all: Tool[],
  def: { allowedTools?: string[]; deniedTools?: string[] },
): Tool[] {
  const { allowedTools, deniedTools } = def
  let out = all
  if (allowedTools !== undefined) {
    const allowSet = new Set(allowedTools)
    out = out.filter(t => allowSet.has(t.name))
  }
  if (deniedTools !== undefined && deniedTools.length > 0) {
    const denySet = new Set(deniedTools)
    out = out.filter(t => !denySet.has(t.name))
  }
  return out
}
