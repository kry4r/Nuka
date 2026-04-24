import { z } from 'zod'
import { McpServerConfigSchema } from '../config/schema'

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
export type McpStdioServerConfig = Extract<McpServerConfig, { type: 'stdio' }>
export type McpHttpServerConfig = Extract<McpServerConfig, { type: 'http' }>
export type McpSseServerConfig = Extract<McpServerConfig, { type: 'sse' }>

export type McpConnectionStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; toolCount: number; resourceCount: number }
  | { kind: 'error'; error: string }

export type McpToolAnnotations = {
  /** Tool only reads data, does not mutate state. */
  readOnlyHint?: boolean
  /** Tool can perform destructive operations. */
  destructiveHint?: boolean
  /** Tool may contact external services (open world). */
  openWorldHint?: boolean
}

export type McpToolDescriptor = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: McpToolAnnotations
}

export type McpResourceDescriptor = {
  uri: string
  name: string
  mimeType?: string
  description?: string
  server: string
}
