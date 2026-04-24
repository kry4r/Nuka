// src/core/provider/anthropic.ts
import Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs'
import type {
  LLMProvider,
  LLMRequest,
  ProviderEvent,
  ToolSpec,
} from './types'
import type { Message, StopReason, ToolContentBlock } from '../message/types'
import { fetchRemoteModels } from './remoteModels'

type AnthropicOpts = {
  id: string
  apiKey: string
  baseUrl: string
  extraHeaders?: Record<string, string>
}

export class AnthropicProvider implements LLMProvider {
  readonly id: string
  readonly format = 'anthropic' as const
  private client: Anthropic
  private baseUrl: string
  private apiKey: string
  private extraHeaders: Record<string, string>

  constructor(opts: AnthropicOpts) {
    this.id = opts.id
    this.baseUrl = opts.baseUrl
    this.apiKey = opts.apiKey
    this.extraHeaders = opts.extraHeaders ?? {}
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      defaultHeaders: this.extraHeaders,
    })
  }

  async *stream(
    req: LLMRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const sdkStream = this.client.messages.stream(
      {
        model: req.model,
        system: req.system,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature,
        messages: toAnthropicMessages(req.messages) as any,
        tools: req.tools.map(toAnthropicTool) as any,
      },
      { signal },
    )
    for await (const ev of this.translateStream(sdkStream)) {
      yield ev
    }
  }

  /** Exposed for unit testing with a fake SDK stream. */
  async *translateStream(
    sdkStream: AsyncIterable<unknown>,
  ): AsyncIterable<ProviderEvent> {
    const toolInputBuffers = new Map<string, string>()
    const blockMeta = new Map<number, { kind: 'text' | 'tool_use'; id?: string }>()

    for await (const raw of sdkStream) {
      const ev = raw as any

      if (ev.type === 'content_block_start') {
        if (ev.content_block.type === 'tool_use') {
          blockMeta.set(ev.index, { kind: 'tool_use', id: ev.content_block.id })
          toolInputBuffers.set(ev.content_block.id, '')
          yield {
            type: 'tool_use_start',
            id: ev.content_block.id,
            name: ev.content_block.name,
          }
        } else {
          blockMeta.set(ev.index, { kind: 'text' })
        }
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: ev.delta.text }
        } else if (ev.delta.type === 'input_json_delta') {
          const meta = blockMeta.get(ev.index)
          if (meta?.kind === 'tool_use' && meta.id) {
            const buf = toolInputBuffers.get(meta.id) ?? ''
            toolInputBuffers.set(meta.id, buf + ev.delta.partial_json)
            yield {
              type: 'tool_use_args_delta',
              id: meta.id,
              delta: ev.delta.partial_json,
            }
          }
        }
      } else if (ev.type === 'content_block_stop') {
        const meta = blockMeta.get(ev.index)
        if (meta?.kind === 'tool_use' && meta.id) {
          const buf = toolInputBuffers.get(meta.id) ?? '{}'
          let parsed: unknown = {}
          try { parsed = JSON.parse(buf || '{}') } catch { /* empty */ }
          yield { type: 'tool_use_stop', id: meta.id, input: parsed }
        }
      } else if (ev.type === 'message_delta') {
        // capture usage + stop_reason for the final message_stop
        ;(this as any)._lastDelta = ev
      } else if (ev.type === 'message_stop') {
        const last = (this as any)._lastDelta
        const stopReason: StopReason = normalizeStop(
          last?.delta?.stop_reason ?? 'end_turn',
        )
        yield {
          type: 'message_stop',
          stopReason,
          usage: {
            inputTokens: last?.usage?.input_tokens ?? 0,
            outputTokens: last?.usage?.output_tokens ?? 0,
            cacheReadTokens: last?.usage?.cache_read_input_tokens,
            cacheWriteTokens: last?.usage?.cache_creation_input_tokens,
          },
        }
      }
    }
  }

  async listRemoteModels(): Promise<string[]> {
    return fetchRemoteModels({
      format: 'anthropic',
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      extraHeaders: this.extraHeaders,
    })
  }
}

function normalizeStop(r: string): StopReason {
  switch (r) {
    case 'end_turn': return 'end_turn'
    case 'tool_use': return 'tool_use'
    case 'max_tokens': return 'max_tokens'
    case 'stop_sequence': return 'stop_sequence'
    default: return 'end_turn'
  }
}

function toAnthropicMessages(messages: Message[]): unknown[] {
  const out: any[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      out.push({ role: 'user', content: blocksToAnthropic(m.content) })
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: blocksToAnthropic(m.content) })
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolUseId,
            content: typeof m.content === 'string'
              ? m.content
              : toolContentBlocksToAnthropic(m.content),
            is_error: m.isError || undefined,
          },
        ],
      })
    }
  }
  return out
}

function blocksToAnthropic(blocks: any[]): unknown[] {
  return blocks.map((b: any) => {
    if (b.type === 'text') return { type: 'text', text: b.text }
    if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
    return b
  })
}

function toAnthropicTool(spec: ToolSpec): unknown {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.parameters,
  }
}

/** Map to MIME extension for base64 images. */
const MIME_TO_ANTHROPIC_MEDIA: Record<string, string> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
}

/**
 * Convert tool ContentBlock[] to Anthropic API content list.
 * text  → { type: 'text', text }
 * image → { type: 'image', source: { type: 'base64', media_type, data } }
 * resource → { type: 'text', text: `<uri>: <text>` }
 */
function toolContentBlocksToAnthropic(blocks: ToolContentBlock[]): unknown[] {
  return blocks.map(b => {
    if (b.type === 'text') {
      return { type: 'text', text: b.text }
    }
    if (b.type === 'image') {
      const mediaType = MIME_TO_ANTHROPIC_MEDIA[b.mimeType] ?? b.mimeType
      let data = ''
      try {
        data = fs.readFileSync(b.path).toString('base64')
      } catch {
        // File unreadable — fall back to a text placeholder
        return { type: 'text', text: `[image: ${b.mimeType} path=${b.path} (unreadable)]` }
      }
      return {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data },
      }
    }
    if (b.type === 'resource') {
      const parts: string[] = [b.uri]
      if (b.text) parts.push(b.text)
      return { type: 'text', text: parts.join('\n') }
    }
    return { type: 'text', text: '[unknown content block]' }
  })
}
