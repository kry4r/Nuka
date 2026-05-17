// test/core/plugins/pluginHooks.test.ts
//
// Iter KKKK — plugin manifest in-process hook exposure.
//
// Verifies that a plugin manifest declaring `inProcessHooks: <relpath>` has
// its handlers registered against the shared HookRegistry with namespaced
// IDs (`plugin:<plugin-name>:<entry-id>`), survives per-plugin error
// isolation, and remains backward-compatible (plugins without the field
// are no-ops).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { wirePlugin } from '../../../src/core/plugin/wire'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { SlashRegistry } from '../../../src/slash/registry'
import { HookRegistry } from '../../../src/core/hooks/registry'
import type { LoadedPlugin } from '../../../src/core/plugin/manifest'
import type { Skill } from '../../../src/core/skill/types'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(os.tmpdir(), 'nuka-plugin-hooks-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// Unique filenames so Node's ESM cache (URL-keyed) does not bleed across
// tests when vitest runs in the same worker process.
let fixtureCounter = 0
async function writeHookModule(content: string): Promise<string> {
  fixtureCounter++
  const name = `hooks.${Date.now()}.${fixtureCounter}.mjs`
  await writeFile(join(root, name), content, 'utf8')
  return name
}

function makePlugin(name: string, inProcessHooks: string | undefined, dir = root): LoadedPlugin {
  const manifest: LoadedPlugin['manifest'] = {
    name,
    tools: [],
    slashCommands: [],
    skills: [],
  }
  if (inProcessHooks !== undefined) manifest.inProcessHooks = inProcessHooks
  return { manifest, rootDir: dir, source: 'installed' as const }
}

function emptyDeps(hookRegistry?: HookRegistry) {
  const tools = new ToolRegistry()
  const slash = new SlashRegistry()
  const skills: Skill[] = []
  return { tools, slash, skills, ...(hookRegistry ? { hookRegistry } : {}) }
}

describe('wirePlugin — in-process hooks', () => {
  it('registers each manifest hook entry on the registry with namespaced IDs', async () => {
    const fname = await writeHookModule(`
      export default [
        { event: 'promptSubmit', handler: () => undefined, id: 'log-prompt', priority: 5 },
        { event: 'afterTurn', handler: () => undefined, id: 'log-turn' },
      ]
    `)
    const hooks = new HookRegistry()
    const result = await wirePlugin(makePlugin('alpha', fname), emptyDeps(hooks))

    expect(result.inProcessHooksAdded).toBe(2)
    expect(result.errors).toEqual([])
    const ids = hooks.list().map(h => h.id).sort()
    expect(ids).toEqual(['plugin:alpha:log-prompt', 'plugin:alpha:log-turn'])
  })

  it('plugin without inProcessHooks field is a no-op (backward compat)', async () => {
    const hooks = new HookRegistry()
    const result = await wirePlugin(makePlugin('alpha', undefined), emptyDeps(hooks))

    expect(result.inProcessHooksAdded).toBe(0)
    expect(result.errors).toEqual([])
    expect(hooks.list()).toHaveLength(0)
  })

  it('two plugins each registering hooks: both register independently', async () => {
    const fa = await writeHookModule(`
      export default [{ event: 'sessionStart', handler: () => undefined, id: 'a' }]
    `)
    const fb = await writeHookModule(`
      export default [{ event: 'sessionStart', handler: () => undefined, id: 'b' }]
    `)
    const hooks = new HookRegistry()

    const ra = await wirePlugin(makePlugin('alpha', fa), emptyDeps(hooks))
    const rb = await wirePlugin(makePlugin('beta', fb), emptyDeps(hooks))

    expect(ra.inProcessHooksAdded).toBe(1)
    expect(rb.inProcessHooksAdded).toBe(1)
    const ids = hooks.list().map(h => h.id).sort()
    expect(ids).toEqual(['plugin:alpha:a', 'plugin:beta:b'])
  })

  it('handler error from one plugin does not break other plugins hooks', async () => {
    // Plugin A's handler throws; plugin B's handler returns normally.
    const fa = await writeHookModule(`
      export default [{ event: 'afterTurn', handler: () => { throw new Error('boom') }, id: 'a' }]
    `)
    const fb = await writeHookModule(`
      let calls = 0
      globalThis.__pluginBetaCalls = () => calls
      export default [{ event: 'afterTurn', handler: () => { calls++ }, id: 'b' }]
    `)
    const hooks = new HookRegistry()
    await wirePlugin(makePlugin('alpha', fa), emptyDeps(hooks))
    await wirePlugin(makePlugin('beta', fb), emptyDeps(hooks))

    const results = await hooks.invoke('afterTurn', { payload: {} })
    const outcomes = results.map(r => r.outcome).sort()
    expect(outcomes).toEqual(['error', 'success'])
    // Plugin B's handler ran despite plugin A's throw.
    const calls = (globalThis as unknown as { __pluginBetaCalls: () => number }).__pluginBetaCalls()
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('plugin hook fires when corresponding event fires on registry', async () => {
    const fname = await writeHookModule(`
      let lastEvent
      globalThis.__pluginGammaLast = () => lastEvent
      export default [{ event: 'promptSubmit', handler: (ctx) => { lastEvent = ctx.event }, id: 'capture' }]
    `)
    const hooks = new HookRegistry()
    await wirePlugin(makePlugin('gamma', fname), emptyDeps(hooks))

    await hooks.invoke('promptSubmit', { payload: { prompt: 'hello' } })
    const captured = (globalThis as unknown as { __pluginGammaLast: () => string }).__pluginGammaLast()
    expect(captured).toBe('promptSubmit')
  })

  it('handler IDs are prefixed with `plugin:<plugin-name>:`', async () => {
    const fname = await writeHookModule(`
      export default [{ event: 'sessionEnd', handler: () => undefined, id: 'cleanup' }]
    `)
    const hooks = new HookRegistry()
    await wirePlugin(makePlugin('delta', fname), emptyDeps(hooks))

    const entry = hooks.list()[0]
    expect(entry).toBeDefined()
    expect(entry!.id).toBe('plugin:delta:cleanup')
  })

  it('entries without an explicit `id`: auto-generate ID with plugin prefix', async () => {
    const fname = await writeHookModule(`
      export default [
        { event: 'afterTurn', handler: () => undefined },
        { event: 'afterTurn', handler: () => undefined },
      ]
    `)
    const hooks = new HookRegistry()
    const result = await wirePlugin(makePlugin('epsilon', fname), emptyDeps(hooks))

    expect(result.inProcessHooksAdded).toBe(2)
    const ids = hooks.list().map(h => h.id).sort()
    expect(ids).toEqual(['plugin:epsilon:auto-1', 'plugin:epsilon:auto-2'])
  })

  it('missing inProcessHooks file: no-op, no errors (graceful)', async () => {
    const hooks = new HookRegistry()
    const result = await wirePlugin(makePlugin('zeta', 'does-not-exist.mjs'), emptyDeps(hooks))

    expect(result.inProcessHooksAdded).toBe(0)
    expect(result.errors).toEqual([])
    expect(hooks.list()).toHaveLength(0)
  })

  it('invalid hook module (bad event): collects error, other entries skipped', async () => {
    const fname = await writeHookModule(`
      export default [{ event: '', handler: () => undefined }]
    `)
    const hooks = new HookRegistry()
    const result = await wirePlugin(makePlugin('eta', fname), emptyDeps(hooks))

    expect(result.inProcessHooksAdded).toBe(0)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toMatch(/inProcessHooks/)
  })

  it('inProcessHooks declared but no hookRegistry dep: silently skipped', async () => {
    // wirePlugin without hookRegistry: backward-compat for old callers.
    const fname = await writeHookModule(`
      export default [{ event: 'afterTurn', handler: () => undefined, id: 'a' }]
    `)
    const result = await wirePlugin(makePlugin('theta', fname), emptyDeps())

    expect(result.inProcessHooksAdded).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('priority is propagated to the registry record', async () => {
    const fname = await writeHookModule(`
      export default [
        { event: 'afterTurn', handler: () => undefined, id: 'high', priority: 100 },
        { event: 'afterTurn', handler: () => undefined, id: 'low', priority: -5 },
      ]
    `)
    const hooks = new HookRegistry()
    await wirePlugin(makePlugin('iota', fname), emptyDeps(hooks))

    const byId = new Map(hooks.list().map(h => [h.id, h]))
    expect(byId.get('plugin:iota:high')?.priority).toBe(100)
    expect(byId.get('plugin:iota:low')?.priority).toBe(-5)
  })

  it('empty hook module array: no error, no registrations', async () => {
    const fname = await writeHookModule(`export default []`)
    const hooks = new HookRegistry()
    const result = await wirePlugin(makePlugin('kappa', fname), emptyDeps(hooks))

    expect(result.inProcessHooksAdded).toBe(0)
    expect(result.errors).toEqual([])
    expect(hooks.list()).toHaveLength(0)
  })

  it('two plugins, same entry-id: namespacing keeps them distinct', async () => {
    // Both plugins use entry id 'log' — without prefix this would collide.
    const fa = await writeHookModule(`
      export default [{ event: 'afterTurn', handler: () => undefined, id: 'log' }]
    `)
    const fb = await writeHookModule(`
      export default [{ event: 'afterTurn', handler: () => undefined, id: 'log' }]
    `)
    const hooks = new HookRegistry()
    await wirePlugin(makePlugin('lambda', fa), emptyDeps(hooks))
    await wirePlugin(makePlugin('mu', fb), emptyDeps(hooks))

    const ids = hooks.list().map(h => h.id).sort()
    expect(ids).toEqual(['plugin:lambda:log', 'plugin:mu:log'])
  })

  it('multiple invocations across multiple plugin handlers run all of them', async () => {
    const fa = await writeHookModule(`
      let n = 0
      globalThis.__pluginNuCalls = () => n
      export default [{ event: 'sessionStart', handler: () => { n++ }, id: 'a' }]
    `)
    const fb = await writeHookModule(`
      let n = 0
      globalThis.__pluginXiCalls = () => n
      export default [{ event: 'sessionStart', handler: () => { n++ }, id: 'b' }]
    `)
    const hooks = new HookRegistry()
    await wirePlugin(makePlugin('nu', fa), emptyDeps(hooks))
    await wirePlugin(makePlugin('xi', fb), emptyDeps(hooks))

    await hooks.invoke('sessionStart', { payload: {} })
    const nu = (globalThis as unknown as { __pluginNuCalls: () => number }).__pluginNuCalls()
    const xi = (globalThis as unknown as { __pluginXiCalls: () => number }).__pluginXiCalls()
    expect(nu).toBe(1)
    expect(xi).toBe(1)
  })
})
