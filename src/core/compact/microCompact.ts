import type { Message, ToolMessage } from '../message/types'
import { roughTokenCountEstimationForMessage } from '../tokens/estimate'

export const MICROCOMPACT_CLEARED_TOOL_RESULT = '[Old tool result content cleared]'

export const DEFAULT_MICROCOMPACT_TOOLS = new Set<string>([
  'Read',
  'Bash',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
])

export type MicrocompactToolResultsOptions = {
  keepRecent?: number
  compactableTools?: ReadonlySet<string>
}

export type MicrocompactToolResultsResult = {
  compacted: boolean
  messages: Message[]
  clearedToolUseIds: string[]
  keptToolUseIds: string[]
  estimatedTokensSaved: number
}

const DEFAULT_KEEP_RECENT = 4

export function microcompactToolResults(
  messages: readonly Message[],
  options: MicrocompactToolResultsOptions = {},
): MicrocompactToolResultsResult {
  const keepRecent = Math.max(0, options.keepRecent ?? DEFAULT_KEEP_RECENT)
  const compactableTools = options.compactableTools ?? DEFAULT_MICROCOMPACT_TOOLS
  const toolNamesByUseId = collectToolNamesByUseId(messages)
  const compactableResultIds = collectCompactableResultIds(messages, toolNamesByUseId, compactableTools)
  const keepSet = new Set(keepRecent === 0 ? [] : compactableResultIds.slice(-keepRecent))
  const clearSet = new Set(compactableResultIds.filter(id => !keepSet.has(id)))

  if (clearSet.size === 0) {
    return {
      compacted: false,
      messages: [...messages],
      clearedToolUseIds: [],
      keptToolUseIds: compactableResultIds,
      estimatedTokensSaved: 0,
    }
  }

  let estimatedTokensSaved = 0
  const clearedToolUseIds: string[] = []
  const next = messages.map(message => {
    if (message.role !== 'tool' || !clearSet.has(message.toolUseId)) return message
    if (message.content === MICROCOMPACT_CLEARED_TOOL_RESULT) return message

    const before = roughTokenCountEstimationForMessage(message)
    const cleared: ToolMessage = {
      ...message,
      content: MICROCOMPACT_CLEARED_TOOL_RESULT,
    }
    const after = roughTokenCountEstimationForMessage(cleared)
    estimatedTokensSaved += Math.max(0, before - after)
    clearedToolUseIds.push(message.toolUseId)
    return cleared
  })

  return {
    compacted: clearedToolUseIds.length > 0,
    messages: next,
    clearedToolUseIds,
    keptToolUseIds: compactableResultIds.filter(id => keepSet.has(id)),
    estimatedTokensSaved,
  }
}

function collectToolNamesByUseId(messages: readonly Message[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block.type === 'tool_use') names.set(block.id, block.name)
    }
  }
  return names
}

function collectCompactableResultIds(
  messages: readonly Message[],
  toolNamesByUseId: ReadonlyMap<string, string>,
  compactableTools: ReadonlySet<string>,
): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const toolName = toolNamesByUseId.get(message.toolUseId)
    if (toolName && compactableTools.has(toolName)) {
      ids.push(message.toolUseId)
    }
  }
  return ids
}
