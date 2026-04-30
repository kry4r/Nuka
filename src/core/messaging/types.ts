import { z } from 'zod'

export const ProtocolMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shutdown_request'), request_id: z.string() }),
  z.object({ type: z.literal('shutdown_response'), request_id: z.string(), approve: z.boolean() }),
  z.object({ type: z.literal('plan_approval_request'), request_id: z.string(), plan: z.string() }),
  z.object({ type: z.literal('plan_approval_response'), request_id: z.string(), approve: z.boolean(), feedback: z.string().optional() }),
  z.object({ type: z.literal('handoff'), request_id: z.string(), nextStage: z.string(), payload: z.record(z.string(), z.unknown()) }),
])

export const MessageEnvelopeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  summary: z.string().min(1).max(200),
  message: z.union([z.string(), ProtocolMessageSchema]),
  request_id: z.string().optional(),
  sentAt: z.number(),
})

export type ProtocolMessage = z.infer<typeof ProtocolMessageSchema>
export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>
