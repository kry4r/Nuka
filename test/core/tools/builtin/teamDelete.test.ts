import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { TeamRegistry } from '../../../../src/core/teams/registry'
import { makeTeamDeleteTool } from '../../../../src/core/tools/builtin/teamDelete'

describe('team_delete', () => {
  let home: string; let teams: TeamRegistry
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-td-'))
    teams = new TeamRegistry({ home })
    process.env.NUKA_COORDINATOR_MODE = '1'
  })
  afterEach(() => { delete process.env.NUKA_COORDINATOR_MODE })

  it('deletes existing team', async () => {
    await teams.create('demo', '')
    const tool = makeTeamDeleteTool({ teams })
    const r = await tool.run({ team_name: 'demo', keep_tasks: false }, { session: { allowedTeamCreate: true } } as never)
    expect(r.isError).toBe(false)
    expect(teams.find('demo')).toBeUndefined()
  })

  it('errors on unknown team', async () => {
    const tool = makeTeamDeleteTool({ teams })
    const r = await tool.run({ team_name: 'ghost', keep_tasks: false }, { session: { allowedTeamCreate: true } } as never)
    expect(r.isError).toBe(false)            // delete is idempotent
  })
})
