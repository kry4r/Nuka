import { defineTool } from '../define'
import type { PipelineInput, PipelineResult } from '../../swarm/pipeline'

/** Validates pipeline input for structural correctness before execution. */
function validatePipelineInput(input: PipelineInput): string | null {
  const ids = new Set<string>()
  for (const node of input.nodes) {
    if (ids.has(node.id)) return `pipeline_run: duplicate node id "${node.id}"`
    ids.add(node.id)
  }
  if (!ids.has(input.entry)) {
    return `pipeline_run: entry "${input.entry}" not in node id set`
  }
  for (const node of input.nodes) {
    for (const ref of node.next ?? []) {
      if (!ids.has(ref)) {
        return `pipeline_run: node "${node.id}" next references unknown id "${ref}"`
      }
    }
  }
  return null
}

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
      const pipelineInput = input as unknown as PipelineInput
      const validationError = validatePipelineInput(pipelineInput)
      if (validationError) return { output: validationError, isError: true }
      try {
        const r = await deps.runPipeline(pipelineInput)
        return { output: JSON.stringify(r), isError: false }
      } catch (e) {
        return { output: (e as Error).message, isError: true }
      }
    },
  })
}
