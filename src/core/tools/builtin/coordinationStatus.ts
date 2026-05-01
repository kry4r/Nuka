import { defineTool } from '../define'
import { z } from 'zod'
import { loadGraph } from '../../coordination/persist'

const Input = z.object({})
type In = z.infer<typeof Input>

export type CoordStatusDeps = {
  graphPath: () => string
  subsPath: () => string
}

/**
 * `coordination_status` — surface the current TaskGraph + a2a subscriptions to the
 * editor. Read-only; safe to call any time.
 */
export function makeCoordinationStatusTool(deps: CoordStatusDeps) {
  return defineTool<In>({
    name: 'coordination_status',
    description: 'Return current TaskGraph (nodes + correlations) and active a2a subscriptions.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    source: 'builtin',
    tags: ['core', 'harness', 'coordination'],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run() {
      const fs = await import('node:fs')
      const graph = loadGraph(deps.graphPath())
      const graphPart = graph
        ? graph.snapshot()
        : { rootMessage: null, difficulty: null, nodes: {}, correlations: [] }
      let subs: unknown = []
      try {
        if (fs.existsSync(deps.subsPath())) {
          subs = JSON.parse(fs.readFileSync(deps.subsPath(), 'utf8'))
        }
      } catch {
        subs = []
      }
      return { output: JSON.stringify({ graph: graphPart, subscriptions: subs }), isError: false }
    },
  })
}
