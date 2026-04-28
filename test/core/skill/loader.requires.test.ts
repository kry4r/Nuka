// test/core/skill/loader.requires.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { loadSkills, parseSkill } from '../../../src/core/skill/loader'

function tmp(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-skill-requires-'))
}

function skillsDir(base: string): string {
  const dir = join(base, '.nuka', 'skills')
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('Skill frontmatter — requires', () => {
  it('parses requires when present', () => {
    const skill = parseSkill(
      `---\nname: writer\nrequires:\n  - fs.read\n  - fs.write\n---\nbody\n`,
      { path: '/x.md', source: 'project' },
    )
    expect(skill).not.toBeNull()
    expect(skill?.requires).toEqual(['fs.read', 'fs.write'])
  })

  it('leaves requires undefined when absent', () => {
    const skill = parseSkill(
      `---\nname: bare\n---\nbody\n`,
      { path: '/x.md', source: 'project' },
    )
    expect(skill).not.toBeNull()
    expect(skill?.requires).toBeUndefined()
  })

  it('rejects empty-string entries via zod (skill rejected)', () => {
    const skill = parseSkill(
      `---\nname: bad\nrequires:\n  - ''\n---\nbody\n`,
      { path: '/x.md', source: 'project' },
    )
    expect(skill).toBeNull()
  })

  it('loadSkills propagates requires for files on disk', async () => {
    const home = tmp()
    const dir = skillsDir(home)
    writeFileSync(
      join(dir, 'with-req.md'),
      `---\nname: with-req\nrequires:\n  - net.read\n---\nbody\n`,
    )
    writeFileSync(
      join(dir, 'no-req.md'),
      `---\nname: no-req\n---\nbody\n`,
    )
    const skills = await loadSkills({ home, cwd: tmp() })
    const withReq = skills.find((s) => s.name === 'with-req')
    const noReq = skills.find((s) => s.name === 'no-req')
    expect(withReq?.requires).toEqual(['net.read'])
    expect(noReq?.requires).toBeUndefined()
  })
})
