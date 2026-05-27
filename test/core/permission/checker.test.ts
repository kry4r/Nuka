// test/core/permission/checker.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PermissionChecker, PLAN_BLOCKED_REASON } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { PermissionPayload } from '../../../src/core/permission/bridge'
import { resolvePermissionProfile } from '../../../src/core/permission/profiles'

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

  // ── Phase 8 §4.4 — plan mode gate ──────────────────────────────────
  describe('plan mode', () => {
    it('rejects Write with the canonical plan-mode reason', async () => {
      const ask = vi.fn()
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      const d = await checker.check({
        toolName: 'Write',
        hint: 'write',
        input: { path: 'a' },
        mode: 'plan',
      })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe(PLAN_BLOCKED_REASON)
      expect(ask).not.toHaveBeenCalled()
    })

    it('rejects Edit in plan mode', async () => {
      const checker = new PermissionChecker(() => new PermissionCache(), vi.fn())
      const d = await checker.check({ toolName: 'Edit', hint: 'write', input: {}, mode: 'plan' })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe(PLAN_BLOCKED_REASON)
    })

    it('rejects Bash in plan mode', async () => {
      const checker = new PermissionChecker(() => new PermissionCache(), vi.fn())
      const d = await checker.check({ toolName: 'Bash', hint: 'exec', input: {}, mode: 'plan' })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe(PLAN_BLOCKED_REASON)
    })

    it('rejects any tool annotated destructive in plan mode', async () => {
      const checker = new PermissionChecker(() => new PermissionCache(), vi.fn())
      const d = await checker.check({
        toolName: 'mcp__fs__delete',
        hint: 'write',
        input: {},
        annotations: { destructive: true },
        mode: 'plan',
      })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe(PLAN_BLOCKED_REASON)
    })

    it('rejects any tool annotated openWorld in plan mode', async () => {
      const checker = new PermissionChecker(() => new PermissionCache(), vi.fn())
      const d = await checker.check({
        toolName: 'mcp__http__fetch',
        hint: 'network',
        input: {},
        annotations: { openWorld: true },
        mode: 'plan',
      })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe(PLAN_BLOCKED_REASON)
    })

    it('passes read-only tools in plan mode without prompting', async () => {
      const ask = vi.fn()
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      const d = await checker.check({
        toolName: 'Read',
        hint: 'none',
        input: { path: 'a' },
        annotations: { readOnly: true },
        mode: 'plan',
      })
      expect(d.allowed).toBe(true)
      expect(ask).not.toHaveBeenCalled()
    })

    it('cannot be bypassed by a cached "allow write" rule', async () => {
      const cache = new PermissionCache()
      cache.add({ scope: 'session', hint: 'write' })
      const ask = vi.fn()
      const checker = new PermissionChecker(() => cache, ask)
      const d = await checker.check({
        toolName: 'Write',
        hint: 'write',
        input: { path: 'a' },
        mode: 'plan',
      })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe(PLAN_BLOCKED_REASON)
      expect(ask).not.toHaveBeenCalled()
    })

    it('normal mode still allows Write via prompt path', async () => {
      const ask = vi.fn().mockResolvedValue({ allowed: true })
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      const d = await checker.check({
        toolName: 'Write',
        hint: 'write',
        input: { path: 'a' },
        mode: 'normal',
      })
      expect(d.allowed).toBe(true)
      expect(ask).toHaveBeenCalledOnce()
    })
  })

  // ── Iter LLLL — `'ask'` hint (confirmation-only gate) ────────────────
  describe("'ask' hint", () => {
    it('routes to askUser regardless of session.mode (normal)', async () => {
      const ask = vi.fn().mockResolvedValue({ allowed: true })
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      const d = await checker.check({
        toolName: 'EnterPlanMode',
        hint: 'ask',
        input: {},
        mode: 'normal',
      })
      expect(d.allowed).toBe(true)
      expect(ask).toHaveBeenCalledOnce()
    })

    it('routes to askUser when mode is undefined (default path)', async () => {
      const ask = vi.fn().mockResolvedValue({ allowed: true })
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      const d = await checker.check({
        toolName: 'EnterPlanMode',
        hint: 'ask',
        input: {},
      })
      expect(d.allowed).toBe(true)
      expect(ask).toHaveBeenCalledOnce()
    })

    it('is NOT blocked by plan-mode (plan-mode is about side effects, not consent)', async () => {
      const ask = vi.fn().mockResolvedValue({ allowed: true })
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      const d = await checker.check({
        toolName: 'EnterPlanMode',
        hint: 'ask',
        input: {},
        mode: 'plan',
      })
      expect(d.allowed).toBe(true)
      expect(d.reason).toBeUndefined()
      // The user is still prompted in plan mode — the confirmation gate
      // is orthogonal to the plan-mode block list.
      expect(ask).toHaveBeenCalledOnce()
    })

    it('IS blocked by plan-mode when annotated destructive (annotation wins)', async () => {
      const ask = vi.fn()
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      const d = await checker.check({
        toolName: 'mcp__danger__confirm',
        hint: 'ask',
        input: {},
        annotations: { destructive: true },
        mode: 'plan',
      })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe(PLAN_BLOCKED_REASON)
      expect(ask).not.toHaveBeenCalled()
    })

    it('auto-allows in bypass mode without prompting', async () => {
      const ask = vi.fn()
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      const d = await checker.check({
        toolName: 'EnterPlanMode',
        hint: 'ask',
        input: {},
        mode: 'bypass',
      })
      expect(d.allowed).toBe(true)
      expect(ask).not.toHaveBeenCalled()
    })

    it('propagates rejection just like other hints', async () => {
      const ask = vi
        .fn()
        .mockResolvedValue({ allowed: false, reason: 'user said no' })
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      const d = await checker.check({
        toolName: 'EnterPlanMode',
        hint: 'ask',
        input: {},
      })
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe('user said no')
    })

    it('a remembered "always for ask" session rule short-circuits the prompt', async () => {
      const cache = new PermissionCache()
      cache.add({ scope: 'session', hint: 'ask' })
      const ask = vi.fn()
      const checker = new PermissionChecker(() => cache, ask)
      const d = await checker.check({
        toolName: 'EnterPlanMode',
        hint: 'ask',
        input: {},
      })
      expect(d.allowed).toBe(true)
      expect(ask).not.toHaveBeenCalled()
    })

    it('stores the remember rule when askUser includes one', async () => {
      const cache = new PermissionCache()
      const ask = vi.fn().mockResolvedValue({
        allowed: true,
        remember: { scope: 'session' as const, hint: 'ask' as const },
      })
      const checker = new PermissionChecker(() => cache, ask)
      await checker.check({
        toolName: 'EnterPlanMode',
        hint: 'ask',
        input: {},
      })
      expect(cache.list()).toHaveLength(1)
      expect(cache.list()[0]).toEqual({ scope: 'session', hint: 'ask' })
    })
  })

  // ── P1 #8 — variant hint for the planMode dialog UX ──────────────────
  describe('variant derivation', () => {
    it('marks EnterPlanMode + ask as variant=planMode', async () => {
      let captured: PermissionPayload | undefined
      const ask = vi.fn(async (payload: PermissionPayload) => {
        captured = payload
        return { allowed: true }
      })
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      await checker.check({
        toolName: 'EnterPlanMode',
        hint: 'ask',
        input: {},
      })
      expect(captured?.variant).toBe('planMode')
    })

    it('omits variant for generic ask-hint tools', async () => {
      let captured: PermissionPayload | undefined
      const ask = vi.fn(async (payload: PermissionPayload) => {
        captured = payload
        return { allowed: true }
      })
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      await checker.check({
        toolName: 'SomeOtherConfirmTool',
        hint: 'ask',
        input: {},
      })
      expect(captured?.variant).toBeUndefined()
    })

    it('omits variant for ordinary write-hint tools', async () => {
      let captured: PermissionPayload | undefined
      const ask = vi.fn(async (payload: PermissionPayload) => {
        captured = payload
        return { allowed: true }
      })
      const checker = new PermissionChecker(() => new PermissionCache(), ask)
      await checker.check({
        toolName: 'Write',
        hint: 'write',
        input: { path: 'a' },
      })
      expect(captured?.variant).toBeUndefined()
    })

    it('does not invoke askUser (and therefore no variant) when cached', async () => {
      const cache = new PermissionCache()
      cache.add({ scope: 'session', hint: 'ask' })
      const ask = vi.fn()
      const checker = new PermissionChecker(() => cache, ask)
      const d = await checker.check({
        toolName: 'EnterPlanMode',
        hint: 'ask',
        input: {},
      })
      expect(d.allowed).toBe(true)
      expect(ask).not.toHaveBeenCalled()
    })
  })

  describe('permission profiles', () => {
    it('rejects profile-denied calls before cache or UI prompt', async () => {
      const cache = new PermissionCache()
      cache.add({ scope: 'session', hint: 'exec' })
      const ask = vi.fn().mockResolvedValue({ allowed: true })
      const profile = resolvePermissionProfile({
        active: 'audit',
        profiles: {
          audit: {
            description: 'No process execution.',
            rules: { exec: 'deny' },
          },
        },
      })
      const checker = new PermissionChecker(() => cache, ask, () => profile)

      const d = await checker.check({
        toolName: 'Bash',
        hint: 'exec',
        input: { command: 'npm test' },
      })

      expect(d.allowed).toBe(false)
      expect(d.reason).toMatch(/permission profile "audit" denies exec/)
      expect(ask).not.toHaveBeenCalled()
    })

    it('auto-allows profile-allowed calls without prompting', async () => {
      const ask = vi.fn()
      const profile = resolvePermissionProfile({
        active: ':danger-full-access',
      })
      const checker = new PermissionChecker(() => new PermissionCache(), ask, () => profile)

      const d = await checker.check({
        toolName: 'Write',
        hint: 'write',
        input: { path: 'src/app.ts' },
      })

      expect(d.allowed).toBe(true)
      expect(ask).not.toHaveBeenCalled()
    })

    it('profile ask policy keeps the existing prompt path', async () => {
      const ask = vi.fn().mockResolvedValue({ allowed: true })
      const profile = resolvePermissionProfile({
        active: ':workspace',
      })
      const checker = new PermissionChecker(() => new PermissionCache(), ask, () => profile)

      const d = await checker.check({
        toolName: 'Write',
        hint: 'write',
        input: { path: 'src/app.ts' },
      })

      expect(d.allowed).toBe(true)
      expect(ask).toHaveBeenCalledOnce()
    })
  })
})
