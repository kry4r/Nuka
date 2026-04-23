// src/core/permission/suggest.ts
import type { PermissionCall } from './types'

export function suggestPattern(call: PermissionCall): string | undefined {
  if (call.hint === 'write') {
    const path = (call.input as any)?.path
    if (typeof path === 'string') {
      const parts = path.split('/')
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}/**`
      return `${parts[0]}/**`
    }
  }
  if (call.hint === 'exec') {
    const cmd = (call.input as any)?.command
    if (typeof cmd === 'string') {
      const head = cmd.trim().split(/\s+/)[0]
      if (head) return `${head} *`
    }
  }
  return undefined
}
