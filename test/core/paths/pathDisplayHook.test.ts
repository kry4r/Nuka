// test/core/paths/pathDisplayHook.test.ts
//
// Tests for `createPathDisplayHandler` — the afterToolCall hook that
// rewrites absolute paths in string ToolResult output to human-readable
// forms (cwd-relative or `~/`-prefixed) via `displayPath`.
//
// Three test surfaces:
//   1. Direct handler invocation — pass a fake `HookContext`, assert the
//      returned `HookResult.data.replaceResult`. Independent of the
//      registry and wrapper.
//   2. Edge cases (JSON-embedded paths, errors, ContentBlock[] output,
//      etc.) — exercised through the same direct path.
//   3. End-to-end via `wrapWithHooks` + real `HookRegistry` — confirm
//      the replaceResult contract is honoured when the hook is wired
//      into a tool.

import { describe, it, expect } from 'vitest'
import {
  createPathDisplayHandler,
  DEFAULT_PATH_DISPLAY_HOOK_MIN_LENGTH,
} from '../../../src/core/paths/pathDisplayHook'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import { wrapWithHooks } from '../../../src/core/hooks/wrapTool'
import type { HookContext, HookResult } from '../../../src/core/hooks/events'
import type { Tool, ToolContext, ToolResult } from '../../../src/core/tools/types'

// Use explicit cwd/home so tests are deterministic across hosts.
const CWD = '/Users/alice/projects/nuka'
const HOME = '/Users/alice'

function makeAfterCtx(
  result: ToolResult | undefined,
  toolName = 'TestTool',
  runError?: unknown,
): HookContext {
  return {
    event: 'afterToolCall',
    toolName,
    payload: { input: {}, result, error: runError },
  }
}

async function call(
  handler: ReturnType<typeof createPathDisplayHandler>,
  ctx: HookContext,
): Promise<HookResult> {
  const ret = await handler(ctx)
  return ret ?? {}
}

