// test/core/skill/activation.test.ts
import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { activeToolsFor } from '../../../src/core/skill/activation'
import type { Tool } from '../../../src/core/tools/types'
import type { Skill } from '../../../src/core/skill/types'

function fake(name: string, tags: string[], opts: Partial<Tool> = {}): Tool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    source: 'builtin',
    tags,
    needsPermission: () => 'none',
    run: async () => ({ output: '', isError: false }),
    ...opts,
  }
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'skill',
    when: 'on-session-start',
    body: '',
    source: 'global',
    path: '/x.md',
    ...overrides,
  }
}

describe('activeToolsFor', () => {
  it('returns full registry when skill is undefined', () => {
    const r = new ToolRegistry()
    r.register(fake('A', ['core']))
    r.register(fake('B', ['fs.read']))
    r.register(fake('C', []))
    const out = activeToolsFor(undefined, r).map((t) => t.name).sort()
    expect(out).toEqual(['A', 'B', 'C'])
  })

  it('returns only core when skill has no requires', () => {
    const r = new ToolRegistry()
    r.register(fake('A', ['core']))
    r.register(fake('B', ['fs.read']))
    r.register(fake('C', []))
    const out = activeToolsFor(makeSkill(), r).map((t) => t.name).sort()
    expect(out).toEqual(['A'])
  })

  it('returns only core when skill.requires is empty array', () => {
    const r = new ToolRegistry()
    r.register(fake('A', ['core']))
    r.register(fake('B', ['fs.read']))
    const out = activeToolsFor(makeSkill({ requires: [] }), r).map((t) => t.name)
    expect(out).toEqual(['A'])
  })

  it('treats alwaysLoad tools as core even without core tag', () => {
    const r = new ToolRegistry()
    r.register(fake('Forced', [], { alwaysLoad: true }))
    r.register(fake('Tagged', ['core']))
    r.register(fake('Tail', ['fs.read']))
    const out = activeToolsFor(makeSkill(), r).map((t) => t.name).sort()
    expect(out).toEqual(['Forced', 'Tagged'])
  })

  it('adds tools from queryByTags(requires) on top of core (additive)', () => {
    const r = new ToolRegistry()
    r.register(fake('Core1', ['core']))
    r.register(fake('Reader', ['fs.read']))
    r.register(fake('Writer', ['fs.write']))
    r.register(fake('Net', ['net.read']))
    const out = activeToolsFor(
      makeSkill({ requires: ['fs.read', 'fs.write'] }),
      r,
    ).map((t) => t.name).sort()
    expect(out).toEqual(['Core1', 'Reader', 'Writer'])
  })

  it('deduplicates by name when a tool is both core and required', () => {
    const r = new ToolRegistry()
    // tool has both 'core' and 'fs.read' — would be picked up by both branches
    r.register(fake('Both', ['core', 'fs.read']))
    r.register(fake('OnlyRead', ['fs.read']))
    const out = activeToolsFor(makeSkill({ requires: ['fs.read'] }), r)
    const names = out.map((t) => t.name)
    expect(names).toEqual(['Both', 'OnlyRead'])
    expect(new Set(names).size).toBe(names.length)
  })

  it('preserves core ordering before extras in result', () => {
    const r = new ToolRegistry()
    r.register(fake('Core1', ['core']))
    r.register(fake('Reader', ['fs.read']))
    r.register(fake('Core2', ['core']))
    const out = activeToolsFor(makeSkill({ requires: ['fs.read'] }), r).map((t) => t.name)
    expect(out).toEqual(['Core1', 'Core2', 'Reader'])
  })
})
