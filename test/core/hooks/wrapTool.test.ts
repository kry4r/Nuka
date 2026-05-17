// test/core/hooks/wrapTool.test.ts
//
// Tests for the wrapWithHooks higher-order Tool wrapper. Verifies:
//   - beforeToolCall fires before the underlying tool.run
//   - afterToolCall fires after, regardless of success or thrown error
//   - {skip: true} from a pre-hook prevents tool.run from being called
//   - a throwing pre-hook does NOT crash the call (pipeline isolates it)

import { describe, it, expect } from 'vitest'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import { wrapWithHooks } from '../../../src/core/hooks/wrapTool'
import type { Tool, ToolContext } from '../../../src/core/tools/types'

function makeTool(opts: {
  name?: string
  run: (input: unknown, ctx: ToolContext) => Promise<{ output: string; isError: boolean }>
}): Tool {
  return {
    name: opts.name ?? 'TestTool',
    description: 'test',
    parameters: { type: 'object', properties: {} },
    source: 'builtin',
    tags: [],
    needsPermission: () => 'none',
    run: opts.run,
  }
}

function makeCtx(): ToolContext {
  return {
    signal: new AbortController().signal,
    cwd: '/tmp',
  }
}

describe('wrapWithHooks', () => {
  it('fires beforeToolCall before tool.run', async () => {
    const seen: string[] = []
    const registry = createHookRegistry()
    registry.register('beforeToolCall', () => {
      seen.push('pre')
    })
    const tool = makeTool({
      run: async () => {
        seen.push('run')
        return { output: 'ok', isError: false }
      },
    })
    const wrapped = wrapWithHooks(tool, registry)
    await wrapped.run({}, makeCtx())
    expect(seen).toEqual(['pre', 'run'])
  })

  it('fires afterToolCall after a successful tool.run', async () => {
    const seen: string[] = []
    const registry = createHookRegistry()
    registry.register('afterToolCall', (ctx) => {
      seen.push('post')
      const payload = ctx.payload as { result?: { output: string }; error?: unknown }
      expect(payload.result?.output).toBe('ok')
      expect(payload.error).toBeUndefined()
    })
    const tool = makeTool({
      run: async () => {
        seen.push('run')
        return { output: 'ok', isError: false }
      },
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(seen).toEqual(['run', 'post'])
    expect(result.output).toBe('ok')
  })

  it('fires afterToolCall after a throwing tool.run, then re-throws', async () => {
    const seen: string[] = []
    const registry = createHookRegistry()
    registry.register('afterToolCall', (ctx) => {
      seen.push('post')
      const payload = ctx.payload as { result?: unknown; error?: unknown }
      expect(payload.result).toBeUndefined()
      expect((payload.error as Error).message).toBe('boom')
    })
    const tool = makeTool({
      run: async () => {
        seen.push('run')
        throw new Error('boom')
      },
    })
    const wrapped = wrapWithHooks(tool, registry)
    await expect(wrapped.run({}, makeCtx())).rejects.toThrow('boom')
    expect(seen).toEqual(['run', 'post'])
  })

  it('skips tool.run when a pre-hook returns {skip: true}', async () => {
    const seen: string[] = []
    const registry = createHookRegistry()
    registry.register('beforeToolCall', () => ({ skip: true, reason: 'vetoed' }))
    const tool = makeTool({
      run: async () => {
        seen.push('run-should-not-fire')
        return { output: 'should-not-see', isError: false }
      },
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(seen).toEqual([])
    expect(result.isError).toBe(false)
    expect(result.output).toContain('Skipped by hook')
    expect(result.output).toContain('vetoed')
  })

  it('a throwing pre-hook does NOT crash tool execution (error isolated)', async () => {
    const seen: string[] = []
    const registry = createHookRegistry()
    registry.register('beforeToolCall', () => {
      seen.push('pre-throws')
      throw new Error('hook-boom')
    })
    const tool = makeTool({
      run: async () => {
        seen.push('run')
        return { output: 'ok', isError: false }
      },
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(seen).toEqual(['pre-throws', 'run'])
    expect(result.output).toBe('ok')
  })

  it('a throwing post-hook does NOT crash the surfaced result', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', () => {
      throw new Error('post-boom')
    })
    const tool = makeTool({
      run: async () => ({ output: 'ok', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe('ok')
  })

  it('passes the tool name through hook context', async () => {
    const registry = createHookRegistry()
    let seenName: string | undefined
    registry.register('beforeToolCall', (ctx) => {
      seenName = ctx.toolName
    })
    const tool = makeTool({
      name: 'NamedTool',
      run: async () => ({ output: 'ok', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    await wrapped.run({}, makeCtx())
    expect(seenName).toBe('NamedTool')
  })

  it('preserves Tool metadata (name, description, needsPermission)', () => {
    const registry = createHookRegistry()
    const tool = makeTool({
      name: 'Original',
      run: async () => ({ output: '', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    expect(wrapped.name).toBe('Original')
    expect(wrapped.description).toBe('test')
    expect(wrapped.needsPermission({})).toBe('none')
  })
})
