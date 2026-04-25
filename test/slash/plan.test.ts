// test/slash/plan.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PlanCommand, _runPlanForTest } from '../../src/slash/plan'
import { planFilePath, readPlan, writePlan } from '../../src/core/plan/state'
import { SessionManager } from '../../src/core/session/manager'
import type { SlashContext } from '../../src/slash/types'

async function tmpHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-plan-slash-'))
}

function ctx(): { ctx: SlashContext; sessions: SessionManager } {
  const sessions = new SessionManager()
  sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    ctx: {
      sessions,
      providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
      config: { providers: [], active: { providerId: 'p' } } as any,
    },
  }
}

describe('/plan', () => {
  const origHome = os.homedir
  let home: string

  beforeEach(async () => {
    home = await tmpHome()
    // Steer plan state helpers to a scratch dir by patching os.homedir.
    vi.spyOn(os, 'homedir').mockReturnValue(home)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    void origHome
  })

  it('metadata looks correct', () => {
    expect(PlanCommand.name).toBe('plan')
    expect(PlanCommand.description).toMatch(/plan/i)
  })

  it('`/plan on` flips session mode to plan', async () => {
    const { ctx: c, sessions } = ctx()
    const res = await _runPlanForTest('on', c, '/cwd-a')
    expect(res.type).toBe('text')
    expect(sessions.active()!.mode).toBe('plan')
  })

  it('`/plan off` flips back to normal', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.active()!.mode = 'plan'
    await _runPlanForTest('off', c, '/cwd-a')
    expect(sessions.active()!.mode).toBe('normal')
  })

  it('`/plan apply` exits plan mode (alias of off)', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.active()!.mode = 'plan'
    const res = await _runPlanForTest('apply', c, '/cwd-a')
    expect(res.type).toBe('text')
    expect(sessions.active()!.mode).toBe('normal')
  })

  it('`/plan write <text>` appends to the per-cwd plan file', async () => {
    const { ctx: c } = ctx()
    await _runPlanForTest('write step 1 — draft api', c, '/cwd-a')
    const saved = await readPlan('/cwd-a', home)
    expect(saved).toContain('step 1 — draft api')
    const p = planFilePath('/cwd-a', home)
    expect(await fs.readFile(p, 'utf8')).toContain('step 1 — draft api')
  })

  it('`/plan write` without text returns usage hint', async () => {
    const { ctx: c } = ctx()
    const res = await _runPlanForTest('write', c, '/cwd-a')
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/Usage/)
  })

  it('`/plan show` cats the plan file', async () => {
    const { ctx: c } = ctx()
    await writePlan('/cwd-a', 'PLAN BODY', home)
    const res = await _runPlanForTest('show', c, '/cwd-a')
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toContain('PLAN BODY')
  })

  it('`/plan show` on empty plan reports "(no plan written yet)"', async () => {
    const { ctx: c } = ctx()
    const res = await _runPlanForTest('show', c, '/cwd-a')
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/no plan written yet/)
  })

  it('`/plan` (no args) reports mode + file path', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.active()!.mode = 'plan'
    const res = await _runPlanForTest('', c, '/cwd-a')
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toMatch(/plan mode: ON/)
      expect(res.text).toContain(planFilePath('/cwd-a', home))
    }
  })

  it('unknown subcommand returns a friendly error', async () => {
    const { ctx: c } = ctx()
    const res = await _runPlanForTest('bogus', c, '/cwd-a')
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/Unknown/)
  })
})
