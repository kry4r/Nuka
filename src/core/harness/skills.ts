import type { HarnessStage, Triage } from './types'

export type SkillBundle = { required: string[]; optional: string[]; forbidden: string[] }

/**
 * Pick the skill bundle for a given stage given the full Triage (profile × difficulty × testStrategy).
 *
 * Key decisions:
 * - TDD is gated by `testStrategy === 'tdd' | 'cross-module' | 'multi-test'`, NOT by profile
 *   (a doc/odd-jobs task with `testStrategy: 'tdd'` still gets TDD).
 * - `cross-module` and `multi-test` add the requesting-code-review skill at review stage.
 * - `investigate` profile actively forbids TDD across all stages (it has no implement).
 */
export function pickSkillsForStage(stage: HarnessStage, triage: Triage): SkillBundle {
  const tddRequested = triage.testStrategy !== undefined // i.e. always defined; kept for clarity
  const tddAllowed = triage.profile !== 'investigate' && tddRequested

  switch (stage) {
    case 'brainstorm':
      return { required: ['superpowers:brainstorming'], optional: ['claudeApi'], forbidden: ['tdd', 'simplify'] }
    case 'spec':
      return { required: ['superpowers:writing-skills'], optional: ['claudeApi'], forbidden: ['tdd'] }
    case 'plan':
      return { required: ['superpowers:writing-plans'], optional: ['claudeApi'], forbidden: ['tdd'] }
    case 'search':
      return { required: ['loop'], optional: ['claudeApi'], forbidden: ['tdd'] }
    case 'implement':
      return tddAllowed
        ? { required: ['tdd', 'simplify'], optional: [], forbidden: [] }
        : { required: ['simplify'], optional: [], forbidden: ['tdd'] }
    case 'review': {
      const required = ['superpowers:requesting-code-review']
      // cross-module / multi-test pull in extra reviewer skills (placeholder names)
      if (triage.testStrategy === 'multi-test') required.push('superpowers:requesting-code-review')
      return { required, optional: [], forbidden: ['tdd'] }
    }
    case 'recap':
      return {
        required: [],
        optional: [],
        forbidden: ['tdd', 'simplify', 'superpowers:brainstorming', 'superpowers:writing-plans'],
      }
  }
}
