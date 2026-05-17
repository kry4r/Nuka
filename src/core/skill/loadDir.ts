// src/core/skill/loadDir.ts
//
// Unified loader that combines in-process bundled skills
// (`./bundled.ts:getBundledSkills`) with on-disk skills from
// `~/.nuka/skills/` and `<cwd>/.nuka/skills/` (`./loader.ts:loadSkills`).
//
// This is the analogue of Nuka-Code's `src/skills/loadSkillsDir.ts`
// orchestration entry point, scaled down to Nuka's two-source disk model
// (no managed/policy dir, no `--add-dir`, no deprecated /commands/ shim,
// no realpath-based dedup, no conditional path-matched activation, no MCP).
//
// Precedence (last-write wins on `name`, matching `loader.ts:loadSkills`):
//
//   1. bundled  — earliest, can be shadowed by any disk skill
//   2. global   — `<home>/.nuka/skills/*.md`
//   3. project  — `<cwd>/.nuka/skills/*.md`
//
// This file is additive: existing callers of `loadSkills()` keep working
// unchanged; new call sites that want the bundled set merged in choose
// `loadAllSkills()`.

import { getBundledSkills } from './bundled'
import { loadSkills } from './loader'
import type { Skill } from './types'

export async function loadAllSkills(opts: {
  home: string
  cwd: string
}): Promise<Skill[]> {
  const [disk, bundled] = await Promise.all([
    loadSkills(opts),
    Promise.resolve(getBundledSkills()),
  ])

  const byName = new Map<string, Skill>()
  for (const skill of bundled) byName.set(skill.name, skill)
  for (const skill of disk) byName.set(skill.name, skill)
  return [...byName.values()]
}
