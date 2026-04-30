// Full zod schema lands in M5 (Task 11). This temporary type lets M2 compile.
export type MessageEnvelope = {
  id: string
  from: string
  to: string
  summary: string
  message: string | { type: string; [k: string]: unknown }
  request_id?: string
  sentAt: number
}
