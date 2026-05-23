// src/core/provider/openai.ts
import OpenAI from 'openai'
import type {
  LLMProvider,
  LLMRequest,
  ProviderCompactResult,
  ProviderEvent,
  ToolSpec,
} from './types'
import type {
  ContentBlock,
  ImageContentBlock,
  Message,
  StopReason,
  ToolContentBlock,
} from '../message/types'
import { fetchRemoteModels } from './remoteModels'

type OpenAIOpts = {
  id: string
  apiKey: string
  baseUrl: string
  extraHeaders?: Record<string, string>
  fetchFn?: typeof fetch
}

export class OpenAIProvider implements LLMProvider {
  readonly id: string
  readonly format = 'openai' as const
  private client: OpenAI
  private apiKey: string
  private baseUrl: string
  private extraHeaders: Record<string, string>
  private fetchFn: typeof fetch

  constructor(opts: OpenAIOpts) {
    this.id = opts.id
    this.apiKey = opts.apiKey
    this.baseUrl = opts.baseUrl
    this.extraHeaders = opts.extraHeaders ?? {}
    this.fetchFn = opts.fetchFn ?? fetch
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
    if (this.shouldUseResponsesEndpoint()) {
      const responsesStream = await this.createResponsesStream(req, signal)
      for await (const ev of this.translateResponsesStream(responsesStream)) {
        yield ev
      }
      return
    }

    const params: Record<string, unknown> = {
      model: req.model,
      stream: true,
      stream_options: { include_usage: true },
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      messages: toOpenAIMessages(req.system, req.messages),
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
    }
    if (req.effort) {
      params['reasoning'] = { effort: req.effort }
    }
    const sdkStream = await this.client.chat.completions.create(
      params as any,
      { signal },
    )
    for await (const ev of this.translateStream(sdkStream as any)) {
      yield ev
    }
  }

  private shouldUseResponsesEndpoint(): boolean {
    const base = normalizeBaseUrl(this.baseUrl)
    return this.id.startsWith('custom') || base !== 'https://api.openai.com/v1'
  }

  private async createResponsesStream(
    req: LLMRequest,
    signal: AbortSignal,
  ): Promise<AsyncIterable<unknown>> {
    const payload = toOpenAIResponsesPayload(req)
    let lastError: Error | null = null

    for (const endpoint of responsesEndpoints(this.baseUrl)) {
      const res = await this.fetchFn(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) return parseSseJsonStream(res)

      const detail = await safeResponseText(res)
      const err = new Error(
        `OpenAI Responses request failed (${res.status} ${res.statusText}) at ${endpoint}: ${detail}`,
      )
      lastError = err
      if (res.status === 404) continue
      throw err
    }

    throw lastError ?? new Error('OpenAI Responses request failed')
  }

