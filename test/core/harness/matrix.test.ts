import { describe, it, expect } from 'vitest'
import { stageRequirement } from '../../../src/core/harness/matrix'

describe('stageRequirement', () => {
  it('explore profile forbids implement', () => {
    expect(stageRequirement('explore', 'implement')).toBe('forbidden')
  })
  it('feature profile mandates spec', () => {
    expect(stageRequirement('feature', 'spec')).toBe('mandatory')
  })
  it('docs profile keeps implement optional+no-tdd', () => {
    expect(stageRequirement('docs', 'implement')).toBe('mandatory')
  })
  it('research profile forbids implement', () => {
    expect(stageRequirement('research', 'implement')).toBe('forbidden')
  })
})
