import { z } from 'zod'
import { McpServerConfigSchema } from '../config/schema'

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
export type McpStdioServerConfig = Extract<McpServerConfig, { type: 'stdio' }>
export type McpHttpServerConfig = Extract<McpServerConfig, { type: 'http' }>

export type McpConnectionStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; toolCount: number; resourceCount: number }
  | { kind: 'error'; error: string }

export type McpToolDescriptor = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpResourceDescriptor = {
  uri: string
  name: string
  mimeType?: string
  description?: string
  server: string
}