  async compact(
    req: LLMRequest,
    signal: AbortSignal,
  ): Promise<ProviderCompactResult> {
    const payload = toOpenAIResponsesCompactPayload(req)
    let lastError: Error | null = null

    for (const endpoint of responsesCompactEndpoints(this.baseUrl)) {
      const res = await this.fetchFn(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const body = await res.json() as any
        const output = Array.isArray(body?.output) ? body.output : []
        return {
          implementation: 'responses_compact',
          output,
          usage: usageFromResponse(body),
          responseId: typeof body?.id === 'string' ? body.id : undefined,
        }
      }

      const detail = await safeResponseText(res)
      const err = new Error(
        `OpenAI Responses compact request failed (${res.status} ${res.statusText}) at ${endpoint}: ${detail}`,
      )
      lastError = err
      if (res.status === 404) continue
      throw err
    }

    throw lastError ?? new Error('OpenAI Responses compact request failed')
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

  async *translateResponsesStream(
    chunks: AsyncIterable<unknown>,
  ): AsyncIterable<ProviderEvent> {
    type ToolBuf = { id: string; name: string; args: string; started: boolean; stopped: boolean }
    const toolsByOutputIndex = new Map<number, ToolBuf>()
    const toolsByItemId = new Map<string, ToolBuf>()
    const toolOrder: ToolBuf[] = []
    let stopReason: StopReason = 'end_turn'
    let usage = { inputTokens: 0, outputTokens: 0 }

    const rememberTool = (buf: ToolBuf, raw: any, item?: any): void => {
      if (typeof raw.output_index === 'number') toolsByOutputIndex.set(raw.output_index, buf)
      if (typeof raw.item_id === 'string') toolsByItemId.set(raw.item_id, buf)
      if (typeof item?.id === 'string') toolsByItemId.set(item.id, buf)
      if (typeof item?.call_id === 'string') toolsByItemId.set(item.call_id, buf)
    }

    const findTool = (raw: any, item?: any): ToolBuf | undefined => {
      if (typeof raw.output_index === 'number') {
        const byIndex = toolsByOutputIndex.get(raw.output_index)
        if (byIndex) return byIndex
      }
      if (typeof raw.item_id === 'string') {
        const byItem = toolsByItemId.get(raw.item_id)
        if (byItem) return byItem
      }
      if (typeof item?.id === 'string') {
        const byItem = toolsByItemId.get(item.id)
        if (byItem) return byItem
      }
      if (typeof item?.call_id === 'string') {
        const byCall = toolsByItemId.get(item.call_id)
        if (byCall) return byCall
      }
      return undefined
    }

    const ensureTool = (raw: any, item?: any): ToolBuf => {
      const existing = findTool(raw, item)
      if (existing) {
        if (typeof item?.name === 'string' && item.name.length > 0) existing.name = item.name
        if (typeof item?.call_id === 'string' && item.call_id.length > 0) existing.id = item.call_id
        rememberTool(existing, raw, item)
        return existing
      }
      const id = typeof item?.call_id === 'string' && item.call_id.length > 0
        ? item.call_id
        : typeof item?.id === 'string' && item.id.length > 0
          ? item.id
          : typeof raw.output_index === 'number'
            ? `call_${raw.output_index}`
            : `call_${toolOrder.length}`
      const buf: ToolBuf = {
        id,
        name: typeof item?.name === 'string' ? item.name : '',
        args: '',
        started: false,
        stopped: false,
      }
      toolOrder.push(buf)
      rememberTool(buf, raw, item)
      return buf
    }

    for await (const raw of chunks) {
      const chunk = raw as any
      const type = chunk.type ?? chunk.event

      if (type === 'error' || type === 'response.error') {
        throw new Error(responseErrorMessage(chunk.error ?? chunk))
      }
      if (type === 'response.failed') {
        throw new Error(responseErrorMessage(chunk.response?.error ?? chunk.error ?? chunk))
      }

      if (type === 'response.output_text.delta') {
        const delta = typeof chunk.delta === 'string'
          ? chunk.delta
          : typeof chunk.delta?.text === 'string'
            ? chunk.delta.text
            : ''
        if (delta.length > 0) yield { type: 'text_delta', text: delta }
        continue
      }

      if (type === 'response.output_item.added') {
        const item = chunk.item
        if (item?.type === 'function_call') {
          const buf = ensureTool(chunk, item)
          if (!buf.started && buf.name) {
            buf.started = true
            yield { type: 'tool_use_start', id: buf.id, name: buf.name }
          }
        }
        continue
      }

      if (type === 'response.function_call_arguments.delta') {
        const buf = ensureTool(chunk)
        if (!buf.started && buf.name) {
          buf.started = true
          yield { type: 'tool_use_start', id: buf.id, name: buf.name }
        }
        const delta = typeof chunk.delta === 'string' ? chunk.delta : ''
        if (delta.length > 0) {
          buf.args += delta
          yield { type: 'tool_use_args_delta', id: buf.id, delta }
        }
        continue
      }

      if (type === 'response.function_call_arguments.done') {
        const buf = findTool(chunk)
        const fullArgs = typeof chunk.arguments === 'string' ? chunk.arguments : ''
        if (buf && fullArgs.length > 0 && buf.args.length === 0) {
          buf.args = fullArgs
          yield { type: 'tool_use_args_delta', id: buf.id, delta: fullArgs }
        }
        continue
      }

      if (type === 'response.output_item.done') {
        const item = chunk.item
        if (item?.type === 'function_call') {
          const buf = ensureTool(chunk, item)
          if (!buf.started && buf.name) {
            buf.started = true
            yield { type: 'tool_use_start', id: buf.id, name: buf.name }
          }
          if (typeof item.arguments === 'string' && item.arguments.length > 0 && buf.args.length === 0) {
            buf.args = item.arguments
            yield { type: 'tool_use_args_delta', id: buf.id, delta: item.arguments }
          }
          if (!buf.stopped) {
            buf.stopped = true
            yield { type: 'tool_use_stop', id: buf.id, input: parseToolArgs(buf.args) }
          }
        }
        continue
      }

      if (type === 'response.completed') {
        const response = chunk.response ?? {}
        usage = usageFromResponse(response)
        stopReason = normalizeResponseStop(response, toolOrder.length > 0)
        continue
      }
    }

    for (const buf of toolOrder) {
      if (!buf.stopped) {
        yield { type: 'tool_use_stop', id: buf.id, input: parseToolArgs(buf.args) }
      }
    }

    yield {
      type: 'message_stop',
      stopReason,
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function responsesEndpoints(baseUrl: string): string[] {
  const base = normalizeBaseUrl(baseUrl)
  return base.endsWith('/v1')
    ? [`${base}/responses`]
    : [`${base}/responses`, `${base}/v1/responses`]
}

function responsesCompactEndpoints(baseUrl: string): string[] {
  return responsesEndpoints(baseUrl).map(endpoint => `${endpoint}/compact`)
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, 500)
  } catch {
    return ''
  }
}

async function *parseSseJsonStream(res: Response): AsyncIterable<unknown> {
  if (!res.body) return
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const rawChunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(rawChunk, { stream: true })
    let frameEnd = findSseFrameEnd(buffer)
    while (frameEnd) {
      const frame = buffer.slice(0, frameEnd.index)
      buffer = buffer.slice(frameEnd.index + frameEnd.length)
      for (const item of parseSseFrame(frame)) yield item
      frameEnd = findSseFrameEnd(buffer)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim().length > 0) {
    for (const item of parseSseFrame(buffer)) yield item
  }
}

function findSseFrameEnd(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf < 0 && crlf < 0) return null
  if (lf < 0) return { index: crlf, length: 4 }
  if (crlf < 0) return { index: lf, length: 2 }
  return crlf < lf ? { index: crlf, length: 4 } : { index: lf, length: 2 }
}

function parseSseFrame(frame: string): unknown[] {
  const data = frame
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
    .trim()
  if (!data || data === '[DONE]') return []
  try {
    return [JSON.parse(data)]
  } catch {
    return []
  }
}

function responseErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.code === 'string') return obj.code
  }
  return String(error ?? 'OpenAI Responses stream failed')
}

