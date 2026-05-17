// test/core/hooks/configLoader.test.ts
//
// Tests for the in-process hook config loader. Uses real temp-dir fixtures
// + dynamic import so we exercise the same `import(fileUrl)` path the
// loader uses at runtime — mocking import() would defeat the point.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import {
  applyHookConfig,
  defaultHookConfigPaths,
  loadHookConfigFile,
} from '../../../src/core/hooks/configLoader'
import { HookRegistry } from '../../../src/core/hooks/registry'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(os.tmpdir(), 'nuka-hooks-config-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

// Each test fixture writes a uniquely-named .mjs so Node's ESM loader cache
// (which keys on URL) doesn't bleed across tests if vitest re-runs them in
// the same worker process. Helper centralises the convention.
let fixtureCounter = 0
async function writeFixture(content: string): Promise<string> {
  fixtureCounter++
  const filename = `hooks.config.${Date.now()}.${fixtureCounter}.mjs`
  const filepath = join(dir, filename)
  await writeFile(filepath, content, 'utf8')
  return filepath
}

describe('loadHookConfigFile', () => {
  it('returns [] for missing file', async () => {
    const result = await loadHookConfigFile(join(dir, 'does-not-exist.mjs'))
    expect(result).toEqual([])
  })

  it('loads entries from a default export array', async () => {
    const filepath = await writeFixture(`
      export default [
        { event: 'promptSubmit', handler: () => undefined, id: 'a', priority: 5 },
        { event: 'afterTurn', handler: () => undefined },
      ]
    `)
    const result = await loadHookConfigFile(filepath)
    expect(result).toHaveLength(2)
    expect(result[0]!.event).toBe('promptSubmit')
    expect(result[0]!.id).toBe('a')
    expect(result[0]!.priority).toBe(5)
    expect(typeof result[0]!.handler).toBe('function')
    expect(result[1]!.event).toBe('afterTurn')
  })

  it("loads entries from a named 'hooks' export when no default", async () => {
    const filepath = await writeFixture(`
      export const hooks = [
        { event: 'sessionStart', handler: () => undefined },
      ]
    `)
    const result = await loadHookConfigFile(filepath)
    expect(result).toHaveLength(1)
    expect(result[0]!.event).toBe('sessionStart')
  })

  it('prefers default over named hooks when both exist', async () => {
    const filepath = await writeFixture(`
      export default [{ event: 'promptSubmit', handler: () => undefined, id: 'from-default' }]
      export const hooks = [{ event: 'afterTurn', handler: () => undefined, id: 'from-named' }]
    `)
    const result = await loadHookConfigFile(filepath)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('from-default')
  })

  it('throws on entry missing event', async () => {
    const filepath = await writeFixture(`
      export default [{ handler: () => undefined }]
    `)
    await expect(loadHookConfigFile(filepath)).rejects.toThrow(/missing or empty 'event'/)
  })

  it('throws on entry with non-function handler', async () => {
    const filepath = await writeFixture(`
      export default [{ event: 'promptSubmit', handler: 'not-a-fn' }]
    `)
    await expect(loadHookConfigFile(filepath)).rejects.toThrow(/'handler' must be a function/)
  })

  it('throws on entry that is not an object', async () => {
    const filepath = await writeFixture(`
      export default ['not-an-object']
    `)
    await expect(loadHookConfigFile(filepath)).rejects.toThrow(/Invalid hook entry/)
  })

  it('throws when export is not an array', async () => {
    const filepath = await writeFixture(`
      export default { event: 'promptSubmit', handler: () => undefined }
    `)
    await expect(loadHookConfigFile(filepath)).rejects.toThrow(/expected an array export/)
  })

  it('returns [] when module has neither default nor hooks export', async () => {
    const filepath = await writeFixture(`
      export const other = 'something'
    `)
    const result = await loadHookConfigFile(filepath)
    expect(result).toEqual([])
  })
})

describe('applyHookConfig', () => {
  it('registers all entries in the registry', async () => {
    const filepath = await writeFixture(`
      export default [
        { event: 'promptSubmit', handler: () => undefined, id: 'one' },
        { event: 'afterTurn', handler: () => undefined, id: 'two', priority: 10 },
        { event: 'sessionStart', handler: () => undefined },
      ]
    `)
    const registry = new HookRegistry()
    const result = await applyHookConfig(registry, filepath)
    expect(result.registered).toBe(3)
    expect(result.errors).toEqual([])
    expect(registry.list()).toHaveLength(3)
    expect(registry.list('afterTurn')[0]!.priority).toBe(10)
    expect(registry.list('promptSubmit')[0]!.id).toBe('one')
  })

  it('returns { registered: 0, errors: [] } for missing file (graceful)', async () => {
    const registry = new HookRegistry()
    const result = await applyHookConfig(registry, join(dir, 'absent.mjs'))
    expect(result.registered).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('captures a load-time error in errors[] without throwing', async () => {
    const filepath = await writeFixture(`
      export default [{ event: 'promptSubmit', handler: 'not-a-fn' }]
    `)
    const registry = new HookRegistry()
    const result = await applyHookConfig(registry, filepath)
    expect(result.registered).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.message).toMatch(/'handler' must be a function/)
    expect(registry.list()).toHaveLength(0)
  })

  it('captures a registry-rejection per-entry without losing siblings', async () => {
    // All entries pass loader validation; we manually inject a registry
    // failure for one of them by stubbing register() to throw on a specific id.
    const filepath = await writeFixture(`
      export default [
        { event: 'promptSubmit', handler: () => undefined, id: 'good-1' },
        { event: 'promptSubmit', handler: () => undefined, id: 'will-fail' },
        { event: 'afterTurn', handler: () => undefined, id: 'good-2' },
      ]
    `)
    const registry = new HookRegistry()
    const originalRegister = registry.register.bind(registry)
    registry.register = ((event, handler, opts) => {
      if (opts?.id === 'will-fail') throw new Error('synthetic register failure')
      return originalRegister(event, handler, opts)
    }) as typeof registry.register

    const result = await applyHookConfig(registry, filepath)
    expect(result.registered).toBe(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.message).toMatch(/synthetic register failure/)
    expect(registry.list()).toHaveLength(2)
  })

  it('passes id and priority options through to registry.register', async () => {
    const filepath = await writeFixture(`
      export default [
        { event: 'promptSubmit', handler: () => undefined, id: 'custom-id', priority: 42 },
      ]
    `)
    const registry = new HookRegistry()
    const result = await applyHookConfig(registry, filepath)
    expect(result.registered).toBe(1)
    const registered = registry.list('promptSubmit')[0]!
    expect(registered.id).toBe('custom-id')
    expect(registered.priority).toBe(42)
  })

  it('actually invokes the loaded handler', async () => {
    // Module emits a marker through globalThis so the test can observe it
    // without round-tripping through any other channel.
    const marker = `__hook_marker_${Date.now()}_${Math.random()}`
    ;(globalThis as Record<string, unknown>)[marker] = 0
    const filepath = await writeFixture(`
      export default [
        { event: 'promptSubmit', handler: () => { globalThis[${JSON.stringify(marker)}] = (globalThis[${JSON.stringify(marker)}] ?? 0) + 1 } },
      ]
    `)
    const registry = new HookRegistry()
    await applyHookConfig(registry, filepath)
    await registry.invoke('promptSubmit', { payload: {} })
    expect((globalThis as Record<string, unknown>)[marker]).toBe(1)
    delete (globalThis as Record<string, unknown>)[marker]
  })
})

describe('defaultHookConfigPaths', () => {
  it('returns the four default search locations when home is set', () => {
    const paths = defaultHookConfigPaths('/some/cwd', '/some/home')
    expect(paths).toEqual([
      '/some/cwd/.nuka/hooks.config.js',
      '/some/cwd/.nuka/hooks.config.mjs',
      '/some/home/.nuka/hooks.config.js',
      '/some/home/.nuka/hooks.config.mjs',
    ])
  })

  it('omits home paths when home is empty', () => {
    const paths = defaultHookConfigPaths('/cwd', '')
    expect(paths).toEqual([
      '/cwd/.nuka/hooks.config.js',
      '/cwd/.nuka/hooks.config.mjs',
    ])
  })

  it('uses process.cwd() and HOME by default', () => {
    const paths = defaultHookConfigPaths()
    // We don't assert exact values (env-dependent) but the cwd entries must
    // both be present and point under the same directory.
    expect(paths.length).toBeGreaterThanOrEqual(2)
    expect(paths[0]!.endsWith('/.nuka/hooks.config.js')).toBe(true)
    expect(paths[1]!.endsWith('/.nuka/hooks.config.mjs')).toBe(true)
  })
})
