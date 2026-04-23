// src/core/tools/registry.ts
import type { Tool } from './types'
import { toToolSpec } from './types'
import type { ToolSpec } from '../provider/types'

export class ToolRegistry {
  private byName = new Map<string, Tool>()

  register(tool: Tool): void {
    if (this.byName.has(tool.name)) {
      throw new Error(`duplicate tool name: ${tool.name}`)
    }
    this.byName.set(tool.name, tool)
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
}
