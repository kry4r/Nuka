import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearBundledSkills } from '../../../src/core/skill/bundled'
import { initBundledSkills } from '../../../src/core/skill/bundled/index'
import { loadAllSkills } from '../../../src/core/skill/loadDir'

describe('loadAllSkills — bundled merge', () => {
  const home = mkdtempSync(join(tmpdir(), 'nuka-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'nuka-cwd-'))

  beforeEach(() => {
    clearBundledSkills()
    initBundledSkills()
  })

  afterEach(() => {
    clearBundledSkills()
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  it('returns bundled skills alongside disk skills', async () => {
    const result = await loadAllSkills({ home, cwd })
    const names = result.map((s) => s.name)
    // simplify and skillify are unconditional tier-1 bundled skills
    expect(names).toContain('simplify')
    expect(names).toContain('skillify')
  })

  it('disk-loaded skills with the same name override bundled', async () => {
    mkdirSync(join(cwd, '.nuka', 'skills'), { recursive: true })
    writeFileSync(
      join(cwd, '.nuka', 'skills', 'simplify.md'),
      '---\nname: simplify\ndescription: project override\n---\n\nproject body\n',
    )
    const result = await loadAllSkills({ home, cwd })
    const simplify = result.find((s) => s.name === 'simplify')
    expect(simplify?.body.trim()).toBe('project body')
    expect(simplify?.source).toBe('project')
  })
})
