import { defineTool } from '../define'
import type { PipelineInput, PipelineResult } from '../../swarm/pipeline'

export function makePipelineRunTool(deps: { runPipeline: (i: PipelineInput) => Promise<PipelineResult> }) {
  return defineTool({
    name: 'pipeline_run',
    description: 'Run a cascade pipeline (DAG of agent stages with {{prev}} threading).',
    parameters: {
      type: 'object',
      properties: {
        entry: { type: 'string', description: 'ID of the entry node' },
        nodes: {
          type: 'array',
          description: 'Array of pipeline nodes',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              agent: { type: 'string' },
              prompt: { type: 'string' },
              team: { type: 'string' },
              next: { type: 'array', items: { type: 'string' }, default: [] },
              timeoutMs: { type: 'number', default: 300000 },
            },
            required: ['id', 'agent', 'prompt'],
            additionalProperties: false,
          },
          minItems: 1,
        },
        ephemeralTeamName: { type: 'string', description: 'Optional ephemeral team name' },
      },
      required: ['entry', 'nodes'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'swarm'],
    annotations: { readOnly: false, destructive: false, openWorld: false, parallelSafe: false },
    needsPermission: () => 'none',
    async run(input, _ctx) {
      try {
        const r = await deps.runPipeline(input as unknown as PipelineInput)
        return { output: JSON.stringify(r), isError: false }
      } catch (e) {
        return { output: (e as Error).message, isError: true }
      }
    },
  })
}
