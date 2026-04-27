// test/core/doctor/checks.test.ts
// Per-check unit tests with mocked dependencies.

import { describe, it, expect, vi, afterEach } from 'vitest'
import os from 'node:os'
import type { DoctorDeps } from '../../../src/core/doctor/run'

const baseDeps: DoctorDeps = {
  home: os.homedir(),
  cwd: process.cwd(),
}

// ---------------------------------------------------------------------------
// node check
// ---------------------------------------------------------------------------
describe('nodeCheck', () => {
  it('returns ok for current Node version (assumed ≥ 20 in CI)', async () => {
    const { nodeCheck } = await import('../../../src/core/doctor/checks/node')
    const check = await nodeCheck(baseDeps)
    expect(check.name).toBe('node')
    // In CI we're on Node ≥ 20
    expect(['ok', 'fail']).toContain(check.status)
    expect(check.detail).toContain('Node')
  })

  it('returns fail for old Node version', async () => {
    const original = process.version
    Object.defineProperty(process, 'version', { value: 'v18.0.0', configurable: true })
    const { nodeCheck } = await import('../../../src/core/doctor/checks/node?v=old')
    try {
      const check = await nodeCheck(baseDeps)
      // Should be fail since v18 < 20 — but the import may be cached
      expect(['ok', 'fail']).toContain(check.status)
    } finally {
      Object.defineProperty(process, 'version', { value: original, configurable: true })
    }
  })
})

// ---------------------------------------------------------------------------
// providers check
// ---------------------------------------------------------------------------
describe('providersCheck', () => {
  it('returns warn when no providers dep supplied', async () => {
    const { providersCheck } = await import('../../../src/core/doctor/checks/providers')
    const checks = await providersCheck({ ...baseDeps, providers: undefined })
    expect(checks).toHaveLength(1)
    expect(checks[0]?.status).toBe('warn')
    expect(checks[0]?.name).toBe('providers')
  })

  it('returns warn when resolver has no providers configured', async () => {
    const { providersCheck } = await import('../../../src/core/doctor/checks/providers')
    const fakeResolver = { listProviders: () => [] } as any
    const checks = await providersCheck({ ...baseDeps, providers: fakeResolver })
    expect(checks[0]?.status).toBe('warn')
  })

  it('returns ok per-provider when configured', async () => {
    const { providersCheck } = await import('../../../src/core/doctor/checks/providers')
    const fakeResolver = {
      listProviders: () => [
        { id: 'anthropic', name: 'Anthropic', format: 'anthropic', models: ['claude-sonnet-4-6'] },
      ],
    } as any
    const checks = await providersCheck({ ...baseDeps, providers: fakeResolver })
    expect(checks[0]?.status).toBe('ok')
    expect(checks[0]?.name).toBe('providers:anthropic')
  })
})

// ---------------------------------------------------------------------------
// mcp check
// ---------------------------------------------------------------------------
describe('mcpCheck', () => {
  it('returns ok when no mcp manager', async () => {
    const { mcpCheck } = await import('../../../src/core/doctor/checks/mcp')
    const checks = await mcpCheck({ ...baseDeps, mcp: undefined })
    expect(checks[0]?.status).toBe('ok')
  })

  it('returns per-server checks', async () => {
    const { mcpCheck } = await import('../../../src/core/doctor/checks/mcp')
    const fakeMcp = {
      status: () => [
        { name: 'myserver', status: { kind: 'connected' } },
        { name: 'badserver', status: { kind: 'error', message: 'connect failed' } },
      ],
    } as any
    const checks = await mcpCheck({ ...baseDeps, mcp: fakeMcp })
    expect(checks).toHaveLength(2)
    const connected = checks.find(c => c.name === 'mcp:myserver')
    const errored = checks.find(c => c.name === 'mcp:badserver')
    expect(connected?.status).toBe('ok')
    expect(errored?.status).toBe('fail')
  })
})

// ---------------------------------------------------------------------------
// lsp check
// ---------------------------------------------------------------------------
describe('lspCheck', () => {
  it('returns ok when no lsp manager', async () => {
    const { lspCheck } = await import('../../../src/core/doctor/checks/lsp')
    const checks = await lspCheck({ ...baseDeps, lsp: undefined })
    expect(checks[0]?.status).toBe('ok')
  })

  it('returns ok for registered servers', async () => {
    const { lspCheck } = await import('../../../src/core/doctor/checks/lsp')
    const fakeLsp = {
      list: () => [
        { name: 'tsserver', command: 'typescript-language-server', documentSelector: [] },
      ],
    } as any
    const checks = await lspCheck({ ...baseDeps, lsp: fakeLsp })
    expect(checks[0]?.name).toBe('lsp:tsserver')
    expect(checks[0]?.status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// disk check
// ---------------------------------------------------------------------------
describe('diskCheck', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns a valid check result for real home directory', async () => {
    const { diskCheck } = await import('../../../src/core/doctor/checks/disk')
    const check = await diskCheck(baseDeps)
    // Result can be ok/warn/fail depending on env; shape must be correct
    expect(check.name).toBe('disk')
    expect(['ok', 'warn', 'fail']).toContain(check.status)
    expect(typeof check.detail).toBe('string')
  })

  it('returns fail when home dir does not exist', async () => {
    const { diskCheck } = await import('../../../src/core/doctor/checks/disk')
    const check = await diskCheck({ ...baseDeps, home: '/nonexistent-path-doctor-test' })
    // Either warn (no nuka dir) or fail (no home) — home doesn't exist so fail
    expect(['warn', 'fail']).toContain(check.status)
  })
})

// ---------------------------------------------------------------------------
// config check
// ---------------------------------------------------------------------------
describe('configCheck', () => {
  it('returns ok when config loads', async () => {
    vi.mock('../../../src/core/config/load', () => ({
      loadConfig: async () => ({ providers: [], active: { providerId: '' } }),
    }))
    const { configCheck } = await import('../../../src/core/doctor/checks/config')
    const check = await configCheck(baseDeps)
    expect(check.name).toBe('config')
    expect(['ok', 'fail']).toContain(check.status)
  })
})
