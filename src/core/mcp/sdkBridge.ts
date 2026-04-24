// Thin re-export so tests can vi.mock() this file and swap the implementations.
export { Client } from '@modelcontextprotocol/sdk/client/index.js'
export { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
export { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
export {
  ListRootsRequestSchema,
  ElicitRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
export type {
  ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
