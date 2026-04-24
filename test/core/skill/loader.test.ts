import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { loadSkills, parseSkill } from '../../../src/core/skill/loader'

function tmp(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-skill-'))
}

function skillsDir(base: string): string {
  const dir = join(base, '.nuka', 'skills')
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('loadSkills', () => {
  it('loads a well-formed skill file with frontmatter and body', async () => {
    const home = tmp()
    const dir = skillsDir(home)
    writeFileSync(
      join(dir, 'tdd.md'),
      `---\nname: tdd-discipline\nwhen: on-session-start\n---\n\nWrite a failing test first.\n`,
    )
    const skills = await loadSkills({ home, cwd: tmp() })
    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('tdd-discipline')
    expect(skills[0]?.when).toBe('on-session-start')
    expect(skills[0]?.body).toBe('Write a failing test first.')
    expect(skills[0]?.source).toBe('global')
  })

  it('returns [] when the skills directory is missing', async () => {
    const skills = await loadSkills({ home: tmp(), cwd: tmp() })
    expect(skills).toEqual([])
  })

  it('ignores malformed files without throwing', async () => {
    const home = tmp()
    const dir = skillsDir(home)
    // no frontmatter
    writeFileSync(join(dir, 'no-fm.md'), 'Just a body with no frontmatter.\n')
    // bad YAML
    writeFileSync(join(dir, 'bad-yaml.md'), '---\n: :\n---\nBody\n')
    // missing name
    writeFileSync(join(dir, 'no-name.md'), '---\ndescription: oops\n---\nBody\n')
    // valid one to confirm loading still works
    writeFileSync(
      join(dir, 'valid.md'),
      '---\nname: good-skill\n---\nBody text.\n',
    )
    const skills = await loadSkills({ home, cwd: tmp() })
    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('good-skill')
  })

  it('project skill overrides global skill with the same name', async () => {
    const home = tmp()
    const cwd = tmp()
    writeFileSync(
      join(skillsDir(home), 'helper.md'),
      '---\nname: migration-helper\n---\nGlobal body.\n',
    )
    writeFileSync(
      join(skillsDir(cwd), 'helper.md'),
      '---\nname: migration-helper\n---\nProject body.\n',
    )
    const skills = await loadSkills({ home, cwd })
    const match = skills.filter((s) => s.name === 'migration-helper')
    expect(match).toHaveLength(1)
    expect(match[0]?.source).toBe('project')
    expect(match[0]?.body).toBe('Project body.')
  })

  it('loads keyword-triggered skill correctly', async () => {
    const home = tmp()
    const dir = skillsDir(home)
    writeFileSync(
      join(dir, 'migration.md'),
      '---\nname: migration-helper\nwhen:\n  keyword:\n    - migration\n    - schema\n---\nBody here.\n',
    )
    const skills = await loadSkills({ home, cwd: tmp() })
    expect(skills).toHaveLength(1)
    expect(skills[0]?.when).toEqual({ keyword: ['migration', 'schema'] })
  })
})

describe('parseSkill', () => {
  it('returns null for content without frontmatter', () => {
    expect(parseSkill('No frontmatter here.', { path: '/x.md', source: 'global' })).toBeNull()
  })

  it('returns null for content with unclosed frontmatter', () => {
    expect(parseSkill('---\nname: foo\n', { path: '/x.md', source: 'global' })).toBeNull()
  })

  it('returns null for invalid schema (empty name)', () => {
    expect(parseSkill('---\nname: \n---\nBody\n', { path: '/x.md', source: 'global' })).toBeNull()
  })

  it('parses valid content and defaults when to on-session-start', () => {
    const skill = parseSkill('---\nname: my-skill\n---\nDo stuff.\n', {
      path: '/p/my-skill.md',
      source: 'project',
    })
    expect(skill).not.toBeNull()
    expect(skill?.name).toBe('my-skill')
    expect(skill?.when).toBe('on-session-start')
    expect(skill?.source).toBe('project')
    expect(skill?.body).toBe('Do stuff.')
  })
})
