// test/core/fileSearch/recentFilesHook.test.ts
//
// Tests for the beforeToolCall handler that auto-touches the
// session-scoped `RecentFiles` MRU tracker for Read/Edit/Write tool
// calls. The handler is registered in cli.tsx so the agent never has
// to manage MRU state manually; these tests pin the contract.

import { describe, expect, it } from 'vitest'

import { RecentFiles } from '../../../src/core/fileSearch/recentFiles'
import {
  RECENT_FILES_TRACKED_TOOLS,
  createRecentFilesTouchHandler,
} from '../../../src/core/fileSearch/recentFilesHook'
import type { HookContext } from '../../../src/core/hooks/events'

function ctx(toolName: string | undefined, input: unknown): HookContext {
  return {
    event: 'beforeToolCall',
    toolName,
    payload: input === undefined ? undefined : { input },
  }
}

describe('createRecentFilesTouchHandler', () => {
  it('exposes the tracked tool names allow-list', () => {
    expect(RECENT_FILES_TRACKED_TOOLS.has('Read')).toBe(true)
    expect(RECENT_FILES_TRACKED_TOOLS.has('Edit')).toBe(true)
    expect(RECENT_FILES_TRACKED_TOOLS.has('Write')).toBe(true)
    expect(RECENT_FILES_TRACKED_TOOLS.has('Bash')).toBe(false)
  })

  it('returns an empty result object (no skip, no additionalContext) for a tracked tool', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    const result = await handler(ctx('Read', { path: '/x.ts' }))
    expect(result).toEqual({})
  })

  it('returns an empty result object (no-op) for an unrelated tool name', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    const result = await handler(ctx('Bash', { command: 'ls' }))
    expect(result).toEqual({})
    expect(tracker.list()).toEqual([])
  })

  it('returns an empty result object for an undefined tool name', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    const result = await handler(ctx(undefined, { path: '/x.ts' }))
    expect(result).toEqual({})
    expect(tracker.list()).toEqual([])
  })

  it('touches the tracker for Read with { path }', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Read', { path: '/a/b.ts' }))
    expect(tracker.list()).toEqual(['/a/b.ts'])
  })

  it('touches the tracker for Edit with { path }', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(
      ctx('Edit', {
        path: '/a/b.ts',
        old_string: 'x',
        new_string: 'y',
      }),
    )
    expect(tracker.list()).toEqual(['/a/b.ts'])
  })

  it('also recognises the upstream `file_path` field name', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(
      ctx('Edit', {
        file_path: '/u/v.ts',
        old_string: 'x',
        new_string: 'y',
      }),
    )
    expect(tracker.list()).toEqual(['/u/v.ts'])
  })

  it('touches the tracker for Write with { path }', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Write', { path: '/p.txt', content: 'hi' }))
    expect(tracker.list()).toEqual(['/p.txt'])
  })

  it('also recognises the `filename` field name', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Write', { filename: '/q.txt', content: 'hi' }))
    expect(tracker.list()).toEqual(['/q.txt'])
  })

  it('skips when the path field is missing', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Read', { offset: 1, limit: 10 }))
    expect(tracker.list()).toEqual([])
  })

  it('skips when the path field is of the wrong type', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Read', { path: 123 }))
    await handler(ctx('Edit', { file_path: null }))
    await handler(ctx('Write', { filename: { nested: true } }))
    expect(tracker.list()).toEqual([])
  })

  it('skips when the path field is the empty string', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Read', { path: '' }))
    expect(tracker.list()).toEqual([])
  })

  it('skips when payload is undefined', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Read', undefined))
    expect(tracker.list()).toEqual([])
  })

  it('skips when payload.input is non-object', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Read', 'just-a-string'))
    await handler(ctx('Read', 42))
    await handler(ctx('Read', null))
    expect(tracker.list()).toEqual([])
  })

  it('accumulates touches across multiple file-op calls in correct order', async () => {
    let clock = 1000
    const tracker = new RecentFiles({ now: () => clock })
    const handler = createRecentFilesTouchHandler(tracker)

    await handler(ctx('Read', { path: '/a.ts' }))
    clock += 10
    await handler(ctx('Edit', { path: '/b.ts', old_string: 'x', new_string: 'y' }))
    clock += 10
    await handler(ctx('Write', { path: '/c.ts', content: '' }))
    clock += 10
    // re-Read /a.ts → should bubble to head
    await handler(ctx('Read', { path: '/a.ts' }))

    expect(tracker.list()).toEqual(['/a.ts', '/c.ts', '/b.ts'])
  })

  it('does not touch on a non-tracked tool that happens to carry a path', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Glob', { path: '/some/dir' }))
    await handler(ctx('FileSearch', { path: '/some/dir' }))
    expect(tracker.list()).toEqual([])
  })

  it('prefers `path` over `file_path` and `filename` when multiple are present', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(
      ctx('Edit', {
        path: '/wins.ts',
        file_path: '/loses.ts',
        filename: '/also-loses.ts',
      }),
    )
    expect(tracker.list()).toEqual(['/wins.ts'])
  })

  it('shares state across multiple invocations of one handler instance', async () => {
    const tracker = new RecentFiles()
    const handler = createRecentFilesTouchHandler(tracker)
    await handler(ctx('Read', { path: '/a' }))
    await handler(ctx('Read', { path: '/b' }))
    await handler(ctx('Read', { path: '/c' }))
    expect(tracker.size).toBe(3)
    expect(tracker.list()).toEqual(['/c', '/b', '/a'])
  })

  it('is isolated between independent tracker instances', async () => {
    const t1 = new RecentFiles()
    const t2 = new RecentFiles()
    const h1 = createRecentFilesTouchHandler(t1)
    const h2 = createRecentFilesTouchHandler(t2)
    await h1(ctx('Read', { path: '/from-1' }))
    await h2(ctx('Read', { path: '/from-2' }))
    expect(t1.list()).toEqual(['/from-1'])
    expect(t2.list()).toEqual(['/from-2'])
  })
})
