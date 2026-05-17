import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import {
  registerBundledSkill,
  getBundledSkills,
  clearBundledSkills,
} from '../../../src/core/skill/bundled'
import { loadAllSkills } from '../../../src/core/skill/loadDir'

function tmp(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-skill-bundled-'))
}

function skillsDir(base: string): string {
  const dir = join(base, '.nuka', 'skills')
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('bundled skills registry', () => {
  beforeEach(() => {
    clearBundledSkills()
  })

  it('starts empty and returns a defensive copy', () => {
    expect(getBundledSkills()).toEqual([])

    registerBundledSkill({ name: 'a', body: 'A' })
    const snapshot = getBundledSkills()
    expect(snapshot).toHaveLength(1)

    // Mutating the snapshot must not affect the registry.
    snapshot.push({
      name: 'leak',
      when: 'on-session-start',
      body: '',
      source: 'global',
      path: 'leak',
    })
    expect(getBundledSkills()).toHaveLength(1)
  })

  it('registers a skill with defaulted when and synthetic path', () => {
    registerBundledSkill({ name: 'greet', body: 'Say hello.' })
    const skills = getBundledSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('greet')
    expect(skills[0]?.when).toBe('on-session-start')
    expect(skills[0]?.path).toBe('<bundled>:greet')
    expect(skills[0]?.source).toBe('global')
    expect(skills[0]?.body).toBe('Say hello.')
  })

  it('preserves keyword when payload and requires tags', () => {
    registerBundledSkill({
      name: 'migrate',
      body: 'Body',
      when: { keyword: ['migration', 'schema'] },
      requires: ['fs', 'shell'],
      description: 'Migrate stuff',
    })
    const [s] = getBundledSkills()
    expect(s?.when).toEqual({ keyword: ['migration', 'schema'] })
    expect(s?.requires).toEqual(['fs', 'shell'])
    expect(s?.description).toBe('Migrate stuff')
  })

  it('re-registering the same name replaces the prior entry', () => {
    registerBundledSkill({ name: 'dup', body: 'v1' })
    registerBundledSkill({ name: 'dup', body: 'v2' })
    const skills = getBundledSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]?.body).toBe('v2')
  })

  it('clearBundledSkills empties the registry', () => {
    registerBundledSkill({ name: 'x', body: 'x' })
    expect(getBundledSkills()).toHaveLength(1)
    clearBundledSkills()
    expect(getBundledSkills()).toEqual([])
  })
})

describe('loadAllSkills', () => {
  beforeEach(() => {
    clearBundledSkills()
  })

  it('returns [] when no bundled skills and no disk skills', async () => {
    const skills = await loadAllSkills({ home: tmp(), cwd: tmp() })
    expect(skills).toEqual([])
  })

  it('returns bundled skills when no disk skills exist', async () => {
    registerBundledSkill({ name: 'bundled-only', body: 'B' })
    const skills = await loadAllSkills({ home: tmp(), cwd: tmp() })
    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('bundled-only')
    expect(skills[0]?.path).toBe('<bundled>:bundled-only')
  })

  it('disk skill with the same name shadows a bundled skill', async () => {
    const home = tmp()
    writeFileSync(
      join(skillsDir(home), 'shadowed.md'),
      '---\nname: shadowed\n---\nDisk body.\n',
    )
    registerBundledSkill({ name: 'shadowed', body: 'Bundled body.' })

    const skills = await loadAllSkills({ home, cwd: tmp() })
    const match = skills.filter((s) => s.name === 'shadowed')
    expect(match).toHaveLength(1)
    expect(match[0]?.body).toBe('Disk body.')
    expect(match[0]?.source).toBe('global')
    // The synthetic bundled path is replaced by the disk path.
    expect(match[0]?.path).not.toBe('<bundled>:shadowed')
  })

  it('merges bundled + global + project disk skills', async () => {
    const home = tmp()
    const cwd = tmp()
    writeFileSync(
      join(skillsDir(home), 'g.md'),
      '---\nname: from-global\n---\nGlobal.\n',
    )
    writeFileSync(
      join(skillsDir(cwd), 'p.md'),
      '---\nname: from-project\n---\nProject.\n',
    )
    registerBundledSkill({ name: 'from-bundled', body: 'Bundled.' })

    const skills = await loadAllSkills({ home, cwd })
    const names = skills.map((s) => s.name).sort()
    expect(names).toEqual(['from-bundled', 'from-global', 'from-project'])
  })
})
