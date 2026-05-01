import { defineTool } from '../define'
import { z } from 'zod'
import { ulid } from 'ulid'
import type { MessageRouter } from '../../messaging/router'

const Input = z.object({
  fromAgentId: z.string(),
  toAgentId: z.string(),
  body: z.string().min(1),
  reason: z.string().min(1).default('manual a2a supplement'),
})
type In = z.infer<typeof Input>

export type CoordA2aSendDeps = {
  router: MessageRouter
}

/**
 * `coordination_a2a_send` — manual fallback when the editor wants to push a supplement
 * from agent A to agent B without waiting for the event-driven router. Used in hell-mode
 * sessions when an agent's listening subscription should have fired but didn't.
 */
export function makeCoordinationA2aSendTool(deps: CoordA2aSendDeps) {
  return defineTool<In>({
    name: 'coordination_a2a_send',
    description:
      'Manually push a supplemental message from one listening agent to another. Body must include actionable context.',
    parameters: {
      type: 'object',
      properties: {
        fromAgentId: { type: 'string' },
        toAgentId: { type: 'string' },
        body: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['fromAgentId', 'toAgentId', 'body'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'harness', 'coordination'],
    annotations: { readOnly: false, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input) {
      const ok = await deps.router.send({
        id: ulid(),
        from: input.fromAgentId,
        to: input.toAgentId,
        summary: `manual a2a: ${input.reason}`.slice(0, 200),
        message: input.body,
        sentAt: Date.now(),
      })
      return { output: JSON.stringify({ delivered: ok }), isError: !ok }
    },
  })
}
