// test/core/permission/checker.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'

describe('PermissionChecker', () => {
  it('auto-allows hint=none without prompting', async () => {
    const ask = vi.fn()
    const checker = new PermissionChecker(new PermissionCache(), ask)
    const d = await checker.check({ toolName: 'Read', hint: 'none', input: {} })
    expect(d.allowed).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('auto-allows when cache covers the call', async () => {
    const cache = new PermissionCache()
    cache.add({ scope: 'session', hint: 'write' })
    const ask = vi.fn()
    const checker = new PermissionChecker(cache, ask)
    const d = await checker.check({ toolName: 'Write', hint: 'write', input: { path: 'a' } })
    expect(d.allowed).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('prompts via UI callback when no rule covers the call; stores remember', async () => {
    const cache = new PermissionCache()
    const ask = vi.fn().mockResolvedValue({
      allowed: true,
      remember: { scope: 'session', hint: 'write' },
    })
    const checker = new PermissionChecker(cache, ask)
    const d = await checker.check({ toolName: 'Write', hint: 'write', input: { path: 'a' } })
    expect(d.allowed).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    expect(cache.list()).toHaveLength(1)
  })

  it('propagates rejection', async () => {
    const ask = vi.fn().mockResolvedValue({ allowed: false, reason: 'no' })
    const checker = new PermissionChecker(new PermissionCache(), ask)
    const d = await checker.check({ toolName: 'Bash', hint: 'exec', input: { command: 'x' } })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('no')
  })
})
