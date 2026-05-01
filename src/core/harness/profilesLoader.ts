import * as fs from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'
import type { TaskProfile, HarnessStage, StageRequirement } from './types'

const StageReq = z.enum(['mandatory', 'optional', 'forbidden'])

const ProfileSpec = z.object({
  stages: z.object({
    brainstorm: StageReq,
    spec: StageReq,
    plan: StageReq,
    search: StageReq,
    implement: StageReq,
    review: StageReq,
    recap: StageReq,
  }),
})

const Schema = z.object({
  profiles: z.record(z.string(), ProfileSpec),
})

export type ProfilesConfig = z.infer<typeof Schema>

export function loadProfilesYaml(filePath: string): ProfilesConfig {
  const raw = fs.readFileSync(filePath, 'utf8')
  return Schema.parse(parse(raw))
}

export function stageReqFromConfig(
  cfg: ProfilesConfig,
  profile: TaskProfile,
  stage: HarnessStage,
): StageRequirement {
  const p = cfg.profiles[profile]
  if (!p) throw new Error(`profile not found in YAML: ${profile}`)
  return p.stages[stage]
}
