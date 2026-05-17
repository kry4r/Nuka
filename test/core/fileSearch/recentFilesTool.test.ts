// test/core/fileSearch/recentFilesTool.test.ts
//
// RecentFilesTool — Tool-surface tests over a fresh in-memory tracker
// per case. Mirrors fileSearchTool's testing convention: build a Tool,
// invoke its `run`, parse the trailing JSON line for the structured
// payload, assert on shape + content.
//
// We deliberately avoid sharing state across `it` blocks — each test
// constructs a new RecentFiles + makeRecentFilesTool pair so order
// doesn't matter and parallel runners stay safe.

import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../../src/core/tools/types'
import { RecentFiles } from '../../../src/core/fileSearch/recentFiles'
import {
  RECENT_FILES_DEFAULT_LIMIT,
  RECENT_FILES_HARD_LIMIT,
  RECENT_FILES_TOOL_NAME,
  makeRecentFilesTool,
  type RecentFilesClearResult,
  type RecentFilesForgetResult,
  type RecentFilesInput,
  type RecentFilesListResult,
  type RecentFilesTouchResult,
} from '../../../src/core/fileSearch/recentFilesTool'

function mkCtx(signal?: AbortSignal): ToolContext {
  return {
    signal: signal ?? new AbortController().signal,
    cwd: process.cwd(),
  }
}

/**
 * Helper: pull the trailing JSON line out of a tool's string output.
 * Mirrors the format the Tool itself emits.
 */
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

function freshTool(opts?: ConstructorParameters<typeof RecentFiles>[0]): {
  tracker: RecentFiles
  tool: ReturnType<typeof makeRecentFilesTool>
} {
  const tracker = new RecentFiles(opts)
  const tool = makeRecentFilesTool(tracker)
  return { tracker, tool }
}

describe('RecentFilesTool — metadata', () => {
  it('exposes the documented name and tool-shape', () => {
    const { tool } = freshTool()
    expect(tool.name).toBe(RECENT_FILES_TOOL_NAME)
    expect(tool.source).toBe('builtin')
    expect(tool.tags).toContain('core')
    expect(tool.needsPermission({ action: 'list' })).toBe('none')
    // Declared as not read-only (the touch/forget/clear actions mutate).
    expect(tool.annotations?.readOnly).toBe(false)
  })

  it('declares the four documented actions in the schema enum', () => {
    const { tool } = freshTool()
    const params = tool.parameters as {
      properties: { action: { enum?: unknown } }
    }
    expect(params.properties.action.enum).toEqual([
      'list',
      'touch',
      'forget',
      'clear',
    ])
  })
})

