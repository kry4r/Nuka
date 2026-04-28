// test/core/tools/define.test.ts
import { describe, it, expect } from 'vitest'
import { defineTool } from '../../../src/core/tools/define'
import type { ToolContext } from '../../../src/core/tools/types'

const ctx: ToolContext = { signal: new AbortController().signal, cwd: process.cwd() }

describe('defineTool', () => {
  it('produces a Tool with the supplied fields', () => {
    const t = defineTool({
      name: 'X',
      description: 'desc',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core', 'fs.read'],
      needsPermission: () => 'none',
      run: async () => ({ output: 'ok', isError: false }),
    })
    expect(t.name).toBe('X')
    expect(t.tags).toEqual(['core', 'fs.read'])
    expect(t.runtime).toEqual({ kind: 'in-process' })
    expect(t.source).toBe('builtin')
  })

  it('defaults tags to [] when omitted', () => {
    const t = defineTool({
      name: 'Y',
      description: 'desc',
      parameters: {},
      source: 'builtin',
      needsPermission: () => 'none',
      run: async () => ({ output: 'y', isError: false }),
    })
    expect(t.tags).toEqual([])
  })

  it('passes run through unchanged for in-process tools', async () => {
    const original = async () => ({ output: 'passed-through', isError: false }) as const
    const t = defineTool({
      name: 'PassThrough',
      description: 'd',
      parameters: {},
      source: 'builtin',
      needsPermission: () => 'none',
      run: original,
    })
    expect(t.run).toBe(original)
    const r = await t.run({}, ctx)
    expect(r.output).toBe('passed-through')
  })

  it('synthesises a working run for spawn-runtime tools (echo)', async () => {
    const t = defineTool<{ msg: string }>({
      name: 'EchoTool',
      description: 'echo via spawn',
      parameters: {
        type: 'object',
        required: ['msg'],
        properties: { msg: { type: 'string' } },
      },
      source: 'builtin',
      tags: ['core', 'shell'],
      needsPermission: () => 'exec',
      runtime: {
        kind: 'spawn',
        command: 'echo',
        args: (input) => [(input as { msg: string }).msg],
      },
    })
    const r = await t.run({ msg: 'hello-world' }, ctx)
    expect(r.isError).toBe(false)
    expect(String(r.output)).toContain('hello-world')
  })

  it('throws when neither run nor spawn runtime is provided', () => {
    expect(() =>
      defineTool({
        name: 'Bad',
        description: 'd',
        parameters: {},
        source: 'builtin',
        needsPermission: () => 'none',
        // no run, no runtime
      } as unknown as Parameters<typeof defineTool>[0]),
    ).toThrow(/no run\(\)/)
  })
})
