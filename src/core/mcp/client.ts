import type { McpServerConfig, McpConnectionStatus, McpToolDescriptor, McpResourceDescriptor } from './types'
import { Client, StdioClientTransport, StreamableHTTPClientTransport } from './sdkBridge'

type SdkClientHandle = InstanceType<typeof Client>

export class McpClient {
  readonly name: string
  readonly config: McpServerConfig
  private status_: McpConnectionStatus = { kind: 'idle' }
  private onStatus?: (s: McpConnectionStatus) => void
  private sdk?: SdkClientHandle
  private toolsCache?: McpToolDescriptor[]
  private resourcesCache?: McpResourceDescriptor[]

  constructor(opts: {
    name: string
    config: McpServerConfig
    onStatusChange?: (s: McpConnectionStatus) => void
  }) {
    this.name = opts.name
    this.config = opts.config
    this.onStatus = opts.onStatusChange
  }

  get status(): McpConnectionStatus {
    return this.status_
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

      const client = new Client({ name: 'nuka', version: '0.1' }, { capabilities: {} })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      this.sdk = client

      const tools = await this.listTools()
      const resources = await this.listResources()
      this.emit({ kind: 'connected', toolCount: tools.length, resourceCount: resources.length })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.emit({ kind: 'error', error })
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    if (this.toolsCache) return this.toolsCache
    if (!this.sdk) throw new Error('Not connected')
    const result = await this.sdk.listTools()
    this.toolsCache = result.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }))
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
  ): Promise<{ output: string; isError: boolean }> {
    if (!this.sdk) throw new Error('Not connected')
    const result = await this.sdk.callTool(
      { name: rawName, arguments: input as Record<string, unknown> },
      undefined,
      { signal },
    )
    const lines: string[] = []
    const content = result.content as Array<{
      type: string
      text?: string
      mimeType?: string
      data?: string
      uri?: string
    }>
    for (const block of content) {
      if (block.type === 'text') {
        lines.push(block.text ?? '')
      } else if (block.type === 'image') {
        lines.push(`[binary: ${block.mimeType} len=${block.data?.length ?? 0}]`)
      } else if (block.type === 'resource_link') {
        lines.push(`[resource: ${block.uri}]`)
      } else {
        lines.push('[unknown content block]')
      }
    }
    return { output: lines.join('\n'), isError: (result.isError as boolean) ?? false }
  }

  async readResource(
    uri: string,
    signal?: AbortSignal,
  ): Promise<{ output: string; isError: boolean }> {
    if (!this.sdk) throw new Error('Not connected')
    const result = await this.sdk.readResource({ uri }, { signal })
    const lines: string[] = []
    for (const c of result.contents) {
      const item = c as { uri: string; mimeType?: string; text?: string; blob?: string }
      if (item.text !== undefined) {
        lines.push(item.text)
      } else if (item.blob !== undefined) {
        lines.push(`[blob: ${item.mimeType ?? 'unknown'} len=${item.blob.length}]`)
      }
    }
    return { output: lines.join('\n'), isError: false }
  }

  async close(): Promise<void> {
    await this.sdk?.close()
    this.sdk = undefined
    this.toolsCache = undefined
    this.resourcesCache = undefined
    this.status_ = { kind: 'idle' }
  }
}
