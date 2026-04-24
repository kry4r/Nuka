// src/core/agents/registry.ts
import type { ResolvedAgentDef } from './types'

/**
 * Registry of resolved specialist agents. Agents are stored by their
 * fully-qualified name (`<pluginName>:<name>`). The qualified name is
 * also copied onto the stored def's `name` for easy rendering.
 */
export class AgentRegistry {
  private byName = new Map<string, ResolvedAgentDef>()

  register(def: ResolvedAgentDef): void {
    const qualified = `${def.pluginName}:${def.name.includes(':') ? def.name.split(':').slice(-1)[0]! : def.name}`
    if (this.byName.has(qualified)) {
      console.warn(`[AgentRegistry] duplicate agent name skipped: ${qualified}`)
      return
    }
    this.byName.set(qualified, { ...def, name: qualified })
  }

  find(name: string): ResolvedAgentDef | undefined {
    return this.byName.get(name)
  }

  list(): ResolvedAgentDef[] {
    return [...this.byName.values()]
  }
}
