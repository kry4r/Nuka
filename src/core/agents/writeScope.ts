import type { LocalAgentWriteScope } from '../tasks/types'

export type WriteScopeInput = {
  allow?: string[]
  deny?: string[]
  note?: string
}

export type NormalizedWriteScope =
  | { ok: true; value?: LocalAgentWriteScope }
  | { ok: false; error: string }

export function normalizeWriteScope(
  input: WriteScopeInput | undefined,
): NormalizedWriteScope {
  if (!input) return { ok: true }
  const allow = normalizePathList(input.allow, 'write_scope.allow')
  if (!allow.ok) return allow
  const deny = normalizePathList(input.deny, 'write_scope.deny')
  if (!deny.ok) return deny
  const note = input.note?.trim()
  const value: LocalAgentWriteScope = {
    ...(allow.value.length > 0 ? { allow: allow.value } : {}),
    ...(deny.value.length > 0 ? { deny: deny.value } : {}),
    ...(note ? { note } : {}),
  }
  return Object.keys(value).length > 0
    ? { ok: true, value }
    : { ok: true }
}

export function formatWriteScopeContext(
  scope: LocalAgentWriteScope | undefined,
): string | undefined {
  if (!scope) return undefined
  const lines = ['Write scope:']
  if (scope.allow && scope.allow.length > 0) {
    lines.push(`- Allowed paths: ${scope.allow.join(', ')}`)
  }
  if (scope.deny && scope.deny.length > 0) {
    lines.push(`- Denied paths: ${scope.deny.join(', ')}`)
  }
  if (scope.note) {
    lines.push(`- Note: ${scope.note}`)
  }
  return lines.length > 1 ? lines.join('\n') : undefined
}

type NormalizedPathList =
  | { ok: true; value: string[] }
  | { ok: false; error: string }

function normalizePathList(
  value: string[] | undefined,
  field: string,
): NormalizedPathList {
  if (!value) return { ok: true, value: [] }
  const out: string[] = []
  for (const raw of value) {
    const trimmed = raw.trim()
    if (!trimmed) {
      return { ok: false, error: `${field} contains an empty path.` }
    }
    out.push(trimmed)
  }
  return { ok: true, value: out }
}
