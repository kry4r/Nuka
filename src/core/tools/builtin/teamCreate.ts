import { defineTool } from '../define'
import { z } from 'zod'
import { isCoordinatorMode } from '../../agent/coordinatorMode'
import type { TeamRegistry } from '../../teams/registry'

export const TeamCreateInputSchema = z.object({
  team_name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string().min(1),
})
export type TeamCreateInput = z.infer<typeof TeamCreateInputSchema>

export function makeTeamCreateTool(deps: { teams: TeamRegistry }) {
  return defineTool<TeamCreateInput>({
    name: 'team_create',
    description: 'Create a named team with a matching task list. Coordinator mode only.',
    parameters: {
      type: 'object',
      properties: {
        team_name: { type: 'string', description: 'Team name (lowercase, alphanumeric + hyphens/underscores)' },
        description: { type: 'string', description: 'Human-readable description of the team' },
      },
      required: ['team_name', 'description'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'swarm', 'coordinator-only'],
    annotations: { readOnly: false, destructive: false, openWorld: false, parallelSafe: false },
    needsPermission: () => 'none',
    async run(input, ctx) {
      if (ctx.session?.allowedTeamCreate === false) {
        return { output: 'Sub-agents cannot create teams.', isError: true }
      }
      if (!isCoordinatorMode()) {
        return { output: 'team_create is only available in coordinator mode.', isError: true }
      }
      try {
        const team = await deps.teams.create(input.team_name, input.description)
        return { output: JSON.stringify({ teamName: team.name, taskListId: team.taskListId }), isError: false }
      } catch (e) {
        return { output: (e as Error).message, isError: true }
      }
    },
  })
}
