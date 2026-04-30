import { defineTool } from '../define'
import { z } from 'zod'
import { isCoordinatorMode } from '../../agent/coordinatorMode'
import type { TeamRegistry } from '../../teams/registry'

export const TeamDeleteInputSchema = z.object({
  team_name: z.string(),
  keep_tasks: z.boolean().default(false),
})
export type TeamDeleteInput = z.infer<typeof TeamDeleteInputSchema>

export function makeTeamDeleteTool(deps: { teams: TeamRegistry }) {
  return defineTool<TeamDeleteInput>({
    name: 'team_delete',
    description: 'Delete a team and (optionally) its task list.',
    parameters: {
      type: 'object',
      properties: {
        team_name: { type: 'string', description: 'Name of the team to delete' },
        keep_tasks: { type: 'boolean', description: 'If true, preserve the task list; default false', default: false },
      },
      required: ['team_name'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'swarm', 'coordinator-only'],
    annotations: { readOnly: false, destructive: true, openWorld: false, parallelSafe: false },
    needsPermission: () => 'none',
    async run(input, ctx) {
      if (ctx.session?.allowedTeamCreate === false) return { output: 'Sub-agents cannot delete teams.', isError: true }
      if (!isCoordinatorMode()) return { output: 'team_delete is only available in coordinator mode.', isError: true }
      const before = deps.teams.find(input.team_name)?.members.length ?? 0
      await deps.teams.delete(input.team_name, { keepTasks: input.keep_tasks })
      return { output: JSON.stringify({ removed: true, members: before }), isError: false }
    },
  })
}
