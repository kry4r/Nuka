// test/core/testing/slash.test.ts
//
// Phase 10 §4.2 — verifies that runPlan honors `setup.slash: [...]` by
// importing the named commands and threading them through to mountApp.
// The plans below drive `/stats` and `/plan on` and assert effects that
// only surface when the slash actually dispatches.

import { describe, it, expect } from 'vitest'
import { runPlan } from '../../../src/core/testing/runner'
import { parsePlan } from '../../../src/core/testing/plan'
import {
  buildSlashRegistryFromNames,
  knownSlashNames,
} from '../../../src/core/testing/slashRegistry'

describe('runPlan: setup.slash registration', () => {
  it('drives /stats and surfaces the StatsView dialog', async () => {
    const yaml = `
name: "stats via slash"
setup:
  slash:
    - StatsCommand
steps:
  - render: app
  - assert:
      contains: "/ for commands"
  - slash: "stats"
  - wait:
      until:
        contains: "Overview"
      timeoutMs: 1500
  - assert:
      contains: "Tab: switch tab"
`
    const plan = parsePlan(yaml)
    const result = await runPlan(plan)
    if (!result.ok) {
      const failures = result.steps.filter(s => !s.ok).map(s => `step ${s.index}: ${s.message}`).join('\n')
      throw new Error(`plan failed:\n${failures}`)
    }
    expect(result.ok).toBe(true)
    expect(result.steps).toHaveLength(5)
  }, 10_000)

  it('rejects unknown slash export names', async () => {
    const yaml = `
name: "bad slash"
setup:
  slash:
    - NoSuchCommand
steps:
  - render: app
`
    const plan = parsePlan(yaml)
    await expect(runPlan(plan)).rejects.toThrow(/unknown slash command/)
  })
})

describe('buildSlashRegistryFromNames', () => {
  it('registers known commands by export name', async () => {
    const reg = await buildSlashRegistryFromNames(['StatsCommand', 'PlanCommand'])
    expect(reg.find('stats')).toBeDefined()
    expect(reg.find('plan')).toBeDefined()
    expect(reg.find('cost')).toBeUndefined()
  })

  it('lists all known names alphabetically', () => {
    const names = knownSlashNames()
    expect(names).toContain('ThemeCommand')
    expect(names).toContain('PlanCommand')
    expect(names).toContain('StatsCommand')
    expect(names).toEqual([...names].sort())
  })
})
