// test/core/permission/checker.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { PermissionPayload } from '../../../src/core/permission/bridge'

describe('PermissionChecker', () => {
  it('auto-allows hint=none without prompting', async () => {
    const ask = vi.fn()
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    const d = await checker.check({ toolName: 'Read', hint: 'none', input: {} })
    expect(d.allowed).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('auto-allows when cache covers the call', async () => {
    const cache = new PermissionCache()
    cache.add({ scope: 'session', hint: 'write' })
    const ask = vi.fn()
    const checker = new PermissionChecker(() => cache, ask)
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
    const checker = new PermissionChecker(() => cache, ask)
    const d = await checker.check({ toolName: 'Write', hint: 'write', input: { path: 'a' } })
    expect(d.allowed).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    expect(cache.list()).toHaveLength(1)
  })

  it('propagates rejection', async () => {
    const ask = vi.fn().mockResolvedValue({ allowed: false, reason: 'no' })
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    const d = await checker.check({ toolName: 'Bash', hint: 'exec', input: { command: 'x' } })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('no')
  })

  it('populates read-only badge when call has readOnly annotation', async () => {
    let captured: PermissionPayload | undefined
    const ask = vi.fn(async (payload: PermissionPayload) => {
      captured = payload
      return { allowed: true }
    })
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    await checker.check({
      toolName: 'ReadFile',
      hint: 'write',
      input: {},
      annotations: { readOnly: true },
    })
    expect(captured?.annotationBadges).toContain('read-only')
  })

  it('populates destructive badge when call has destructive annotation', async () => {
    let captured: PermissionPayload | undefined
    const ask = vi.fn(async (payload: PermissionPayload) => {
      captured = payload
      return { allowed: true }
    })
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    await checker.check({
      toolName: 'Delete',
      hint: 'write',
      input: {},
      annotations: { destructive: true },
    })
    expect(captured?.annotationBadges).toContain('destructive')
  })

  it('populates network badge when call has openWorld annotation', async () => {
    let captured: PermissionPayload | undefined
    const ask = vi.fn(async (payload: PermissionPayload) => {
      captured = payload
      return { allowed: true }
    })
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    await checker.check({
      toolName: 'Fetch',
      hint: 'network',
      input: {},
      annotations: { openWorld: true },
    })
    expect(captured?.annotationBadges).toContain('network')
  })

  it('no badges when call has no annotations', async () => {
    let captured: PermissionPayload | undefined
    const ask = vi.fn(async (payload: PermissionPayload) => {
      captured = payload
      return { allowed: true }
    })
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    await checker.check({ toolName: 'Bash', hint: 'exec', input: {} })
    expect(captured?.annotationBadges).toBeUndefined()
  })
})
