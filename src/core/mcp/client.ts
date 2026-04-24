import type { McpServerConfig, McpConnectionStatus, McpToolDescriptor, McpResourceDescriptor } from './types'
import { pathToFileURL } from 'node:url'
import {
  Client,
  StdioClientTransport,
  StreamableHTTPClientTransport,
  SSEClientTransport,
  ListRootsRequestSchema,
  ElicitRequestSchema,
} from './sdkBridge'
import type { ContentBlock } from '../tools/content'
import { mcpTmpDir, mimeToExt } from './paths'
import { truncateMcpResult, truncateDescription } from './truncate'
import {
  reconnectWithBackoff,
  isSessionExpiryError,
  DEFAULT_RECONNECT_POLICY,
  type ReconnectPolicy,
} from './reconnect'
import { parseElicitationParams } from './elicitation'
import type { PermissionBridge } from '../permission/bridge'
import { RingBuffer, DEFAULT_STDERR_BUFFER_BYTES } from './stderrBuffer'
import { persistLargeOutput } from './outputPersist'
import { sanitizeToolText } from './sanitize'
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
  private reconnectPolicy: ReconnectPolicy
  private deliberateClose = false
  private reconnectFailed = false
  private permissionBridge?: PermissionBridge
  private stderrBuf: RingBuffer
  private persistThresholdChars: number

  constructor(opts: {
    name: string
    config: McpServerConfig
    onStatusChange?: (s: McpConnectionStatus) => void
    maxResultChars?: number
    connectTimeoutMs?: number
    requestTimeoutMs?: number
    reconnectPolicy?: ReconnectPolicy
    permissionBridge?: PermissionBridge
    stderrBufferBytes?: number
    persistThresholdChars?: number
  }) {
    this.name = opts.name
    this.config = opts.config
    this.onStatus = opts.onStatusChange
    this.maxResultChars = opts.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS
    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.reconnectPolicy = opts.reconnectPolicy ?? DEFAULT_RECONNECT_POLICY
    this.permissionBridge = opts.permissionBridge
    this.stderrBuf = new RingBuffer(opts.stderrBufferBytes ?? DEFAULT_STDERR_BUFFER_BYTES)
    this.persistThresholdChars = opts.persistThresholdChars ?? 500_000
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

  /**
   * Returns the current contents of the stderr ring buffer.
   * For stdio transports, this captures the child process's stderr output.
   */
  stderr(): string {
    return this.stderrBuf.read()
  }

  private emit(s: McpConnectionStatus): void {
    this.status_ = s
    this.onStatus?.(s)
  }

  async connect(signal?: AbortSignal): Promise<void> {
    this.emit({ kind: 'connecting' })
    try {
      let transport:
        | InstanceType<typeof StdioClientTransport>
        | InstanceType<typeof StreamableHTTPClientTransport>
        | InstanceType<typeof SSEClientTransport>
      if (this.config.type === 'stdio') {
        const { command, args, env } = this.config
        const stdioTransport = new StdioClientTransport({
          command,
          args: args ?? [],
          env: { ...process.env, ...(env ?? {}) } as Record<string, string>,
          stderr: 'pipe',
        })
        // Wire the child process's stderr into our ring buffer.
        const stderrStream = (stdioTransport as unknown as { stderr?: NodeJS.ReadableStream | null }).stderr
        if (stderrStream) {
          stderrStream.on('data', (chunk: Buffer | string) => {
            this.stderrBuf.write(chunk)
          })
        }
        transport = stdioTransport
      } else if (this.config.type === 'sse') {
        transport = new SSEClientTransport(new URL(this.config.url), {
          requestInit: { headers: this.config.headers },
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

      // If a permission bridge is attached, handle `elicitation/create`
      // by opening the ElicitationDialog in the TUI and relaying the
      // user's choice back to the server.
      if (this.permissionBridge) {
        const bridge = this.permissionBridge
        client.setRequestHandler(ElicitRequestSchema, async (request) => {
          const payload = parseElicitationParams((request as { params?: unknown }).params)
          const result = await bridge.elicit(payload)
          return result
        })
      }

      await withTimeout(
        client.connect(transport as Parameters<typeof client.connect>[0]),
        this.connectTimeoutMs,
        'connect',
      )
      this.sdk = client
      this.reconnectFailed = false
      this.deliberateClose = false

      // When the transport closes (remote goes away, stdin EOFs, etc.) the
      // SDK fires `onclose` — invalidate our caches and enter the
      // `disconnected` error state so the next tool call triggers a
      // reconnect.
      ;(client as unknown as { onclose?: () => void }).onclose = () => {
        if (this.deliberateClose) return
        this.handleDisconnect()
      }

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
      const base = raw.startsWith('connect timed out') ? 'connect timeout' : raw
      // Append last ~2 KB of stderr (if any) to aid debugging.
      const stderrSnippet = this.stderrBuf.read()
      const tail = stderrSnippet.length > 0
        ? stderrSnippet.slice(-2048)
        : ''
      const error = tail.length > 0 ? `${base}\n${tail}` : base
      this.emit({ kind: 'error', error })
    }
  }

  private handleDisconnect(): void {
    this.sdk = undefined
    this.toolsCache = undefined
    this.resourcesCache = undefined
    this.serverInstructions_ = undefined
    this.emit({ kind: 'error', error: 'disconnected' })
  }

  /**
   * Make sure the SDK is live before a request. When it's been flagged as
   * disconnected (via `onclose` or a session-expiry error — HTTP 404 /
   * JSON-RPC -32001), this attempts `reconnectWithBackoff`. Returns `true`
   * when an SDK is available after the call.
   */
  private async ensureConnected(): Promise<boolean> {
    if (this.sdk) return true
    if (this.reconnectFailed) return false
    const result = await reconnectWithBackoff(async () => {
      await this.connect()
      if (!this.sdk) throw new Error(this.status_.kind === 'error' ? this.status_.error : 'connect failed')
    }, this.reconnectPolicy)
    if (!result.ok) {
      this.reconnectFailed = true
      return false
    }
    return !!this.sdk
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
        _meta?: {
          searchHint?: string[]
          alwaysLoad?: boolean
        }
      }
      return {
        name: raw.name,
        description: raw.description,
        inputSchema: raw.inputSchema,
        annotations: raw.annotations,
        // M1.16: carry _meta through so toolAdapter can map to Tool fields
        _meta: raw._meta,
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
    if (!(await this.ensureConnected())) {
      throw new Error('Not connected')
    }
    let result: Awaited<ReturnType<SdkClientHandle['callTool']>>
    const doCall = (): ReturnType<SdkClientHandle['callTool']> =>
      this.sdk!.callTool(
        { name: rawName, arguments: input as Record<string, unknown> },
        undefined,
        { signal },
      )
    try {
      result = await withTimeout(doCall(), this.requestTimeoutMs, 'callTool')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.startsWith('callTool timed out')) {
        return { output: `request timeout (${this.requestTimeoutMs}ms)`, isError: true }
      }
      // Session-expiry (HTTP 404 or JSON-RPC -32001) is handled the same
      // way as a transport `onclose`: mark disconnected, back off, retry
      // once.
      if (isSessionExpiryError(err)) {
        this.handleDisconnect()
        if (await this.ensureConnected()) {
          try {
            result = await withTimeout(doCall(), this.requestTimeoutMs, 'callTool')
          } catch (retryErr) {
            const m = retryErr instanceof Error ? retryErr.message : String(retryErr)
            if (m.startsWith('callTool timed out')) {
              return { output: `request timeout (${this.requestTimeoutMs}ms)`, isError: true }
            }
            throw retryErr
          }
        } else {
          throw err
        }
      } else {
        throw err
      }
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
          // M1.15: sanitize before returning to caller
          blocks.push({ type: 'text', text: sanitizeToolText(block.text ?? '') })
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
        // M1.15: sanitize BEFORE truncation
        lines.push(sanitizeToolText(block.text ?? ''))
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
    const fullText = lines.join('\n')
    const truncated = truncateMcpResult(lines, this.maxResultChars)
    // M1.14: If the original (pre-truncation) output exceeds the threshold,
    // write it to disk and append the path to the returned (truncated) text.
    // Only applies to string (non-image) outputs.
    let output = truncated.text
    if (fullText.length > this.persistThresholdChars) {
      try {
        const persisted = await persistLargeOutput({ fullText })
        output = `${output}\n...[full output at ${persisted.path}]`
      } catch {
        // Persistence failure is non-fatal: the truncated output is still useful.
      }
    }
    return { output, isError: (result.isError as boolean) ?? false }
  }

  async readResource(
    uri: string,
    signal?: AbortSignal,
  ): Promise<{ output: string; isError: boolean }> {
    if (!(await this.ensureConnected())) {
      throw new Error('Not connected')
    }
    let result: Awaited<ReturnType<SdkClientHandle['readResource']>>
    const doRead = (): ReturnType<SdkClientHandle['readResource']> =>
      this.sdk!.readResource({ uri }, { signal })
    try {
      result = await withTimeout(doRead(), this.requestTimeoutMs, 'readResource')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.startsWith('readResource timed out')) {
        return { output: `request timeout (${this.requestTimeoutMs}ms)`, isError: true }
      }
      if (isSessionExpiryError(err)) {
        this.handleDisconnect()
        if (await this.ensureConnected()) {
          try {
            result = await withTimeout(doRead(), this.requestTimeoutMs, 'readResource')
          } catch (retryErr) {
            const m = retryErr instanceof Error ? retryErr.message : String(retryErr)
            if (m.startsWith('readResource timed out')) {
              return { output: `request timeout (${this.requestTimeoutMs}ms)`, isError: true }
            }
            throw retryErr
          }
        } else {
          throw err
        }
      } else {
        throw err
      }
    }
    const lines: string[] = []
    for (const c of result.contents) {
      const item = c as { uri: string; mimeType?: string; text?: string; blob?: string }
      if (item.text !== undefined) {
        // M1.15: sanitize text contents BEFORE truncation
        lines.push(sanitizeToolText(item.text))
      } else if (item.blob !== undefined) {
        lines.push(`[blob: ${item.mimeType ?? 'unknown'} len=${item.blob.length}]`)
      }
    }
    const truncated = truncateMcpResult(lines, this.maxResultChars)
    return { output: truncated.text, isError: false }
  }

  async close(): Promise<void> {
    this.deliberateClose = true
    await this.sdk?.close()
    this.sdk = undefined
    this.toolsCache = undefined
    this.resourcesCache = undefined
    this.serverInstructions_ = undefined
    this.status_ = { kind: 'idle' }
  }
}
