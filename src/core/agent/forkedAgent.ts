import type { Tool } from '../tools/types'
import type { Session } from '../session/types'
import type { Message } from '../message/types'

export type CacheSafeParams = {
  systemPrompt: string
  tools: Tool[]
  modelParams: { model: string; thinkingConfig?: unknown; maxTokens?: number }
  forkContextMessages: Message[]
}

export type CreateCacheSafeParamsOpts = {
  parentSession: Pick<Session, 'id' | 'providerId' | 'model' | 'messages'>
  registry: { list: () => Tool[] }
  systemPrompt: string
  maxFork?: number
  thinkingConfig?: unknown
  maxTokens?: number
}

const DEFAULT_FORK_WINDOW = 30

export function createCacheSafeParams(opts: CreateCacheSafeParamsOpts): CacheSafeParams {
  const window = opts.maxFork ?? DEFAULT_FORK_WINDOW
  const messages = [...opts.parentSession.messages]
  const recent = messages.slice(-window)
  return {
    systemPrompt: opts.systemPrompt,
    tools: [...opts.registry.list()],
    modelParams: {
      model: opts.parentSession.model,
      thinkingConfig: opts.thinkingConfig,
      maxTokens: opts.maxTokens,
    },
    forkContextMessages: recent,
  }
}

import type { LLMProvider, ToolSpec } from '../provider/types'
import type { TokenUsage } from '../message/types'
import { makeUserMessage } from '../message/factories'

export type RunForkedAgentOpts = {
  params: CacheSafeParams
  prompt: string
  provider: LLMProvider
  signal: AbortSignal
  /** Returns true to allow execution of the named tool; default deny-all. */
  canUseTool?: (toolName: string) => boolean
}

export async function runForkedAgent(opts: RunForkedAgentOpts): Promise<{ text: string; usage: TokenUsage }> {
  const { params, prompt, provider, signal } = opts
  const canUse = opts.canUseTool ?? (() => false)
  const messages = [...params.forkContextMessages, makeUserMessage({ text: prompt })]
  const toolSpecs: ToolSpec[] = params.tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
  let text = ''
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  for await (const ev of provider.stream(
    {
      model: params.modelParams.model,
      messages,
      system: params.systemPrompt,
      tools: toolSpecs,
      maxTokens: params.modelParams.maxTokens,
    },
    signal,
  )) {
    if (signal.aborted) break
    if (ev.type === 'text_delta') text += ev.text
    else if (ev.type === 'message_stop') usage = ev.usage
    else if (ev.type === 'tool_use_start') {
      if (!canUse(ev.name)) {
        text += `\n[fork: tool ${ev.name} denied]`
      }
    }
  }
  return { text, usage }
}
