// src/core/message/types.ts
export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'error'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }

export type UserMessage = {
  role: 'user'
  content: ContentBlock[]
  id: string
  ts: number
}

export type AssistantMessage = {
  role: 'assistant'
  content: ContentBlock[]
  id: string
  ts: number
  usage?: TokenUsage
  stopReason?: StopReason
}

export type ToolMessage = {
  role: 'tool'
  toolUseId: string
  content: string
  isError: boolean
  id: string
  ts: number
}

export type SystemMessage = {
  role: 'system'
  content: string
}

export type Message = UserMessage | AssistantMessage | ToolMessage | SystemMessage
