import { defineTool } from '../define'
import type { RoundtableInput } from '../../swarm/roundtable'

export function makeRoundtableTool(deps: { runRoundtable: (i: RoundtableInput) => Promise<{ artifact: string; rounds: number; transcript: string }> }) {
  return defineTool({
    name: 'roundtable',
    description: 'Run a closed multi-role debate; synthesizer produces the final artifact.',
    parameters: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team name for this roundtable' },
        topic: { type: 'string', description: 'Discussion topic or question' },
        members: {
          type: 'array',
          description: 'Participants (2–6)',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string' },
              name: { type: 'string' },
              role: { type: 'string' },
            },
            required: ['agent', 'name', 'role'],
            additionalProperties: false,
          },
          minItems: 2,
          maxItems: 6,
        },
        synthesizer: { type: 'string', description: 'Name of the member who synthesizes the final artifact' },
        rounds: { type: 'number', description: 'Number of debate rounds (1–8)', minimum: 1, maximum: 8, default: 3 },
      },
      required: ['team', 'topic', 'members', 'synthesizer', 'rounds'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'swarm'],
    annotations: { readOnly: false, destructive: false, openWorld: false, parallelSafe: false },
    needsPermission: () => 'none',
    async run(input, _ctx) {
      try {
        const r = await deps.runRoundtable(input as unknown as RoundtableInput)
        return { output: JSON.stringify(r), isError: false }
      } catch (e) {
        return { output: (e as Error).message, isError: true }
      }
    },
  })
}
