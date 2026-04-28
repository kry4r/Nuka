// src/core/skill/activation.ts
import type { Skill } from './types'
import type { Tool } from '../tools/types'
import type { ToolRegistry } from '../tools/registry'

/**
 * Compute the set of tools that should be exposed for a given (active)
 * skill. The semantics are ADDITIVE — see spec §4.3:
 *
 *   active = core ∪ queryByTags(skill.requires)
 *
 * where `core` is `tools.filter(t => t.tags.includes('core') || t.alwaysLoad)`.
 *
 * Behaviour matrix:
 *
 * - `skill === undefined`            → return `registry.list()` unchanged.
 *   This preserves the pre-skill default exposure currently used by the
 *   `agents/toolFilter` path: when no skill narrows the tool set, the
 *   model sees every registered tool. Narrowing only happens when a
 *   skill explicitly opts into it via `requires`.
 *
 * - `skill.requires` undefined / `[]` → return `core` only.
 *   The skill has been activated but declares no extra capabilities,
 *   so we expose just the always-on baseline.
 *
 * - otherwise                         → `core ∪ queryByTags(requires)`,
 *   deduplicated by `name`.
 */
export function activeToolsFor(
  skill: Skill | undefined,
  registry: ToolRegistry,
): Tool[] {
  const all = registry.list()

  if (skill === undefined) return all

  const core = all.filter((t) => (t.tags ?? []).includes('core') || t.alwaysLoad === true)

  const requires = skill.requires ?? []
  if (requires.length === 0) return core

  const extra = registry.queryByTags(requires)
  const seen = new Set<string>()
  const out: Tool[] = []
  for (const t of core) {
    if (!seen.has(t.name)) { seen.add(t.name); out.push(t) }
  }
  for (const t of extra) {
    if (!seen.has(t.name)) { seen.add(t.name); out.push(t) }
  }
  return out
}

/**
 * Compute the union of `activeToolsFor(s, registry)` across all matched
 * skills. See spec §4.3.
 *
 * - `skills` is empty → return `registry.list()` (full set). This preserves
 *   current loop behaviour when no skill is active: the model sees every
 *   registered tool unchanged.
 *
 * - Otherwise → union by `tool.name` of `activeToolsFor(s, registry)` for
 *   each skill in `skills`. Result is deduplicated by name, preserving the
 *   encounter order of the first occurrence of each tool.
 */
export function activeToolsForMany(
  skills: Skill[],
  registry: ToolRegistry,
): Tool[] {
  if (skills.length === 0) return registry.list()

  const seen = new Set<string>()
  const out: Tool[] = []
  for (const skill of skills) {
    for (const t of activeToolsFor(skill, registry)) {
      if (!seen.has(t.name)) {
        seen.add(t.name)
        out.push(t)
      }
    }
  }
  return out
}
