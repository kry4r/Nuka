import picomatch from 'picomatch'
import type { PermissionCall, PermissionRule } from './types'

function subjectFor(call: PermissionCall): string | undefined {
  if (call.hint === 'write') return (call.input as any)?.path
  if (call.hint === 'exec') return (call.input as any)?.command
  return undefined
}

export class PermissionCache {
  private rules: PermissionRule[] = []

  add(rule: PermissionRule): void {
    if (rule.scope === 'once') return
    this.rules.push(rule)
  }

  isAllowed(call: PermissionCall): boolean {
    for (const r of this.rules) {
      if (r.hint !== call.hint) continue
      if (r.scope === 'session') return true
      if (r.scope === 'pattern' && r.pattern) {
        const subj = subjectFor(call)
        if (!subj) continue
        if (picomatch(r.pattern)(subj)) return true
      }
    }
    return false
  }

  list(): PermissionRule[] {
    return [...this.rules]
  }
}
