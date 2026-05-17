// src/core/skill/bundled.ts
//
// In-process bundled skill registry. Ports the *pattern* from
// Nuka-Code's `src/skills/bundledSkills.ts` (the `registerBundledSkill` /
// `getBundledSkills` / `clearBundledSkills` triple), adapted to Nuka's
// `Skill` shape from `./types`.
//
// Scope notes (see docs/plans/2026-05-17-nuka-feature-port-status.md #11):
//
// - `mcpSkillBuilders.ts` is deliberately NOT ported — Nuka does not
//   support MCP. The Nuka-Code module is dead code in this context.
// - Nuka-Code `loadSkillsDir.ts` (~1000 LOC of multi-source disk loading
//   with realpath dedup, dynamic discovery, conditional paths, deprecated
//   /commands/ shim) is NOT ported wholesale. Nuka's existing
//   `./loader.ts:loadSkills({home, cwd})` already covers Nuka's two-source
//   (cwd + home) disk layout and frontmatter contract; this file is
//   additive — it sits alongside the disk loader rather than replacing it.
// - The 17 individual `bundled/*.ts` from Nuka-Code are NOT ported either:
//   their bodies depend on Nuka-Code-internal tool/feature surfaces that
//   have no analogue here. The registry below is the infrastructure that
//   would *let* such skills be added later if any are ever written.

import type { Skill, SkillFrontmatter } from './types'

/**
 * Definition for a bundled (in-process) skill. Mirrors a parsed
 * `.nuka/skills/<name>.md` from `loader.ts:parseSkill` so the activator
 * (`activator.ts`) and tool surface (`skillTool.ts`) can consume bundled
 * skills the same way as disk skills, with no special-casing.
 *
 * `path` defaults to a synthetic `<bundled>:<name>` marker; supply your
 * own if you need it to be human-meaningful in logs.
 */
export type BundledSkillDefinition = {
  name: string
  description?: string
  when?: SkillFrontmatter['when']
  requires?: string[]
  body: string
  path?: string
}

const bundledSkills: Skill[] = []

/**
 * Register a bundled skill that will be available alongside disk-loaded
 * skills. Call this at module init (e.g. from a manifest module) before
 * the agent loop begins. Idempotent on `name`: a second registration
 * with the same name replaces the first (matching the project-overrides-
 * global semantics in `loader.ts:loadSkills`).
 */
export function registerBundledSkill(def: BundledSkillDefinition): void {
  const skill: Skill = {
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    when: def.when ?? 'on-session-start',
    ...(def.requires !== undefined ? { requires: def.requires } : {}),
    body: def.body,
    source: 'global',
    path: def.path ?? `<bundled>:${def.name}`,
  }
  const idx = bundledSkills.findIndex((s) => s.name === skill.name)
  if (idx >= 0) {
    bundledSkills[idx] = skill
  } else {
    bundledSkills.push(skill)
  }
}

/**
 * Return all registered bundled skills. A defensive copy is returned so
 * callers cannot mutate the registry through the result.
 */
export function getBundledSkills(): Skill[] {
  return [...bundledSkills]
}

/**
 * Clear the bundled skill registry. Test-only — production code never
 * needs to deregister bundled skills.
 */
export function clearBundledSkills(): void {
  bundledSkills.length = 0
}