describe("RecentFilesTool — action='list'", () => {
  it('returns empty items/total=0 when the tracker is fresh', async () => {
    const { tool } = freshTool()
    const r = await tool.run({ action: 'list' }, mkCtx())
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesListResult>(r.output)
    expect(payload.action).toBe('list')
    expect(payload.items).toEqual([])
    expect(payload.total).toBe(0)
  })

  it('round-trips a touch+list — freshest first with the documented row shape', async () => {
    let clock = 1_000
    const { tracker, tool } = freshTool({ now: () => clock })
    tracker.touch('src/a.ts')
    clock += 5
    tracker.touch('src/b.ts')
    clock += 5
    tracker.touch('src/c.ts')

    const r = await tool.run({ action: 'list' }, mkCtx())
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesListResult>(r.output)
    expect(payload.total).toBe(3)
    expect(payload.items.map(it => it.path)).toEqual([
      'src/c.ts',
      'src/b.ts',
      'src/a.ts',
    ])
    // Row shape — every item exposes path/lastTouched/hitCount/boost.
    for (const item of payload.items) {
      expect(typeof item.path).toBe('string')
      expect(typeof item.lastTouched).toBe('number')
      expect(typeof item.hitCount).toBe('number')
      expect(typeof item.boost).toBe('number')
      expect(item.boost).toBeGreaterThanOrEqual(0)
      expect(item.boost).toBeLessThanOrEqual(1)
    }
    // Default limit lives in the constant — sanity check.
    expect(RECENT_FILES_DEFAULT_LIMIT).toBe(20)
  })

  it('respects maxResults — returns fewer rows than total', async () => {
    let clock = 1_000
    const { tracker, tool } = freshTool({ now: () => clock })
    for (let i = 0; i < 5; i++) {
      tracker.touch(`p${i}.ts`)
      clock += 1
    }

    const r = await tool.run(
      { action: 'list', maxResults: 2 },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesListResult>(r.output)
    expect(payload.total).toBe(5)
    expect(payload.items).toHaveLength(2)
    expect(payload.items.map(it => it.path)).toEqual(['p4.ts', 'p3.ts'])
  })

  it('clamps maxResults above the hard cap', async () => {
    let clock = 1_000
    const { tracker, tool } = freshTool({
      maxEntries: RECENT_FILES_HARD_LIMIT + 10,
      now: () => clock,
    })
    for (let i = 0; i < RECENT_FILES_HARD_LIMIT + 5; i++) {
      tracker.touch(`p${i}.ts`)
      clock += 1
    }
    // Schema would reject this in a strict validator, but the run-time
    // validator only checks `>= 1`. Pass a sane oversized value and rely
    // on `clampLimit` to floor it at HARD_LIMIT.
    const r = await tool.run(
      { action: 'list', maxResults: RECENT_FILES_HARD_LIMIT * 4 },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesListResult>(r.output)
    expect(payload.items.length).toBeLessThanOrEqual(RECENT_FILES_HARD_LIMIT)
  })
})

describe("RecentFilesTool — action='touch'", () => {
  it('records a path and reports the post-touch entry shape', async () => {
    let clock = 5_000
    const { tracker, tool } = freshTool({ now: () => clock })
    const r = await tool.run(
      { action: 'touch', path: 'src/a.ts' },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesTouchResult>(r.output)
    expect(payload).toMatchObject({
      action: 'touch',
      ok: true,
      path: 'src/a.ts',
      hitCount: 1,
    })
    expect(payload.lastTouched).toBe(5_000)
    expect(tracker.list()).toEqual(['src/a.ts'])
  })

  it('honors an explicit timestamp instead of the tracker clock', async () => {
    let clock = 9_999
    const { tracker, tool } = freshTool({ now: () => clock })
    const r = await tool.run(
      { action: 'touch', path: 'src/x.ts', timestamp: 1234 },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesTouchResult>(r.output)
    expect(payload.lastTouched).toBe(1234)
    // Tracker also persisted the explicit ts.
    const snap = tracker.entriesSnapshot()
    expect(snap[0]?.timestamp).toBe(1234)
  })

  it('bumps hitCount on re-touching the same path', async () => {
    const { tool } = freshTool()
    await tool.run({ action: 'touch', path: 'p.ts' }, mkCtx())
    await tool.run({ action: 'touch', path: 'p.ts' }, mkCtx())
    const r = await tool.run({ action: 'touch', path: 'p.ts' }, mkCtx())
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesTouchResult>(r.output)
    expect(payload.hitCount).toBe(3)
  })
})

describe("RecentFilesTool — action='forget'", () => {
  it('removes a tracked path and reports removed=true', async () => {
    const { tracker, tool } = freshTool()
    tracker.touch('a.ts')
    tracker.touch('b.ts')

    const r = await tool.run(
      { action: 'forget', path: 'a.ts' },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesForgetResult>(r.output)
    expect(payload).toMatchObject({
      action: 'forget',
      ok: true,
      removed: true,
      path: 'a.ts',
    })
    expect(tracker.list()).toEqual(['b.ts'])
  })

  it('reports removed=false for an unknown path', async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 'forget', path: 'never-touched.ts' },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesForgetResult>(r.output)
    expect(payload.removed).toBe(false)
  })
})

describe("RecentFilesTool — action='clear'", () => {
  it('wipes everything and reports the removed count', async () => {
    const { tracker, tool } = freshTool()
    tracker.touch('a')
    tracker.touch('b')
    tracker.touch('c')

    const r = await tool.run({ action: 'clear' }, mkCtx())
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesClearResult>(r.output)
    expect(payload).toMatchObject({
      action: 'clear',
      ok: true,
      removedCount: 3,
    })
    expect(tracker.list()).toEqual([])
    expect(tracker.size).toBe(0)
  })

  it('is a safe no-op on an empty tracker (removedCount=0)', async () => {
    const { tool } = freshTool()
    const r = await tool.run({ action: 'clear' }, mkCtx())
    expect(r.isError).toBe(false)
    const payload = parsePayload<RecentFilesClearResult>(r.output)
    expect(payload.removedCount).toBe(0)
  })
})

describe('RecentFilesTool — input validation', () => {
  it("action='touch' without path returns an error", async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 'touch' } as RecentFilesInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("action='touch' requires a non-empty 'path'")
  })

  it("action='touch' with empty-string path returns an error", async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 'touch', path: '' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("action='touch' requires a non-empty 'path'")
  })

  it("action='forget' without path returns an error", async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 'forget' } as RecentFilesInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("action='forget' requires a non-empty 'path'")
  })

  it('invalid action string returns an error', async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 'nuke-everything' as unknown as RecentFilesInput['action'] },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("'action' must be one of list|touch|forget|clear")
  })

  it('non-string action returns an error', async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 42 as unknown as RecentFilesInput['action'] },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("'action' must be a string")
  })

  it("action='touch' with non-finite timestamp returns an error", async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 'touch', path: 'p.ts', timestamp: Number.NaN },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("'timestamp' must be a finite number")
  })

  it("action='list' with maxResults < 1 returns an error", async () => {
    const { tool } = freshTool()
    const r = await tool.run(
      { action: 'list', maxResults: 0 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("'maxResults' must be a positive number")
  })
})

describe('RecentFilesTool — fresh-state isolation', () => {
  // Sanity: two tools over two trackers don't accidentally share state.
  it('two trackers do not cross-contaminate', async () => {
    const { tracker: t1, tool: tool1 } = freshTool()
    const { tracker: t2, tool: tool2 } = freshTool()
    await tool1.run({ action: 'touch', path: 'a.ts' }, mkCtx())
    await tool2.run({ action: 'touch', path: 'b.ts' }, mkCtx())
    expect(t1.list()).toEqual(['a.ts'])
    expect(t2.list()).toEqual(['b.ts'])
  })
})
