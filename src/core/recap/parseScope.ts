// src/core/recap/parseScope.ts — Phase 14c
import type { RecapScope } from './types'

const DURATION = /^(\d+)(s|m|h)$/

export function parseScope(args: string): RecapScope {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { kind: 'full' }
  const flag = tokens[0]
  if (flag === '--since') {
    const m = (tokens[1] ?? '').match(DURATION)
    if (!m) throw new Error(`bad duration: ${tokens[1]} (expected like 1h, 30m, 90s)`)
    const n = Number(m[1]); const u = m[2]!
    const ms = n * (u === 's' ? 1000 : u === 'm' ? 60_000 : 3_600_000)
    return { kind: 'since', ms }
  }
  if (flag === '--agent') return { kind: 'agent', name: tokens[1] ?? '' }
  if (flag === '--pipeline') return { kind: 'pipeline', id: tokens[1] ?? '' }
  throw new Error(`unknown flag: ${flag}`)
}
