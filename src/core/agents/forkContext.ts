import type { Message } from '../message/types'
import { makeToolMessage, makeUserMessage } from '../message/factories'

export type StructuredForkContext = {
  mode: 'structured'
}

export type BuildForkContextInput = {
  parentMessages: readonly Message[]
  directive: string
  context?: string
}

export type BuildForkContextResult = {
  forkContext: StructuredForkContext
  forkMessages: Message[]
  context?: string
}

export function buildForkContext(
  input: BuildForkContextInput,
): BuildForkContextResult {
  const parentMessages = structuredClone(input.parentMessages) as Message[]
  const tail = parentMessages.at(-1)
  const placeholders = tail?.role === 'assistant'
    ? tail.content
        .filter(block => block.type === 'tool_use')
        .map(block => makeToolMessage(block.id, {
          output: 'F',
          isError: false,
        }))
    : []
  const context = input.context?.trim()
  const directiveText = [
    'Fork',
    input.directive,
    ...(context ? [context] : []),
  ].join('\n\n')
  return {
    forkContext: { mode: 'structured' },
    forkMessages: [
      ...parentMessages,
      ...placeholders,
      makeUserMessage({ text: directiveText }),
    ],
  }
}