function makeTool(opts: {
  name?: string
  run: (input: unknown, ctx: ToolContext) => Promise<ToolResult>
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
  return { signal: new AbortController().signal, cwd: '/tmp' }
}

describe('createPathDisplayHandler — direct invocation', () => {
  it('rewrites cwd-relative paths to ./relative form', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = {
      output: `read file ${CWD}/src/cli.tsx successfully`,
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    const replace = ret.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    const out = replace!.output as string
    expect(out).toContain('src/cli.tsx')
    expect(out).not.toContain(`${CWD}/src/cli.tsx`)
  })

  it('rewrites home-relative absolute paths with ~/ prefix', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    // A path inside HOME but outside CWD → tildified, not relativised
    // (CWD-relative would need `..` segments and maxRelativeUp defaults to 0).
    const result: ToolResult = {
      output: `loaded config from ${HOME}/.nukarc today`,
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    const replace = ret.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    const out = replace!.output as string
    expect(out).toContain('~/.nukarc')
    expect(out).not.toContain(HOME + '/.nukarc')
  })

  it('leaves non-path strings untouched (returns {})', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = {
      output: 'just some plain text without any paths in it',
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    expect(ret.data).toBeUndefined()
  })

  it('does NOT double-rewrite already-humanised paths (~/foo)', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = {
      output: 'already tildified: ~/projects/nuka/src/cli.tsx',
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    // `~/projects/...` should be left alone — the only candidate, no change.
    expect(ret.data).toBeUndefined()
  })

  it('respects the toolNames allow-list (rewrites listed tool)', async () => {
    const handler = createPathDisplayHandler({
      cwd: CWD,
      home: HOME,
      toolNames: ['Bash'],
    })
    const result: ToolResult = {
      output: `ran ${CWD}/src/foo.ts`,
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result, 'Bash'))
    expect(ret.data?.replaceResult).toBeDefined()
  })

  it('respects the toolNames allow-list (skips non-listed tool)', async () => {
    const handler = createPathDisplayHandler({
      cwd: CWD,
      home: HOME,
      toolNames: ['Bash'],
    })
    const result: ToolResult = {
      output: `ran ${CWD}/src/foo.ts`,
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result, 'Read'))
    expect(ret.data).toBeUndefined()
  })

  it('returns {} when result has no output (empty string)', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = { output: '', isError: false }
    const ret = await call(handler, makeAfterCtx(result))
    expect(ret.data).toBeUndefined()
  })

  it('returns {} when result is undefined (tool threw)', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const ret = await call(handler, makeAfterCtx(undefined, 'TestTool', new Error('boom')))
    expect(ret.data).toBeUndefined()
  })

  it('returns {} when result is an error', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = {
      output: `error reading ${CWD}/missing.ts: ENOENT`,
      isError: true,
    }
    const ret = await call(handler, makeAfterCtx(result))
    // Error outputs pass through verbatim so debug paths survive.
    expect(ret.data).toBeUndefined()
  })

  it('handles multi-line text with multiple paths', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = {
      output: [
        `entry: ${CWD}/src/cli.tsx`,
        `config: ${HOME}/.nukarc`,
        'plain line with no path',
        `another: ${CWD}/test/foo.test.ts`,
      ].join('\n'),
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    const out = (ret.data?.replaceResult as ToolResult).output as string
    expect(out).toContain('src/cli.tsx')
    expect(out).toContain('~/.nukarc')
    expect(out).toContain('test/foo.test.ts')
    expect(out).toContain('plain line with no path')
    expect(out).not.toContain(`${CWD}/src/cli.tsx`)
    expect(out).not.toContain(`${CWD}/test/foo.test.ts`)
  })

  it('leaves paths inside JSON string literals alone', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    // A line that looks like compact JSON, with the path inside a quoted
    // value. Rewriting it could shorten the string and break downstream
    // JSON parsers, so the heuristic skips this case.
    const result: ToolResult = {
      output: `{"file":"${CWD}/src/cli.tsx","mode":"r"}`,
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    expect(ret.data).toBeUndefined()
  })

  it('ignores ContentBlock[] outputs (only rewrites string)', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = {
      output: [{ type: 'text', text: `${CWD}/src/cli.tsx` }],
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    expect(ret.data).toBeUndefined()
  })

  it('respects minPathLength: short paths below threshold pass through', async () => {
    const handler = createPathDisplayHandler({
      cwd: CWD,
      home: HOME,
      minPathLength: 50,
    })
    const result: ToolResult = {
      // Path length well below 50 chars after the cwd is computed away.
      output: `read ${CWD}/a.ts`,
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    // The CWD-relative form would be `a.ts`; the original substring length
    // (about 33 chars) is below the configured 50-char threshold, so no
    // rewrite — `{}` returned.
    expect(ret.data).toBeUndefined()
  })

  it('strips a trailing punctuation char (period) cleanly', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = {
      output: `wrote to ${CWD}/src/cli.tsx.`,
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    const out = (ret.data?.replaceResult as ToolResult).output as string
    // Period preserved at end of sentence, path itself rewritten.
    expect(out).toMatch(/src\/cli\.tsx\.$/)
    expect(out).not.toContain(`${CWD}/src/cli.tsx`)
  })

  it('exposes the default minPathLength constant', () => {
    expect(DEFAULT_PATH_DISPLAY_HOOK_MIN_LENGTH).toBeGreaterThan(0)
    expect(DEFAULT_PATH_DISPLAY_HOOK_MIN_LENGTH).toBeLessThan(50)
  })

  it('handles missing payload gracefully (returns {})', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const ret = await call(handler, {
      event: 'afterToolCall',
      toolName: 'TestTool',
      // no payload
    } as HookContext)
    expect(ret.data).toBeUndefined()
  })

  it('does not churn when displayPath returns the same string', async () => {
    // Path is outside cwd AND outside home → displayPath returns the
    // absolute string verbatim (after tildify falls through). The hook
    // should return `{}` since no net change occurred.
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = {
      output: 'system log: /var/log/system.log emitted',
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    expect(ret.data).toBeUndefined()
  })

  it('records original/rewritten lengths in pathDisplay metadata', async () => {
    const handler = createPathDisplayHandler({ cwd: CWD, home: HOME })
    const result: ToolResult = {
      output: `path: ${CWD}/src/cli.tsx`,
      isError: false,
    }
    const ret = await call(handler, makeAfterCtx(result))
    const meta = ret.data?.pathDisplay as
      | { originalLength: number; rewrittenLength: number }
      | undefined
    expect(meta).toBeDefined()
    expect(meta!.originalLength).toBe(result.output.toString().length)
    expect(meta!.rewrittenLength).toBeLessThan(meta!.originalLength)
  })
})

