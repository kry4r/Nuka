// Thin re-export so tests can vi.mock() this file and swap the implementations.
export { Client } from '@modelcontextprotocol/sdk/client/index.js'
export { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
