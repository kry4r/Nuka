import { defineTool } from '../define'
import { z } from 'zod'
import { ulid } from 'ulid'
import { ProtocolMessageSchema } from '../../messaging/types'
import { resolveTarget } from '../../messaging/addresses'
import type { MessageEnvelope } from '../../messaging/types'
import type { MessageRouter } from '../../messaging/router'
import type { TeamRegistry } from '../../teams/registry'

export const SendMessageInputSchema = z.object({
  to: z.string(),
  summary: z.string().min(1).max(200),
  message: z.union([z.string(), ProtocolMessageSchema]),
})
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>

export function makeSendMessageTool(deps: { router: MessageRouter; teams: TeamRegistry }) {
  return defineTool<SendMessageInput>({
    name: 'send_message',
    description: 'Send a message to a teammate by name, or broadcast with "*".',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address: bare name, team:X/Y, or * for broadcast' },
        summary: { type: 'string', description: 'One-line summary (max 200 chars)', maxLength: 200 },
        message: { description: 'Message body: string or a protocol object (shutdown_request etc.)' },
      },
      required: ['to', 'summary', 'message'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'swarm'],
    annotations: { readOnly: false, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input, ctx) {
      const callerTeam = ctx.session?.teamName as string | undefined
      const callerAgent = ctx.session?.agentName as string | undefined
      const fromAddr = callerTeam && callerAgent ? `team:${callerTeam}/${callerAgent}` : 'lead'
      try {
        if (input.to === '*') {
          if (!callerTeam) return { output: 'broadcast requires teamName context (lead must use qualified address)', isError: true }
          const team = deps.teams.find(callerTeam)
          if (!team) return { output: 'team not found', isError: true }
          const n = await deps.router.broadcast({
            teamName: callerTeam,
            members: team.members.map(m => m.agentName),
            base: { id: ulid(), from: fromAddr, summary: input.summary, message: input.message, sentAt: Date.now() },
          })
          return { output: JSON.stringify({ delivered: n > 0, count: n }), isError: false }
        }
        const toAddr = resolveTarget(input.to, { teamName: callerTeam })
        const env: MessageEnvelope = {
          id: ulid(), from: fromAddr, to: toAddr,
          summary: input.summary, message: input.message, sentAt: Date.now(),
        }
        const ok = await deps.router.send(env)
        return { output: JSON.stringify({ delivered: ok, envelopeId: env.id }), isError: !ok }
      } catch (e) {
        return { output: (e as Error).message, isError: true }
      }
    },
  })
}
