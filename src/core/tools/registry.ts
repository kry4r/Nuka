// src/core/tools/registry.ts
import type { Tool } from './types'
import { toToolSpec } from './types'
import type { ToolSpec } from '../provider/types'

export class ToolRegistry {
  private byName = new Map<string, Tool>()

  register(tool: Tool): { registered: boolean; reason?: string } {
    if (this.byName.has(tool.name)) {
      console.warn(`[ToolRegistry] duplicate tool name skipped: ${tool.name}`)
      return { registered: false, reason: 'duplicate' }
    }
    this.byName.set(tool.name, tool)
    return { registered: true }
  }

  find(name: string): Tool | undefined {
    return this.byName.get(name)
  }

  list(): Tool[] {
    return [...this.byName.values()]
  }

  listSpecs(): ToolSpec[] {
    return this.list().map(toToolSpec)
  }

  bySource(source: Tool['source']): Tool[] {
    return this.list().filter(t => t.source === source)
  }
}
