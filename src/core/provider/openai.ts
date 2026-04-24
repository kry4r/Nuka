// src/core/provider/openai.ts
import OpenAI from 'openai'
import type {
  LLMProvider,
  LLMRequest,
  ProviderEvent,
  ToolSpec,
} from './types'
import type { Message, StopReason, ToolContentBlock } from '../message/types'
import { fetchRemoteModels } from './remoteModels'

type OpenAIOpts = {
  id: string
  apiKey: string
  baseUrl: string
  extraHeaders?: Record<string, string>
}

export class OpenAIProvider implements LLMProvider {
  readonly id: string
  readonly format = 'openai' as const
  private client: OpenAI
  private apiKey: string
  private baseUrl: string
  private extraHeaders: Record<string, string>

  constructor(opts: OpenAIOpts) {
    this.id = opts.id
    this.apiKey = opts.apiKey
    this.baseUrl = opts.baseUrl
    this.extraHeaders = opts.extraHeaders ?? {}
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      defaultHeaders: this.extraHeaders,
    })
  }

  async *stream(
    req: LLMRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const sdkStream = await this.client.chat.completions.create(
      {
        model: req.model,
        stream: true,
        stream_options: { include_usage: true },
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        messages: toOpenAIMessages(req.system, req.messages) as any,
        tools: req.tools.length > 0
          ? req.tools.map(t => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            }))
          : undefined,
      },
      { signal },
    )
    for await (const ev of this.translateStream(sdkStream as any)) {
      yield ev
    }
  }

  async *translateStream(
    chunks: AsyncIterable<unknown>,
  ): AsyncIterable<ProviderEvent> {
    type ToolBuf = { id: string; name: string; args: string; started: boolean }
    const toolsByIdx = new Map<number, ToolBuf>()
    let finishReason: string | null = null
    let usage = { inputTokens: 0, outputTokens: 0 }

    for await (const raw of chunks) {
      const chunk = raw as any
      const choice = chunk.choices?.[0]
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        }
      }
      if (!choice) continue
      const delta = choice.delta ?? {}
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield { type: 'text_delta', text: delta.content }
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          let buf = toolsByIdx.get(idx)
          if (!buf) {
            buf = { id: tc.id ?? `tc_${idx}`, name: tc.function?.name ?? '', args: '', started: false }
            toolsByIdx.set(idx, buf)
          }
          if (tc.id && !buf.id) buf.id = tc.id
          if (tc.function?.name && !buf.name) buf.name = tc.function.name
          if (!buf.started && buf.name) {
            buf.started = true
            yield { type: 'tool_use_start', id: buf.id, name: buf.name }
          }
          const piece: string | undefined = tc.function?.arguments
          if (typeof piece === 'string' && piece.length > 0) {
            buf.args += piece
            yield { type: 'tool_use_args_delta', id: buf.id, delta: piece }
          }
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason
    }

    for (const buf of toolsByIdx.values()) {
      let parsed: unknown = {}
      try { parsed = JSON.parse(buf.args || '{}') } catch { /* empty */ }
      yield { type: 'tool_use_stop', id: buf.id, input: parsed }
    }

    yield {
      type: 'message_stop',
      stopReason: normalizeFinish(finishReason),
      usage,
    }
  }

  async listRemoteModels(): Promise<string[]> {
    return fetchRemoteModels({
      format: 'openai',
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      extraHeaders: this.extraHeaders,
    })
  }
}

function normalizeFinish(r: string | null): StopReason {
  switch (r) {
    case 'tool_calls': return 'tool_use'
    case 'length': return 'max_tokens'
    case 'stop': return 'end_turn'
    default: return 'end_turn'
  }
}

function toOpenAIMessages(system: string, messages: Message[]): unknown[] {
  const out: any[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      const text = m.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
      out.push({ role: 'user', content: text })
    } else if (m.role === 'assistant') {
      const text = m.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
      const toolCalls = m.content
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }))
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      })
    } else if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolUseId,
        content: typeof m.content === 'string'
          ? m.content
          : toolContentBlocksToOpenAI(m.content),
      })
    }
  }
  return out
}

/**
 * Serialize tool ContentBlock[] for OpenAI (text-only).
 * Images are described by path (no native image blocks in tool results this phase).
 */
function toolContentBlocksToOpenAI(blocks: ToolContentBlock[]): string {
  return blocks
    .map(b => {
      if (b.type === 'text') return b.text
      if (b.type === 'image') return `[image: ${b.mimeType} path=${b.path}]`
      if (b.type === 'resource') {
        const parts: string[] = [b.uri]
        if (b.text) parts.push(b.text)
        return parts.join('\n')
      }
      return ''
    })
    .join('\n')
}
