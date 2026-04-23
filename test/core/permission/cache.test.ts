import { describe, it, expect } from 'vitest'
import { PermissionCache } from '../../../src/core/permission/cache'

describe('PermissionCache', () => {
  it('matches session-scope rules by hint', () => {
    const c = new PermissionCache()
    c.add({ scope: 'session', hint: 'write' })
    expect(c.isAllowed({ toolName: 'Write', hint: 'write', input: { path: 'a/b.ts' } })).toBe(true)
    expect(c.isAllowed({ toolName: 'Bash', hint: 'exec', input: { command: 'x' } })).toBe(false)
  })

  it('matches pattern-scope rules by glob against path (write) or command (exec)', () => {
    const c = new PermissionCache()
    c.add({ scope: 'pattern', hint: 'write', pattern: 'src/**' })
    c.add({ scope: 'pattern', hint: 'exec', pattern: 'npm *' })
    expect(c.isAllowed({ toolName: 'Write', hint: 'write', input: { path: 'src/a.ts' } })).toBe(true)
    expect(c.isAllowed({ toolName: 'Write', hint: 'write', input: { path: 'other/a.ts' } })).toBe(false)
    expect(c.isAllowed({ toolName: 'Bash', hint: 'exec', input: { command: 'npm test' } })).toBe(true)
    expect(c.isAllowed({ toolName: 'Bash', hint: 'exec', input: { command: 'rm -rf /' } })).toBe(false)
  })

  it('once-scope rules never stay in the cache (they are fulfilled inline and not added)', () => {
    const c = new PermissionCache()
    c.add({ scope: 'once', hint: 'write' })
    expect(c.isAllowed({ toolName: 'Write', hint: 'write', input: { path: 'a' } })).toBe(false)
  })
})
