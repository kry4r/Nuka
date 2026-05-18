import { afterEach, describe, expect, it } from 'vitest'
import {
  clearBundledSkills,
  getBundledSkills,
  registerBundledSkill,
} from '../../../src/core/skill/bundled'

describe('registerBundledSkill — buildBody', () => {
  afterEach(() => clearBundledSkills())

  it('resolves buildBody eagerly at registration time', () => {
    let calls = 0
    registerBundledSkill({
      name: 'demo',
      buildBody: () => {
        calls++
        return 'computed-body'
      },
    })
    expect(calls).toBe(1)
    const [skill] = getBundledSkills()
    expect(skill?.body).toBe('computed-body')
  })

  it('prefers buildBody over body when both are present', () => {
    registerBundledSkill({
      name: 'demo',
      body: 'static',
      buildBody: () => 'dynamic',
    })
    expect(getBundledSkills()[0]?.body).toBe('dynamic')
  })

  it('falls back to body when buildBody is absent', () => {
    registerBundledSkill({ name: 'demo', body: 'static-only' })
    expect(getBundledSkills()[0]?.body).toBe('static-only')
  })

  it('throws when neither body nor buildBody is provided', () => {
    expect(() =>
      registerBundledSkill({ name: 'bad' } as never),
    ).toThrow(/body or buildBody/)
  })
})
