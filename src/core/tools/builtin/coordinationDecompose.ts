import { defineTool } from '../define'
import { z } from 'zod'
import { decomposeTask } from '../../coordination/decompose'
import { saveGraph } from '../../coordination/persist'
import type { TaskProfile, Difficulty } from '../../harness/types'

const Input = z.object({
  rootMessage: z.string(),
  profile: z.enum(['feature', 'debug-fix', 'refactor', 'investigate', 'doc', 'odd-jobs']),
  difficulty: z.enum(['simple', 'medium', 'hard', 'hell']),
})
type In = z.infer<typeof Input>

export type CoordDecomposeDeps = {
  runFork: (prompt: string) => Promise<{ text: string }>
  /** Where to save the produced TaskGraph (typically `~/.nuka/coordination/<sessionId>.json`). */
  graphPath: () => string
}

/**
 * `coordination_decompose` — invoked by the editor at plan-stage entry for hard/hell
 * difficulty tasks. Produces a TaskGraph and persists it for downstream dispatch.
 */
export function makeCoordinationDecomposeTool(deps: CoordDecomposeDeps) {
  return defineTool<In>({
    name: 'coordination_decompose',
    description:
      'Decompose a root user message into a sub-task DAG. Use only at plan stage when the harness difficulty is hard or hell. Persists the graph and returns its summary.',
    parameters: {
      type: 'object',
      properties: {
        rootMessage: { type: 'string' },
        profile: {
          type: 'string',
          enum: ['feature', 'debug-fix', 'refactor', 'investigate', 'doc', 'odd-jobs'] as TaskProfile[],
        },
        difficulty: { type: 'string', enum: ['simple', 'medium', 'hard', 'hell'] as Difficulty[] },
      },
      required: ['rootMessage', 'profile', 'difficulty'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'harness', 'coordination'],
    annotations: { readOnly: false, destructive: false, openWorld: true, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input) {
      const graph = await decomposeTask({
        rootMessage: input.rootMessage,
        profile: input.profile,
        difficulty: input.difficulty,
        runFork: deps.runFork,
      })
      const snap = graph.snapshot()
      saveGraph(deps.graphPath(), graph)
      return {
        output: JSON.stringify({
          taskCount: Object.keys(snap.nodes).length,
          correlations: snap.correlations.length,
          tasks: Object.values(snap.nodes).map((t) => ({ id: t.id, title: t.title, dependsOn: t.dependsOn })),
        }),
        isError: false,
      }
    },
  })
}
