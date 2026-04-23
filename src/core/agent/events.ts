// src/core/agent/events.ts
import type { StopReason, TokenUsage } from '../message/types'

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'turn_end'; usage: TokenUsage; stopReason: StopReason }
  | { type: 'queued_message_flushed'; count: number }
  | { type: 'error'; error: Error }
