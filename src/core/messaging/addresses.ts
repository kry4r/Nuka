export type ParsedAddress =
  | { kind: 'team'; team: string; agent: string }
  | { kind: 'bare'; name: string }
  | { kind: 'broadcast' }
  | { kind: 'uds'; sock: string }
  | { kind: 'bridge'; id: string }

export function parseAddress(s: string): ParsedAddress {
  if (s === '*') return { kind: 'broadcast' }
  if (s.startsWith('uds:')) return { kind: 'uds', sock: s.slice(4) }
  if (s.startsWith('bridge:')) return { kind: 'bridge', id: s.slice(7) }
  const m = s.match(/^team:([^/]+)\/(.+)$/)
  if (m) return { kind: 'team', team: m[1]!, agent: m[2]! }
  return { kind: 'bare', name: s }
}

export type ResolveCtx = { teamName?: string }

export function resolveTarget(s: string, ctx: ResolveCtx): string {
  const parsed = parseAddress(s)
  if (parsed.kind === 'team' || parsed.kind === 'uds' || parsed.kind === 'bridge') return s
  if (parsed.kind === 'broadcast') return '*'
  if (!ctx.teamName) throw new Error('teamName context required to resolve bare-name address')
  return `team:${ctx.teamName}/${parsed.name}`
}
