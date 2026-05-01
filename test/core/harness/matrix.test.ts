import { describe, it, expect, beforeAll } from 'vitest'
import * as path from 'node:path'
import { effectiveStageRequirement, initMatrix } from '../../../src/core/harness/matrix'

describe('matrix', () => {
  beforeAll(() => initMatrix(path.join(process.cwd(), 'assets/harness/profiles.yaml')))

  it('feature/medium = profile 默认值 (brainstorm mandatory)', () => {
    expect(effectiveStageRequirement('feature', 'medium', 'brainstorm')).toBe('mandatory')
  })

  it('debug-fix/hard 把 spec 提到 mandatory（modifier 提升）', () => {
    expect(effectiveStageRequirement('debug-fix', 'hard', 'spec')).toBe('mandatory')
  })

  it('debug-fix/medium 的 spec 仍是 optional（无 modifier）', () => {
    expect(effectiveStageRequirement('debug-fix', 'medium', 'spec')).toBe('optional')
  })

  it('investigate/hell 不会突破 forbidden 红线', () => {
    expect(effectiveStageRequirement('investigate', 'hell', 'implement')).toBe('forbidden')
  })

  it('odd-jobs/simple 把 implement 保持 mandatory（不下调）', () => {
    expect(effectiveStageRequirement('odd-jobs', 'simple', 'implement')).toBe('mandatory')
  })

  it('refactor/hell review 保持 mandatory', () => {
    expect(effectiveStageRequirement('refactor', 'hell', 'review')).toBe('mandatory')
  })
})
