// src/core/tools/registry.ts
import type { Tool } from './types'
import { toToolSpec } from './types'
import type { ToolSpec } from '../provider/types'

export class ToolRegistry {
  private byName = new Map<string, Tool>()
  /** alias → primary tool name */
  private aliasMap = new Map<string, string>()

  register(tool: Tool): { registered: boolean; reason?: string } {
    if (this.byName.has(tool.name)) {
      console.warn(`[ToolRegistry] duplicate tool name skipped: ${tool.name}`)
      return { registered: false, reason: 'duplicate' }
    }
    this.byName.set(tool.name, tool)

    // Register aliases, skipping any that collide with existing names or aliases
    for (const alias of tool.aliases ?? []) {
      if (this.byName.has(alias) || this.aliasMap.has(alias)) {
        console.warn(`[ToolRegistry] alias "${alias}" for tool "${tool.name}" conflicts with an existing name/alias — skipped`)
        continue
      }
      this.aliasMap.set(alias, tool.name)
    }

    return { registered: true }
  }

  find(name: string): Tool | undefined {
    // Check primary name first, then alias map
    const direct = this.byName.get(name)
    if (direct) return direct
    const primaryName = this.aliasMap.get(name)
    if (primaryName) return this.byName.get(primaryName)
    return undefined
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

  /**
   * Return tools whose `tags` array intersects the input. Exact string match
   * per tag, no globbing. Tools with no/empty `tags` are never matched here
   * (they're reachable only via the `core` rule or by name).
   *
   * Empty `tags` input returns `[]` — callers should treat "no requires" as
   * "no additional tools" rather than "all tools" (see spec §4.3).
   */
  queryByTags(tags: string[]): Tool[] {
    if (!tags || tags.length === 0) return []
    const want = new Set(tags)
    return this.list().filter(t => {
      const have = t.tags
      if (!have || have.length === 0) return false
      for (const tag of have) if (want.has(tag)) return true
      return false
    })
  }
}
