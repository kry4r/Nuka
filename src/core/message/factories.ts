import { ulid } from 'ulid'
import type {
  UserMessage,
  AssistantMessage,
  ToolMessage,
  SystemMessage,
  ToolContentBlock,
  ImageContentBlock,
  ContentBlock,
} from './types'

export function makeUserMessage(input: {
  text: string
  images?: readonly ImageContentBlock[]
}): UserMessage {
  const blocks: ContentBlock[] = []
  if (input.text.length > 0) {
    blocks.push({ type: 'text', text: input.text })
  }
  if (input.images && input.images.length > 0) {
    for (const img of input.images) {
      blocks.push({ ...img })
    }
  }
  return {
    role: 'user',
    content: blocks,
    id: ulid(),
    ts: Date.now(),
  }
}

export function makeToolMessage(
  toolUseId: string,
  result: { output: string | ToolContentBlock[]; isError: boolean },
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

export function makeSystemMessage(content: string): SystemMessage {
  return { role: 'system', content }
}
