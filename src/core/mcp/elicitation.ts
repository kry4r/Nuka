// Payload + result types for the MCP `elicitation/create` flow.
//
// Shape mirrors the 2025-06-18 spec:
//   https://spec.modelcontextprotocol.io/specification/2025-06-18/client/elicitation/
// The server asks the client to prompt the user for structured input
// (form mode) or to hand off to a URL (URL mode). The client returns
// one of { action: 'accept', content }, { action: 'decline' }, or
// { action: 'cancel' }.

export type ElicitationPayload = {
  message: string
  /** JSON Schema describing the expected shape of the accepted content. */
  requestedSchema: unknown
  mode: 'form' | 'url'
  /** URL to open in URL mode. */
  url?: string
}

export type ElicitationResult =
  | { action: 'accept'; content: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' }

/**
 * Convert a raw `elicitation/create` request param object (as parsed by
 * the SDK) into our internal `ElicitationPayload`. Defaults `mode` to
 * `'form'` when absent — the spec's current normalization.
 */
export function parseElicitationParams(params: unknown): ElicitationPayload {
  const p = (params ?? {}) as {
    message?: unknown
    requestedSchema?: unknown
    mode?: unknown
    url?: unknown
  }
  const message = typeof p.message === 'string' ? p.message : ''
  const mode = p.mode === 'url' ? 'url' : 'form'
  const url = typeof p.url === 'string' ? p.url : undefined
  return { message, requestedSchema: p.requestedSchema, mode, url }
}
