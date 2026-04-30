// src/core/harness/matrix.ts
import type { TaskProfile, HarnessStage, StageRequirement } from './types'

const M: Record<TaskProfile, Record<HarnessStage, StageRequirement>> = {
  explore:  { brainstorm: 'optional',  spec: 'forbidden', plan: 'optional',  search: 'mandatory', implement: 'forbidden', review: 'optional',  recap: 'mandatory' },
  fix:      { brainstorm: 'optional',  spec: 'optional',  plan: 'mandatory', search: 'mandatory', implement: 'mandatory', review: 'mandatory', recap: 'mandatory' },
  refactor: { brainstorm: 'optional',  spec: 'mandatory', plan: 'mandatory', search: 'mandatory', implement: 'mandatory', review: 'mandatory', recap: 'mandatory' },
  feature:  { brainstorm: 'mandatory', spec: 'mandatory', plan: 'mandatory', search: 'mandatory', implement: 'mandatory', review: 'mandatory', recap: 'mandatory' },
  docs:     { brainstorm: 'optional',  spec: 'optional',  plan: 'optional',  search: 'mandatory', implement: 'mandatory', review: 'optional',  recap: 'mandatory' },
  config:   { brainstorm: 'optional',  spec: 'optional',  plan: 'optional',  search: 'mandatory', implement: 'mandatory', review: 'optional',  recap: 'mandatory' },
  research: { brainstorm: 'mandatory', spec: 'optional',  plan: 'optional',  search: 'mandatory', implement: 'forbidden', review: 'optional',  recap: 'mandatory' },
}

export function stageRequirement(profile: TaskProfile, stage: HarnessStage): StageRequirement {
  return M[profile][stage]
}
