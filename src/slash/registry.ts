import type { SlashCommand } from './types'

export class SlashRegistry {
  private byName = new Map<string, SlashCommand>()

  register(cmd: SlashCommand): void {
    if (this.byName.has(cmd.name)) throw new Error(`duplicate slash: ${cmd.name}`)
    this.byName.set(cmd.name, cmd)
  }

  find(input: string): SlashCommand | undefined {
    const name = input.startsWith('/') ? input.slice(1) : input
    return this.byName.get(name)
  }

  list(): SlashCommand[] {
    return [...this.byName.values()]
  }

  suggest(prefix: string): SlashCommand[] {
    const p = prefix.startsWith('/') ? prefix.slice(1) : prefix
    return this.list().filter(c => c.name.startsWith(p))
  }

  static parse(text: string): { name: string; args: string } | null {
    if (!text.startsWith('/')) return null
    const m = text.slice(1).match(/^(\S+)\s*(.*)$/)
    if (!m) return null
    return { name: m[1]!, args: m[2]!.trim() }
  }
}
