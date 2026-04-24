import type { McpServerConfig, McpConnectionStatus, McpToolDescriptor, McpResourceDescriptor } from './types'
import { pathToFileURL } from 'node:url'
import {
  Client,
  StdioClientTransport,
  StreamableHTTPClientTransport,
  ListRootsRequestSchema,
} from './sdkBridge'
import type { ContentBlock } from '../tools/content'
import { mcpTmpDir, mimeToExt } from './paths'
import { truncateMcpResult, truncateDescription } from './truncate'
import fs from 'node:fs'
import crypto from 'node:crypto'

type SdkClientHandle = InstanceType<typeof Client>

export const DEFAULT_MAX_RESULT_CHARS = 100_000
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 600_000

/**
 * Race a promise against a timer. On timeout the returned promise rejects
 * with a labelled `Error('<label> timed out after <ms>ms')` — the caller is
 * responsible for translating that into the appropriate surface.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

export class McpClient {
  readonly name: string
  readonly config: McpServerConfig
  private status_: McpConnectionStatus = { kind: 'idle' }
  private onStatus?: (s: McpConnectionStatus) => void
  private sdk?: SdkClientHandle
  private toolsCache?: McpToolDescriptor[]
  private resourcesCache?: McpResourceDescriptor[]
  private maxResultChars: number
  private connectTimeoutMs: number
  private requestTimeoutMs: number
  private serverInstructions_?: string

  constructor(opts: {
    name: string
    config: McpServerConfig
    onStatusChange?: (s: McpConnectionStatus) => void
    maxResultChars?: number
    connectTimeoutMs?: number
    requestTimeoutMs?: number
  }) {
    this.name = opts.name
    this.config = opts.config
    this.onStatus = opts.onStatusChange
    this.maxResultChars = opts.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS
    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  get status(): McpConnectionStatus {
    return this.status_
  }

  /**
   * Server-provided instructions, if any. Captured from the SDK's
   * `getInstructions()` once connected, and truncated to
   * `MAX_MCP_DESCRIPTION_CHARS` to protect the system prompt.
   */
  get serverInstructions(): string | undefined {
    return this.serverInstructions_
  }

  private emit(s: McpConnectionStatus): void {
    this.status_ = s
    this.onStatus?.(s)
  }

  async connect(signal?: AbortSignal): Promise<void> {
    this.emit({ kind: 'connecting' })
    try {
      let transport: InstanceType<typeof StdioClientTransport> | InstanceType<typeof StreamableHTTPClientTransport>
      if (this.config.type === 'stdio') {
        const { command, args, env } = this.config
        transport = new StdioClientTransport({
          command,
          args: args ?? [],
          env: { ...process.env, ...(env ?? {}) } as Record<string, string>,
        })
      } else {
        transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
          requestInit: { headers: this.config.headers },
        })
      }

      const client = new Client(
        { name: 'nuka', version: '0.1' },
        { capabilities: { roots: { listChanged: false } } },
      )

      // Advertise the cwd as a single root so servers that ask for
      // `roots/list` get a sensible answer instead of an error.
      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: pathToFileURL(process.cwd()).href, name: 'cwd' }],
      }))

      await withTimeout(
        client.connect(transport as Parameters<typeof client.connect>[0]),
        this.connectTimeoutMs,
        'connect',
      )
      this.sdk = client

      // Capture server-supplied instructions (if any) and cap their length so
      // a chatty server cannot balloon the system prompt.
      const rawInstructions =
        typeof (client as { getInstructions?: () => string | undefined }).getInstructions === 'function'
          ? (client as { getInstructions: () => string | undefined }).getInstructions()
          : undefined
      this.serverInstructions_ = rawInstructions
        ? truncateDescription(rawInstructions)
        : undefined

      const tools = await this.listTools()
      const resources = await this.listResources()
      this.emit({ kind: 'connected', toolCount: tools.length, resourceCount: resources.length })
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const error = raw.startsWith('connect timed out') ? 'connect timeout' : raw
      this.emit({ kind: 'error', error })
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    if (this.toolsCache) return this.toolsCache
    if (!this.sdk) throw new Error('Not connected')
    const result = await this.sdk.listTools()
    this.toolsCache = result.tools.map(t => {
      const raw = t as {
        name: string
        description?: string
        inputSchema?: Record<string, unknown>
        annotations?: {
          readOnlyHint?: boolean
          destructiveHint?: boolean
          openWorldHint?: boolean
        }
      }
      return {
        name: raw.name,
        description: raw.description,
        inputSchema: raw.inputSchema,
        annotations: raw.annotations,
      }
    })
    return this.toolsCache
  }

  async listResources(): Promise<McpResourceDescriptor[]> {
    if (this.resourcesCache) return this.resourcesCache
    if (!this.sdk) throw new Error('Not connected')
    const result = await this.sdk.listResources()
    this.resourcesCache = result.resources.map(r => ({
      uri: r.uri,
      name: r.name,
      mimeType: r.mimeType,
      description: r.description,
      server: this.name,
    }))
    return this.resourcesCache
  }

  async callTool(
    rawName: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<{ output: string | ContentBlock[]; isError: boolean }> {
    if (!this.sdk) throw new Error('Not connected')
    let result: Awaited<ReturnType<SdkClientHandle['callTool']>>
    try {
      result = await withTimeout(
        this.sdk.callTool(
          { name: rawName, arguments: input as Record<string, unknown> },
          undefined,
          { signal },
        ),
        this.requestTimeoutMs,
        'callTool',
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.startsWith('callTool timed out')) {
        return { output: `request timeout (${this.requestTimeoutMs}ms)`, isError: true }
      }
      throw err
    }
    const sdkContent = result.content as Array<{
      type: string
      text?: string
      mimeType?: string
      data?: string
      uri?: string
    }>

    // Check if any block is rich (image); if so return ContentBlock[]
    const hasRichBlock = sdkContent.some(b => b.type === 'image')
    if (hasRichBlock) {
      const blocks: ContentBlock[] = []
      for (const block of sdkContent) {
        if (block.type === 'text') {
          blocks.push({ type: 'text', text: block.text ?? '' })
        } else if (block.type === 'image') {
          const mimeType = block.mimeType ?? 'application/octet-stream'
          const ext = mimeToExt(mimeType)
          const id = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
          const dir = mcpTmpDir()
          const filePath = `${dir}/${id}${ext}`
          const rawData = block.data ?? ''
          fs.writeFileSync(filePath, Buffer.from(rawData, 'base64'))
          blocks.push({ type: 'image', path: filePath, mimeType })
        } else if (block.type === 'resource_link') {
          blocks.push({ type: 'resource', uri: block.uri ?? '' })
        } else {
          blocks.push({ type: 'text', text: '[unknown content block]' })
        }
      }
      return { output: blocks, isError: (result.isError as boolean) ?? false }
    }

    // No rich blocks — return plain string for backward compat
    const lines: string[] = []
    for (const block of sdkContent) {
      if (block.type === 'text') {
        lines.push(block.text ?? '')
      } else if (block.type === 'resource_link') {
        // Auto-fetch the referenced resource inline so the model sees its
        // content, not just its URI. The result is kept as plain text
        // (joined into the lines array) rather than a structured
        // ContentBlock — see M1.5 rationale: avoids cross-worktree
        // coupling with M2's ContentBlock shape until that work lands.
        if (block.uri) {
          try {
            const fetched = await this.readResource(block.uri, signal)
            lines.push(fetched.output)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            lines.push(`[resource fetch failed: ${block.uri} — ${msg}]`)
          }
        } else {
          lines.push('[resource_link: missing uri]')
        }
      } else {
        lines.push('[unknown content block]')
      }
    }
    const truncated = truncateMcpResult(lines, this.maxResultChars)
    return { output: truncated.text, isError: (result.isError as boolean) ?? false }
  }

  async readResource(
    uri: string,
    signal?: AbortSignal,
  ): Promise<{ output: string; isError: boolean }> {
    if (!this.sdk) throw new Error('Not connected')
    let result: Awaited<ReturnType<SdkClientHandle['readResource']>>
    try {
      result = await withTimeout(
        this.sdk.readResource({ uri }, { signal }),
        this.requestTimeoutMs,
        'readResource',
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.startsWith('readResource timed out')) {
        return { output: `request timeout (${this.requestTimeoutMs}ms)`, isError: true }
      }
      throw err
    }
    const lines: string[] = []
    for (const c of result.contents) {
      const item = c as { uri: string; mimeType?: string; text?: string; blob?: string }
      if (item.text !== undefined) {
        lines.push(item.text)
      } else if (item.blob !== undefined) {
        lines.push(`[blob: ${item.mimeType ?? 'unknown'} len=${item.blob.length}]`)
      }
    }
    const truncated = truncateMcpResult(lines, this.maxResultChars)
    return { output: truncated.text, isError: false }
  }

  async close(): Promise<void> {
    await this.sdk?.close()
    this.sdk = undefined
    this.toolsCache = undefined
    this.resourcesCache = undefined
    this.serverInstructions_ = undefined
    this.status_ = { kind: 'idle' }
  }
}
