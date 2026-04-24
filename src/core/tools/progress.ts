// src/core/tools/progress.ts
// Type definitions for typed tool progress events.

/**
 * Typed progress payload: a tool can use onProgressTyped to emit
 * structured progress objects rather than plain strings.
 *
 * When Tool.progressType === 'object', the agent loop JSON-serializes
 * the payload and emits it as the text field of a tool_progress event.
 * When Tool.progressType === 'line' or unset, the existing string-based
 * onProgress callback is used unchanged.
 */
export type ToolProgressPayload = Record<string, unknown>

/**
 * Typed progress emitter. Passed via ToolRunContext.onProgressTyped when
 * the tool declares progressType === 'object'.
 */
export type OnProgressTyped<P extends ToolProgressPayload = ToolProgressPayload> = (
  payload: P,
) => void
