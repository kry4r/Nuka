// src/core/provider/types.ts
import type { Message, StopReason, TokenUsage } from '../message/types'

export type ProviderFormat = 'anthropic' | 'openai'

export type ToolSpec = {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
}

export type Effort = 'low' | 'medium' | 'high'

export type LLMRequest = {
  model: string
  messages: Message[]
  system: string
  tools: ToolSpec[]
  maxTokens?: number
  temperature?: number
  /** Reasoning effort hint; mapped per-provider (Anthropic thinking, OpenAI reasoning). */
  effort?: Effort
}

export type ProviderCompactResult = {
  implementation: 'responses_compact'
  output: unknown[]
  usage?: TokenUsage
  responseId?: string
}

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_args_delta'; id: string; delta: string }
  | { type: 'tool_use_stop'; id: string; input: unknown }
  | {
      type: 'message_stop'
      stopReason: StopReason
      usage: TokenUsage
    }

export interface LLMProvider {
  readonly id: string
  readonly format: ProviderFormat
  stream(req: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
  listRemoteModels(): Promise<string[]>
  countTokens?(messages: Message[]): Promise<number>
  compact?(req: LLMRequest, signal: AbortSignal): Promise<ProviderCompactResult>
}