describe('createPathDisplayHandler — end-to-end via wrapWithHooks', () => {
  it('replaces tool output through the full registry → wrapper path', async () => {
    const registry = createHookRegistry()
    registry.register(
      'afterToolCall',
      createPathDisplayHandler({ cwd: CWD, home: HOME }),
      { id: 'pd-test' },
    )
    const tool = makeTool({
      name: 'TestTool',
      run: async () => ({
        output: `loaded ${CWD}/src/cli.tsx`,
        isError: false,
      }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(typeof result.output).toBe('string')
    expect(result.output as string).toContain('src/cli.tsx')
    expect(result.output as string).not.toContain(`${CWD}/src/cli.tsx`)
  })

  it('passes through unchanged when tool output has no paths', async () => {
    const registry = createHookRegistry()
    registry.register(
      'afterToolCall',
      createPathDisplayHandler({ cwd: CWD, home: HOME }),
      { id: 'pd-test' },
    )
    const tool = makeTool({
      name: 'TestTool',
      run: async () => ({ output: 'no paths here at all', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe('no paths here at all')
  })

  it('coexists with another afterToolCall hook (last-write-wins)', async () => {
    // Register the path-display hook plus a sibling that uppercases the
    // original output. The wrapper applies replacements in registration
    // order; later replacements supersede earlier ones (last-write-wins).
    // Both hooks read `payload.result` (the original tool output), so the
    // uppercase hook produces its output from the un-rewritten string
    // and that becomes the final result.
    const registry = createHookRegistry()
    registry.register(
      'afterToolCall',
      createPathDisplayHandler({ cwd: CWD, home: HOME }),
      { id: 'pd-test' },
    )
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload
        if (!payload) return {}
        const r = payload.result
        if (
          typeof r === 'object' && r !== null &&
          typeof (r as { output: unknown }).output === 'string'
        ) {
          const cast = r as ToolResult
          return {
            data: {
              replaceResult: {
                output: (cast.output as string).toUpperCase(),
                isError: cast.isError,
              },
            },
          }
        }
        return {}
      },
      { id: 'uppercase' },
    )
    const tool = makeTool({
      name: 'TestTool',
      run: async () => ({
        output: `loaded ${CWD}/src/cli.tsx`,
        isError: false,
      }),
    })
    // Iter WWW pipeline-default flip — this test asserts the legacy
    // last-write-wins shape (no chaining; each hook reads
    // `payload.result` directly). Now that the wrapper default is
    // `'pipeline'`, the legacy behaviour has to be opted into
    // explicitly.
    const wrapped = wrapWithHooks(tool, registry, {
      pipelineMode: 'last-write-wins',
    })
    const result = await wrapped.run({}, makeCtx())
    // Both hooks ran; the LAST one wins. The path-display hook's rewrite
    // was overwritten by the uppercase hook (which read the original
    // payload.result). This confirms the path-display hook does not
    // throw, does not block sibling hooks, and participates in the
    // last-write-wins protocol.
    expect(result.output).toBe(`LOADED ${CWD.toUpperCase()}/SRC/CLI.TSX`)
  })
})
