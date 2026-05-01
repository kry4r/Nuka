import type { TaskProfile, Difficulty, HarnessStage, StageRequirement } from './types'
import { loadProfilesYaml, stageReqFromConfig, type ProfilesConfig } from './profilesLoader'

let CFG: ProfilesConfig | null = null

export function initMatrix(yamlPath: string): void {
  CFG = loadProfilesYaml(yamlPath)
}

/**
 * Difficulty modifier — minimum stage-requirement floors imposed by the difficulty axis.
 * `hard` and `hell` push some stages up. `forbidden` is never overridden (red line).
 */
const DIFFICULTY_FLOOR: Record<Difficulty, Partial<Record<HarnessStage, StageRequirement>>> = {
  simple: {},
  medium: {},
  hard: { spec: 'mandatory' },
  hell: { spec: 'mandatory', review: 'mandatory' },
}

const ORDER: Record<StageRequirement, number> = { forbidden: 0, optional: 1, mandatory: 2 }

export function effectiveStageRequirement(
  profile: TaskProfile,
  difficulty: Difficulty,
  stage: HarnessStage,
): StageRequirement {
  if (!CFG) throw new Error('matrix not initialized; call initMatrix() first')
  const profileReq = stageReqFromConfig(CFG, profile, stage)
  if (profileReq === 'forbidden') return 'forbidden' // red line — difficulty cannot break it
  const floor = DIFFICULTY_FLOOR[difficulty][stage]
  if (!floor) return profileReq
  return ORDER[floor] > ORDER[profileReq] ? floor : profileReq
}

/**
 * Legacy single-axis API — kept for backwards-compat with `transitions.ts` until that
 * file is migrated to take a Triage. Defaults to `medium` difficulty so behavior matches
 * the pre-refactor baseline for callers that haven't been updated yet.
 *
 * @deprecated Use `effectiveStageRequirement(profile, difficulty, stage)` instead.
 */
export function stageRequirement(profile: TaskProfile, stage: HarnessStage): StageRequirement {
  return effectiveStageRequirement(profile, 'medium', stage)
}
