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

  findAvailable(
    name: string,
    availableMcpServers: readonly string[],
  ): ResolvedAgentDef | undefined {
    const def = this.find(name)
    if (!def || !isAgentAvailable(def, availableMcpServers)) return undefined
    return def
  }

  listAvailable(availableMcpServers: readonly string[]): ResolvedAgentDef[] {
    return this.list().filter(def => isAgentAvailable(def, availableMcpServers))
  }
}

export function isAgentAvailable(
  def: Pick<ResolvedAgentDef, 'requiredMcpServers'>,
  availableMcpServers: readonly string[],
): boolean {
  const required = def.requiredMcpServers
  if (!required || required.length === 0) return true
  const available = availableMcpServers.map(name => name.toLowerCase())
  return required.every(pattern => {
    const lowered = pattern.toLowerCase()
    return available.some(name => name.includes(lowered))
  })
}

export function inferAvailableMcpServersFromToolNames(
  toolNames: readonly string[],
): string[] {
  const servers = new Set<string>()
  for (const name of toolNames) {
    if (!name.startsWith('mcp__')) continue
    const rest = name.slice('mcp__'.length)
    const delimiter = rest.indexOf('__')
    if (delimiter <= 0) continue
    const server = rest.slice(0, delimiter).trim()
    if (server) servers.add(server)
  }
  return [...servers]
}
