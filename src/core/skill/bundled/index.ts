// src/core/skill/bundled/index.ts
//
// Entry point for the bundled (in-process) skill registry. Tier-1 set
// only — tier-2 / DROP skills are catalogued in the appendix of
// `docs/plans/2026-05-18-skills-bundled-migration.md`.
//
// Each `register*Skill()` is responsible for its own env-gate. Skills
// with no gate (simplify, skillify) always register; opt-in skills
// no-op when their env is unset. The underlying registry dedupes by
// name, so calling `initBundledSkills()` more than once is safe.

import { registerLoremIpsumSkill } from './loremIpsum'
import { registerRememberSkill } from './remember'
import { registerSimplifySkill } from './simplify'
import { registerSkillifySkill } from './skillify'
import { registerStuckSkill } from './stuck'

/**
 * Register all bundled tier-1 skills into the in-process registry.
 *
 * Intended to be called once at loader bootstrap (lowest precedence,
 * so disk-loaded skills with the same name override). Idempotent.
 */
export function initBundledSkills(): void {
  registerSimplifySkill()
  registerSkillifySkill()
  registerLoremIpsumSkill()
  registerRememberSkill()
  registerStuckSkill()
}
