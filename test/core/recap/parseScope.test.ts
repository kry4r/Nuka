import { describe, it, expect } from 'vitest'
import { parseScope } from '../../../src/core/recap/parseScope'

describe('parseScope', () => {
  it('default → full', () => { expect(parseScope('')).toEqual({ kind: 'full' }) })
  it('--since 1h', () => { expect(parseScope('--since 1h')).toEqual({ kind: 'since', ms: 3600_000 }) })
  it('--since 30m', () => { expect(parseScope('--since 30m')).toEqual({ kind: 'since', ms: 1800_000 }) })
  it('--since 90s', () => { expect(parseScope('--since 90s')).toEqual({ kind: 'since', ms: 90_000 }) })
  it('--agent alice', () => { expect(parseScope('--agent alice')).toEqual({ kind: 'agent', name: 'alice' }) })
  it('--pipeline pipe-1', () => { expect(parseScope('--pipeline pipe-1')).toEqual({ kind: 'pipeline', id: 'pipe-1' }) })
  it('rejects bad duration', () => { expect(() => parseScope('--since 100')).toThrow() })
})
