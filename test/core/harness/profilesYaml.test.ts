import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { loadProfilesYaml } from '../../../src/core/harness/profilesLoader'

const YAML = path.join(process.cwd(), 'assets/harness/profiles.yaml')

describe('profiles.yaml loader', () => {
  it('加载 6 个 profile', () => {
    const p = loadProfilesYaml(YAML)
    expect(Object.keys(p.profiles).sort()).toEqual(['debug-fix', 'doc', 'feature', 'investigate', 'odd-jobs', 'refactor'])
  })
  it('investigate.implement = forbidden', () => {
    const p = loadProfilesYaml(YAML)
    expect(p.profiles.investigate.stages.implement).toBe('forbidden')
  })
  it('feature 全 mandatory', () => {
    const p = loadProfilesYaml(YAML)
    expect(p.profiles.feature.stages.brainstorm).toBe('mandatory')
  })
})
