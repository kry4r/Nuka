// test/core/hooks/hookListTool.test.ts
//
// HookListTool — Tool-surface tests over a fresh HookRegistry per case.
// Mirrors recentFilesTool's testing convention: build a Tool, invoke
// `run`, parse the trailing JSON line for the structured payload,
// assert on shape + content.
//
// Each `it` constructs a new HookRegistry + makeHookListTool pair so
// state doesn't leak across cases and parallel runners stay safe.

import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../../src/core/tools/types'
import { HookRegistry } from '../../../src/core/hooks/registry'
import {
  HOOK_LIST_TOOL_NAME,
  makeHookListTool,
  type HookListClearResult,
  type HookListCountResult,
  type HookListInput,
  type HookListListResult,
} from '../../../src/core/hooks/hookListTool'

function mkCtx(signal?: AbortSignal): ToolContext {
  return {
    signal: signal ?? new AbortController().signal,
    cwd: process.cwd(),
  }
}

function parsePayload<T>(output: string | unknown): T {
  if (typeof output !== 'string') {
    throw new Error(`expected string output, got ${typeof output}`)
  }
  const lines = output.split('\n')
  const json = lines[lines.length - 1]
  if (typeof json !== 'string' || json.length === 0) {
    throw new Error(`no trailing JSON line in output:\n${output}`)
  }
  return JSON.parse(json) as T
}

function freshTool(): {
  registry: HookRegistry
  tool: ReturnType<typeof makeHookListTool>
} {
  const registry = new HookRegistry()
  const tool = makeHookListTool(registry)
  return { registry, tool }
}

describe('HookListTool — metadata', () => {
  it('exposes the documented name and tool-shape', () => {
    const { tool } = freshTool()
    expect(tool.name).toBe(HOOK_LIST_TOOL_NAME)
    expect(tool.source).toBe('builtin')
    expect(tool.tags).toContain('core')
    expect(tool.needsPermission({ action: 'list' })).toBe('none')
    // clearByEvent mutates; declared coarsely as non-readonly.
    expect(tool.annotations?.readOnly).toBe(false)
  })

  it('declares the three documented actions in the schema enum', () => {
    const { tool } = freshTool()
    const params = tool.parameters as {
      properties: { action: { enum?: unknown } }
    }
    expect(params.properties.action.enum).toEqual([
      'list',
      'count',
      'clearByEvent',
    ])
  })

  it('does NOT expose `register` on the input schema', () => {
    // Security sanity: ensure no path through the schema lets the
    // agent install handlers. The only way to register is via the
    // host-owned HookRegistry directly.
    const { tool } = freshTool()
    const params = tool.parameters as {
      properties: Record<string, unknown>
    }
    expect(Object.keys(params.properties)).not.toContain('register')
    expect(Object.keys(params.properties)).not.toContain('handler')
  })
})

describe("HookListTool — action='list'", () => {
  it('returns empty hooks/total=0 when the registry is fresh', async () => {
    const { tool } = freshTool()
    const r = await tool.run({ action: 'list' }, mkCtx())
    expect(r.isError).toBe(false)
    const payload = parsePayload<HookListListResult>(r.output)
    expect(payload.action).toBe('list')
    expect(payload.hooks).toEqual([])
    expect(payload.total).toBe(0)
  })

  it('returns ids/events/priorities for registered handlers', async () => {
    const { registry, tool } = freshTool()
    registry.register('promptSubmit', () => undefined, {
      id: 'a',
      priority: 0,
    })
    registry.register('beforeToolCall', () => undefined, {
      id: 'b',
      priority: 7,
    })

    const r = await tool.run({ action: 'list' }, mkCtx())
    const payload = parsePayload<HookListListResult>(r.output)
    expect(payload.total).toBe(2)
    expect(payload.hooks).toContainEqual({
      id: 'a',
      event: 'promptSubmit',
      priority: 0,
    })
    expect(payload.hooks).toContainEqual({
      id: 'b',
      event: 'beforeToolCall',
      priority: 7,
    })
  })

  it('does not include the handler function in output (security)', async () => {
    const { registry, tool } = freshTool()
    const secret = function leakySource() {
      return { skip: true, reason: 'do-not-leak' }
    }
    registry.register('promptSubmit', secret, { id: 'h' })

    const r = await tool.run({ action: 'list' }, mkCtx())
    if (typeof r.output !== 'string') {
      throw new Error('expected string output')
    }
    // Belt-and-braces: stringify in case anything snuck in via a
    // nested field; the function name + body must not appear.
    expect(r.output).not.toContain('leakySource')
    expect(r.output).not.toContain('do-not-leak')
    const payload = parsePayload<HookListListResult>(r.output)
    for (const h of payload.hooks) {
      // Type level enforces this, but assert at runtime too.
      expect(h).not.toHaveProperty('handler')
    }
  })

  it("filters by event when 'event' is provided", async () => {
    const { registry, tool } = freshTool()
    registry.register('promptSubmit', () => undefined, { id: 'p1' })
    registry.register('promptSubmit', () => undefined, { id: 'p2' })
    registry.register('beforeToolCall', () => undefined, { id: 'b1' })

    const r = await tool.run(
      { action: 'list', event: 'promptSubmit' },
      mkCtx(),
    )
    const payload = parsePayload<HookListListResult>(r.output)
    expect(payload.total).toBe(2)
    expect(payload.hooks.map(h => h.id).sort()).toEqual(['p1', 'p2'])
    expect(payload.hooks.every(h => h.event === 'promptSubmit')).toBe(true)
  })

  it("treats event='all' the same as omitting event", async () => {
    const { registry, tool } = freshTool()
    registry.register('promptSubmit', () => undefined, { id: 'p' })
    registry.register('beforeToolCall', () => undefined, { id: 'b' })

    const r = await tool.run({ action: 'list', event: 'all' }, mkCtx())
    const payload = parsePayload<HookListListResult>(r.output)
    expect(payload.total).toBe(2)
  })
})

