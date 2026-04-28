// test/core/tools/queryByTags.test.ts
import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { Tool } from '../../../src/core/tools/types'

function fake(name: string, tags: string[]): Tool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    source: 'builtin',
    tags,
    needsPermission: () => 'none',
    run: async () => ({ output: '', isError: false }),
  }
}

describe('ToolRegistry.queryByTags', () => {
  it('returns tools whose tags intersect the input', () => {
    const r = new ToolRegistry()
    r.register(fake('A', ['core', 'fs.read']))
    r.register(fake('B', ['fs.write']))
    r.register(fake('C', ['shell', 'exec']))

    const out = r.queryByTags(['fs.read'])
    expect(out.map((t) => t.name)).toEqual(['A'])
  })

  it('returns empty array when no input tags given', () => {
    const r = new ToolRegistry()
    r.register(fake('A', ['core']))
    expect(r.queryByTags([])).toEqual([])
  })

  it('exact string match — no globbing', () => {
    const r = new ToolRegistry()
    r.register(fake('A', ['fs.read']))
    expect(r.queryByTags(['fs.*'])).toEqual([])
    expect(r.queryByTags(['fs'])).toEqual([])
  })

  it('matches multi-tag tools when any tag intersects', () => {
    const r = new ToolRegistry()
    const t = fake('Multi', ['core', 'shell', 'exec'])
    r.register(t)
    expect(r.queryByTags(['shell']).map((x) => x.name)).toEqual(['Multi'])
    expect(r.queryByTags(['exec']).map((x) => x.name)).toEqual(['Multi'])
    expect(r.queryByTags(['nope', 'core']).map((x) => x.name)).toEqual(['Multi'])
  })

  it('skips tools with empty tags array', () => {
    const r = new ToolRegistry()
    r.register(fake('NoTag', []))
    r.register(fake('Tagged', ['core']))
    expect(r.queryByTags(['core']).map((x) => x.name)).toEqual(['Tagged'])
  })

  it('returns multiple tools in registration order', () => {
    const r = new ToolRegistry()
    r.register(fake('A', ['x']))
    r.register(fake('B', ['x', 'y']))
    r.register(fake('C', ['y']))
    const out = r.queryByTags(['x', 'y']).map((t) => t.name)
    expect(out).toEqual(['A', 'B', 'C'])
  })
})
