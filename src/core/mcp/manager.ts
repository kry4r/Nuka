import type { McpServerConfig, McpConnectionStatus } from './types'
import { McpClient } from './client'

export class McpManager {
  private clients: McpClient[]
  private listeners: Array<() => void> = []

  constructor(opts: {
    servers: Record<string, McpServerConfig>
    maxResultChars?: number
  }) {
    this.clients = Object.entries(opts.servers).map(
      ([name, config]) =>
        new McpClient({
          name,
          config,
          onStatusChange: () => this.notify(),
          maxResultChars: opts.maxResultChars,
        }),
    )
  }

  async startAll(): Promise<void> {
    await Promise.allSettled(this.clients.map(c => c.connect()))
  }

  status(): Array<{ name: string; status: McpConnectionStatus }> {
    return this.clients.map(c => ({ name: c.name, status: c.status }))
  }

  listClients(): McpClient[] {
    return [...this.clients]
  }

  findClient(name: string): McpClient | undefined {
    return this.clients.find(c => c.name === name)
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(this.clients.map(c => c.close()))
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }
}