describe("HookListTool — action='count'", () => {
  it('reports total handler count matching list.length', async () => {
    const { registry, tool } = freshTool()
    registry.register('promptSubmit', () => undefined, { id: 'a' })
    registry.register('afterTurn', () => undefined, { id: 'b' })
    registry.register('afterTurn', () => undefined, { id: 'c' })

    const listR = await tool.run({ action: 'list' }, mkCtx())
    const listPayload = parsePayload<HookListListResult>(listR.output)
    const countR = await tool.run({ action: 'count' }, mkCtx())
    const countPayload = parsePayload<HookListCountResult>(countR.output)

    expect(countPayload.action).toBe('count')
    expect(countPayload.count).toBe(listPayload.total)
    expect(countPayload.count).toBe(3)
    // No event='all' → byEvent omitted.
    expect(countPayload.byEvent).toBeUndefined()
  })

  it('returns 0 for an empty registry', async () => {
    const { tool } = freshTool()
    const r = await tool.run({ action: 'count' }, mkCtx())
    const payload = parsePayload<HookListCountResult>(r.output)
    expect(payload.count).toBe(0)
  })

  it("returns a byEvent breakdown when event='all'", async () => {
    const { registry, tool } = freshTool()
    registry.register('promptSubmit', () => undefined, { id: 'p1' })
    registry.register('promptSubmit', () => undefined, { id: 'p2' })
    registry.register('beforeToolCall', () => undefined, { id: 'b1' })

    const r = await tool.run({ action: 'count', event: 'all' }, mkCtx())
    const payload = parsePayload<HookListCountResult>(r.output)
    expect(payload.count).toBe(3)
    expect(payload.byEvent).toBeDefined()
    expect(payload.byEvent?.['promptSubmit']).toBe(2)
    expect(payload.byEvent?.['beforeToolCall']).toBe(1)
    // Events with zero handlers should not appear in the map.
    expect(payload.byEvent?.['afterTurn']).toBeUndefined()
  })

  it('filters count by event when a concrete event is given', async () => {
    const { registry, tool } = freshTool()
    registry.register('promptSubmit', () => undefined, { id: 'p' })
    registry.register('beforeToolCall', () => undefined, { id: 'b1' })
    registry.register('beforeToolCall', () => undefined, { id: 'b2' })

    const r = await tool.run(
      { action: 'count', event: 'beforeToolCall' },
      mkCtx(),
    )
    const payload = parsePayload<HookListCountResult>(r.output)
    expect(payload.count).toBe(2)
    expect(payload.byEvent).toBeUndefined()
  })
})

describe("HookListTool — action='clearByEvent'", () => {
  it('removes only the handlers for the specified event', async () => {
    const { registry, tool } = freshTool()
    registry.register('promptSubmit', () => undefined, { id: 'p1' })
    registry.register('promptSubmit', () => undefined, { id: 'p2' })
    registry.register('beforeToolCall', () => undefined, { id: 'b1' })

    const r = await tool.run(
      { action: 'clearByEvent', event: 'promptSubmit' },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const payload = parsePayload<HookListClearResult>(r.output)
    expect(payload.action).toBe('clearByEvent')
    expect(payload.ok).toBe(true)
    expect(payload.cleared).toBe(2)
    expect(payload.event).toBe('promptSubmit')

    // Cross-check: promptSubmit gone, beforeToolCall untouched.
    expect(registry.list('promptSubmit')).toHaveLength(0)
    expect(registry.list('beforeToolCall')).toHaveLength(1)
  })

  it('reports cleared=0 if the event had no handlers (idempotent)', async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 'clearByEvent', event: 'afterTurn' },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const payload = parsePayload<HookListClearResult>(r.output)
    expect(payload.cleared).toBe(0)
    expect(payload.event).toBe('afterTurn')
  })

  it("errors when 'event' is missing", async () => {
    const { registry, tool } = freshTool()
    registry.register('promptSubmit', () => undefined, { id: 'p' })

    const r = await tool.run(
      { action: 'clearByEvent' } as HookListInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    // Registry untouched.
    expect(registry.list('promptSubmit')).toHaveLength(1)
  })

  it("errors when event='all' (refuse to nuke everything)", async () => {
    const { registry, tool } = freshTool()
    registry.register('promptSubmit', () => undefined, { id: 'p' })
    registry.register('beforeToolCall', () => undefined, { id: 'b' })

    const r = await tool.run(
      { action: 'clearByEvent', event: 'all' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    // Registry untouched.
    expect(registry.list()).toHaveLength(2)
  })
})

describe('HookListTool — validation', () => {
  it("errors on an unknown action", async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 'nuke' as unknown as HookListInput['action'] },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    if (typeof r.output === 'string') {
      expect(r.output).toMatch(/action/i)
    }
  })

  it('errors on an unknown event value', async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      {
        action: 'list',
        event: 'not-a-real-event' as unknown as HookListInput['event'],
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
  })

  it('errors when input is not an object', async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      null as unknown as HookListInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
  })
})
