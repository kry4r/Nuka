import { ulid } from 'ulid'
import type {
  UserMessage,
  AssistantMessage,
  ToolMessage,
} from './types'

export function makeUserMessage(input: { text: string }): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: input.text }],
    id: ulid(),
    ts: Date.now(),
  }
}

export function makeToolMessage(
  toolUseId: string,
  result: { output: string; isError: boolean },
): ToolMessage {
  return {
    role: 'tool',
    toolUseId,
    content: result.output,
    isError: result.isError,
    id: ulid(),
    ts: Date.now(),
  }
}

export function emptyAssistant(): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    id: ulid(),
    ts: Date.now(),
  }
}