function parseToolArgs(args: string): unknown {
  try {
    return JSON.parse(args || '{}')
  } catch {
    return {}
  }
}

function usageFromResponse(response: any): { inputTokens: number; outputTokens: number } {
  const usage = response?.usage ?? {}
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
  }
}

function normalizeResponseStop(response: any, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return 'tool_use'
  const status = response?.status
  if (status === 'incomplete') {
    const reason = response?.incomplete_details?.reason
    return reason === 'max_output_tokens' ? 'max_tokens' : 'error'
  }
  return 'end_turn'
}

type OpenAIPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

function imageBlockToOpenAIPart(b: ImageContentBlock): OpenAIPart {
  if (b.dataBase64 !== undefined) {
    return {
      type: 'image_url',
      image_url: { url: `data:${b.mediaType};base64,${b.dataBase64}` },
    }
  }
  if (b.url !== undefined) {
    return { type: 'image_url', image_url: { url: b.url } }
  }
  return { type: 'text', text: '[image: (no data)]' }
}

function userContentForOpenAI(blocks: ContentBlock[]): string | OpenAIPart[] {
  const hasImage = blocks.some(b => b.type === 'image')
  if (!hasImage) {
    return blocks
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map(b => b.text)
      .join('')
  }
  const parts: OpenAIPart[] = []
  for (const b of blocks) {
    if (b.type === 'text') parts.push({ type: 'text', text: b.text })
    else if (b.type === 'image') parts.push(imageBlockToOpenAIPart(b))
  }
  return parts
}

type OpenAIResponsesPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'auto' }

function imageBlockToResponsesPart(b: ImageContentBlock): OpenAIResponsesPart {
  if (b.dataBase64 !== undefined) {
    return {
      type: 'input_image',
      image_url: `data:${b.mediaType};base64,${b.dataBase64}`,
      detail: 'auto',
    }
  }
  if (b.url !== undefined) {
    return { type: 'input_image', image_url: b.url, detail: 'auto' }
  }
  return { type: 'input_text', text: '[image: (no data)]' }
}

function userContentForResponses(blocks: ContentBlock[]): string | OpenAIResponsesPart[] {
  const hasImage = blocks.some(b => b.type === 'image')
  if (!hasImage) {
    return blocks
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map(b => b.text)
      .join('')
  }
  const parts: OpenAIResponsesPart[] = []
  for (const b of blocks) {
    if (b.type === 'text') parts.push({ type: 'input_text', text: b.text })
    else if (b.type === 'image') parts.push(imageBlockToResponsesPart(b))
  }
  return parts
}

function assistantTextForResponses(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('')
}

function toOpenAIResponsesInput(messages: Message[]): unknown[] {
  const out: unknown[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'responses_compaction') {
      out.push(...m.output)
      continue
    }
    if (m.role === 'user') {
      out.push({ role: 'user', content: userContentForResponses(m.content) })
    } else if (m.role === 'assistant') {
      const text = assistantTextForResponses(m.content)
      if (text.length > 0) out.push({ role: 'assistant', content: text })
      for (const b of m.content) {
        if (b.type === 'tool_use') {
          out.push({
            type: 'function_call',
            call_id: b.id,
            name: b.name,
            arguments: JSON.stringify(b.input ?? {}),
          })
        }
      }
    } else if (m.role === 'tool') {
      out.push({
        type: 'function_call_output',
        call_id: m.toolUseId,
        output: typeof m.content === 'string'
          ? m.content
          : toolContentBlocksToOpenAI(m.content),
      })
    }
  }
  return out
}

function toOpenAIResponsesTools(tools: ToolSpec[]): unknown[] | undefined {
  if (tools.length === 0) return undefined
  return tools.map(t => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
}

function toOpenAIResponsesPayload(req: LLMRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: req.model,
    stream: true,
    instructions: req.system,
    input: toOpenAIResponsesInput(req.messages),
    tools: toOpenAIResponsesTools(req.tools),
    temperature: req.temperature,
    max_output_tokens: req.maxTokens,
  }
  if (req.effort) {
    payload.reasoning = { effort: req.effort }
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  )
}

function toOpenAIResponsesCompactPayload(req: LLMRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: req.model,
    instructions: req.system,
    input: toOpenAIResponsesInput(req.messages),
    tools: toOpenAIResponsesTools(req.tools),
    temperature: req.temperature,
    max_output_tokens: req.maxTokens,
  }
  if (req.effort) {
    payload.reasoning = { effort: req.effort }
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  )
}

function toOpenAIMessages(system: string, messages: Message[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'responses_compaction') continue
    if (m.role === 'user') {
      out.push({ role: 'user', content: userContentForOpenAI(m.content) })
    } else if (m.role === 'assistant') {
      const text = m.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map(b => b.text)
        .join('')
      const toolCalls = m.content
        .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
        .map(b => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }))
      out.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
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

/** Test-only re-export. Not part of the public provider API. */
export const __test_toOpenAIMessages = toOpenAIMessages
/** Test-only re-export. Not part of the public provider API. */
export const __test_toOpenAIResponsesPayload = toOpenAIResponsesPayload

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
