import { describe, it, expect } from 'vitest'
import { resolveDepClosure } from '../../../src/core/plugin/deps'
import type { PluginManifest } from '../../../src/core/plugin/manifest'

function makeManifest(name: string, deps: string[] = []): PluginManifest {
  return {
    name,
    tools: [],
    slashCommands: [],
    skills: [],
    mcpServers: {},
    dependencies: deps.map(d => ({ name: d })),
  }
}

describe('resolveDepClosure', () => {
  it('A → B → C yields order: ["C", "B", "A"]', async () => {
    const A = makeManifest('a', ['b'])
    const B = makeManifest('b', ['c'])
    const C = makeManifest('c')

    const registry: Record<string, PluginManifest> = { b: B, c: C }
    const resolve = async (name: string) => registry[name] ?? null

    const closure = await resolveDepClosure(A, resolve)

    expect(closure.order).toEqual(['c', 'b', 'a'])
    expect(closure.cycles).toHaveLength(0)
    expect(closure.missing).toHaveLength(0)
  })

  it('A → B → A yields one cycle containing both nodes', async () => {
    const A = makeManifest('a', ['b'])
    const B = makeManifest('b', ['a'])

    const registry: Record<string, PluginManifest> = { b: B }
    const resolve = async (name: string) => registry[name] ?? null

    const closure = await resolveDepClosure(A, resolve)

    expect(closure.cycles).toHaveLength(1)
    const cycle = closure.cycles[0]!
    expect(cycle).toContain('a')
    expect(cycle).toContain('b')
    expect(closure.missing).toHaveLength(0)
  })

  it('A → missing-X yields missing entry declaredBy A, order includes A', async () => {
    const A = makeManifest('a', ['missing-x'])
    const resolve = async (_name: string) => null

    const closure = await resolveDepClosure(A, resolve)

    expect(closure.missing).toHaveLength(1)
    expect(closure.missing[0]!.name).toBe('missing-x')
    expect(closure.missing[0]!.declaredBy).toContain('a')
    expect(closure.order).toContain('a')
  })

  it('diamond dependency: A → B, A → C, B → D, C → D yields D before B and C', async () => {
    const A = makeManifest('a', ['b', 'c'])
    const B = makeManifest('b', ['d'])
    const C = makeManifest('c', ['d'])
    const D = makeManifest('d')

    const registry: Record<string, PluginManifest> = { b: B, c: C, d: D }
    const resolve = async (name: string) => registry[name] ?? null

    const closure = await resolveDepClosure(A, resolve)

    expect(closure.cycles).toHaveLength(0)
    expect(closure.missing).toHaveLength(0)
    expect(closure.order).toContain('d')
    expect(closure.order).toContain('b')
    expect(closure.order).toContain('c')
    expect(closure.order).toContain('a')
    // D must come before both B and C
    const dIdx = closure.order.indexOf('d')
    const bIdx = closure.order.indexOf('b')
    const cIdx = closure.order.indexOf('c')
    const aIdx = closure.order.indexOf('a')
    expect(dIdx).toBeLessThan(bIdx)
    expect(dIdx).toBeLessThan(cIdx)
    expect(bIdx).toBeLessThan(aIdx)
    expect(cIdx).toBeLessThan(aIdx)
  })

  it('no deps: root only, order: [root]', async () => {
    const A = makeManifest('a')
    const closure = await resolveDepClosure(A, async () => null)

    expect(closure.order).toEqual(['a'])
    expect(closure.cycles).toHaveLength(0)
    expect(closure.missing).toHaveLength(0)
  })

  it('shared missing dep: two parents, declaredBy lists both', async () => {
    const A = makeManifest('a', ['b', 'c'])
    const B = makeManifest('b', ['missing-x'])
    const C = makeManifest('c', ['missing-x'])

    const registry: Record<string, PluginManifest> = { b: B, c: C }
    const resolve = async (name: string) => registry[name] ?? null

    const closure = await resolveDepClosure(A, resolve)

    expect(closure.missing).toHaveLength(1)
    const m = closure.missing[0]!
    expect(m.name).toBe('missing-x')
    expect(m.declaredBy).toContain('b')
    expect(m.declaredBy).toContain('c')
  })
})
