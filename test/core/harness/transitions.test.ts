import { describe, it, expect, beforeAll } from 'vitest'
import * as path from 'node:path'
import { canTransition } from '../../../src/core/harness/transitions'
import { initMatrix } from '../../../src/core/harness/matrix'

describe('canTransition', () => {
  beforeAll(() => initMatrix(path.join(process.cwd(), 'assets/harness/profiles.yaml')))

  it('allows brainstorm → spec for feature', () => {
    expect(canTransition({ from: 'brainstorm', to: 'spec', profile: 'feature', difficulty: 'medium', mode: 'deep' }).ok).toBe(true)
  })

  it('refuses implement for investigate profile (forbidden)', () => {
    const r = canTransition({ from: 'search', to: 'implement', profile: 'investigate', difficulty: 'medium', mode: 'deep' })
    expect(r.ok).toBe(false)
  })

  it('fast mode allows brainstorm → search', () => {
    expect(canTransition({ from: 'brainstorm', to: 'search', profile: 'feature', difficulty: 'medium', mode: 'fast' }).ok).toBe(true)
  })

  it('deep mode refuses brainstorm → implement', () => {
    expect(canTransition({ from: 'brainstorm', to: 'implement', profile: 'feature', difficulty: 'medium', mode: 'deep' }).ok).toBe(false)
  })

  it('terminal: recap has no out-edges', () => {
    expect(canTransition({ from: 'recap', to: 'implement', profile: 'feature', difficulty: 'medium', mode: 'deep' }).ok).toBe(false)
  })

  it('hell-debug-fix: brainstorm → spec still allowed (modifier raises spec to mandatory; mandatory != forbidden)', () => {
    expect(canTransition({ from: 'brainstorm', to: 'spec', profile: 'debug-fix', difficulty: 'hell', mode: 'deep' }).ok).toBe(true)
  })

  it('investigate/hell still forbidden for implement (red line)', () => {
    expect(canTransition({ from: 'search', to: 'implement', profile: 'investigate', difficulty: 'hell', mode: 'deep' }).ok).toBe(false)
  })

  it('mode=off bypasses everything', () => {
    expect(canTransition({ from: 'recap', to: 'implement', profile: 'investigate', difficulty: 'hell', mode: 'off' }).ok).toBe(true)
  })
})
