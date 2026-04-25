// test/core/testing/vitest.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { expectPlanToPass } from '../../../src/core/testing/vitest'

let tmpdir: string
beforeEach(async () => {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuka-vitest-helper-'))
})
afterEach(async () => {
  await fs.rm(tmpdir, { recursive: true, force: true })
})

describe('expectPlanToPass', () => {
  it('returns the RunResult on success without throwing', async () => {
    const result = await expectPlanToPass(`
name: pass
steps:
  - render: wizard
  - assert: { contains: "Welcome" }
`, { cwd: tmpdir })
    expect(result.ok).toBe(true)
    expect(result.steps).toHaveLength(2)
  })

  it('routes failures through expect.fail with each failing step', async () => {
    let caught: unknown
    try {
      await expectPlanToPass(`
name: fail
steps:
  - render: wizard
  - assert: { contains: "this-text-not-present-zzz" }
  - assert: { contains: "another-missing-string" }
`, { cwd: tmpdir })
    } catch (e) { caught = e }
    expect(caught).toBeDefined()
    const msg = (caught as Error).message
    expect(msg).toMatch(/plan "fail" failed/)
    expect(msg).toMatch(/step 1 \(assert\)/)
    expect(msg).toMatch(/step 2 \(assert\)/)
  })

  it('surfaces YAML/parse errors before running anything', async () => {
    let caught: unknown
    try {
      await expectPlanToPass(`steps: []`, { cwd: tmpdir })
    } catch (e) { caught = e }
    expect(caught).toBeDefined()
    expect((caught as Error).message).toMatch(/name/)
  })
})
