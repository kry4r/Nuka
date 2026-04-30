// src/core/harness/skills.ts
import type { HarnessStage, TaskProfile } from './types'

export type SkillBundle = { required: string[]; optional: string[]; forbidden: string[] }

export const TDD_PROFILES: TaskProfile[] = ['feature', 'fix', 'refactor']

export function pickSkillsForStage(stage: HarnessStage, profile: TaskProfile): SkillBundle {
  const tddRequiresProfile = TDD_PROFILES.includes(profile)
  switch (stage) {
    case 'brainstorm': return { required: ['superpowers:brainstorming'],     optional: ['claudeApi'], forbidden: ['tdd', 'simplify'] }
    case 'spec':       return { required: ['superpowers:writing-skills'],    optional: ['claudeApi'], forbidden: ['tdd'] }
    case 'plan':       return { required: ['superpowers:writing-plans'],     optional: ['claudeApi'], forbidden: ['tdd'] }
    case 'search':     return { required: ['loop'],                          optional: ['claudeApi'], forbidden: ['tdd'] }
    case 'implement':  return tddRequiresProfile
                          ? { required: ['tdd', 'simplify'], optional: [],  forbidden: [] }
                          : { required: ['simplify'],        optional: [],  forbidden: ['tdd'] }
    case 'review':     return { required: ['superpowers:requesting-code-review'], optional: [], forbidden: ['tdd'] }
    case 'recap':      return { required: [], optional: [], forbidden: ['tdd', 'simplify', 'superpowers:brainstorming', 'superpowers:writing-plans'] }
  }
}
