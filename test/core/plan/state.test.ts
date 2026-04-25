// test/core/plan/state.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { planFilePath, readPlan, writePlan, appendPlan, clearPlan } from '../../../src/core/plan/state'

async function tmpHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-plan-home-'))
}

describe('plan state', () => {
  it('planFilePath hashes cwd into a stable filename under ~/.nuka/plans/', () => {
    const home = '/fake/home'
    const cwd = '/some/project'
    const p = planFilePath(cwd, home)
    expect(p.startsWith(path.join(home, '.nuka', 'plans'))).toBe(true)
    expect(p.endsWith('.md')).toBe(true)
    expect(planFilePath(cwd, home)).toBe(p)
    expect(planFilePath('/other', home)).not.toBe(p)
  })

  it('readPlan returns empty string when file is missing', async () => {
    const home = await tmpHome()
    expect(await readPlan('/cwd-a', home)).toBe('')
  })

  it('writePlan + readPlan round-trip', async () => {
    const home = await tmpHome()
    await writePlan('/cwd-a', '# title\n\nstep 1\n', home)
    expect(await readPlan('/cwd-a', home)).toBe('# title\n\nstep 1\n')
  })

  it('appendPlan adds to existing content with a blank-line separator', async () => {
    const home = await tmpHome()
    await writePlan('/c', 'first', home)
    await appendPlan('/c', 'second', home)
    const out = await readPlan('/c', home)
    expect(out).toContain('first')
    expect(out).toContain('second')
    // separator between the two blocks
    expect(out).toMatch(/first\s*\n\s*\nsecond/)
  })

  it('appendPlan on empty file just writes the text', async () => {
    const home = await tmpHome()
    await appendPlan('/c', 'hello', home)
    expect((await readPlan('/c', home)).trim()).toBe('hello')
  })

  it('clearPlan removes the file and is a no-op when missing', async () => {
    const home = await tmpHome()
    await writePlan('/c', 'x', home)
    await clearPlan('/c', home)
    expect(await readPlan('/c', home)).toBe('')
    // second clear shouldn't throw
    await clearPlan('/c', home)
  })

  it('different cwds get isolated plans', async () => {
    const home = await tmpHome()
    await writePlan('/a', 'A', home)
    await writePlan('/b', 'B', home)
    expect((await readPlan('/a', home)).trim()).toBe('A')
    expect((await readPlan('/b', home)).trim()).toBe('B')
  })
})
