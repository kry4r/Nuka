import { describe, it, expect } from 'vitest'
import { canTransition } from '../../../src/core/harness/transitions'

describe('canTransition', () => {
  it('allows brainstorm → spec for feature', () => {
    expect(canTransition({ from: 'brainstorm', to: 'spec', profile: 'feature', mode: 'deep' }).ok).toBe(true)
  })
  it('refuses implement for explore profile', () => {
    const r = canTransition({ from: 'search', to: 'implement', profile: 'explore', mode: 'deep' })
    expect(r.ok).toBe(false)
  })
  it('fast mode allows brainstorm → search', () => {
    expect(canTransition({ from: 'brainstorm', to: 'search', profile: 'feature', mode: 'fast' }).ok).toBe(true)
  })
  it('deep mode refuses brainstorm → implement', () => {
    expect(canTransition({ from: 'brainstorm', to: 'implement', profile: 'feature', mode: 'deep' }).ok).toBe(false)
  })
  it('terminal: recap has no out-edges', () => {
    expect(canTransition({ from: 'recap', to: 'implement', profile: 'feature', mode: 'deep' }).ok).toBe(false)
  })
})
