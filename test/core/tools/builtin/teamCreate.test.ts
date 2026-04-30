import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { TeamRegistry } from '../../../../src/core/teams/registry'
import { makeTeamCreateTool } from '../../../../src/core/tools/builtin/teamCreate'

describe('team_create', () => {
  let home: string; let teams: TeamRegistry
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-tc-'))
    teams = new TeamRegistry({ home })
    process.env.NUKA_COORDINATOR_MODE = '1'
  })
  afterEach(() => { delete process.env.NUKA_COORDINATOR_MODE })

  it('creates team in coordinator mode', async () => {
    const tool = makeTeamCreateTool({ teams })
    const r = await tool.run({ team_name: 'demo', description: 'd' }, { session: { allowedTeamCreate: true } } as never)
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.output as string).teamName).toBe('demo')
  })

  it('refuses outside coordinator mode', async () => {
    delete process.env.NUKA_COORDINATOR_MODE
    const tool = makeTeamCreateTool({ teams })
    const r = await tool.run({ team_name: 'demo', description: 'd' }, { session: { allowedTeamCreate: true } } as never)
    expect(r.isError).toBe(true)
  })

  it('refuses recursion (allowedTeamCreate=false)', async () => {
    const tool = makeTeamCreateTool({ teams })
    const r = await tool.run({ team_name: 'demo', description: 'd' }, { session: { allowedTeamCreate: false } } as never)
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/sub-agents/i)
  })
})
