import { describe, it, expect } from 'vitest'
import { reduceFileDiffs } from '../../../../src/core/recap/fields/fileDiffs'

describe('reduceFileDiffs', () => {
  it('groups Edit/Write tool calls by file path', () => {
    const r = reduceFileDiffs([
      { topic: 'agent', payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Edit', input: { file_path: '/src/foo.ts', old_string: 'a', new_string: 'ab' } } },
      { topic: 'agent', payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Edit', input: { file_path: '/src/bar.ts', old_string: 'x', new_string: 'xy' } } },
      { topic: 'agent', payload: { type: 'agent.tool.start', sessionId: 's2', toolName: 'Write', input: { file_path: '/src/foo.ts', content: 'new content' } } },
    ])
    // 2 distinct files
    expect(r.length).toBe(2)
    const fooRow = r.find(x => x.path === '/src/foo.ts')
    expect(fooRow).toBeDefined()
    expect(fooRow!.added).toBeGreaterThanOrEqual(0)
  })

  it('ignores non-Edit/Write tool calls', () => {
    const r = reduceFileDiffs([
      { topic: 'agent', payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Read', input: { file_path: '/src/foo.ts' } } },
    ])
    expect(r).toEqual([])
  })

  it('handles 3 Edit calls on 2 files → 2 rows', () => {
    const r = reduceFileDiffs([
      { topic: 'agent', payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Edit', input: { file_path: '/a.ts', old_string: 'x', new_string: 'xy' } } },
      { topic: 'agent', payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Edit', input: { file_path: '/b.ts', old_string: 'a', new_string: 'ab' } } },
      { topic: 'agent', payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Edit', input: { file_path: '/a.ts', old_string: 'y', new_string: 'yz' } } },
    ])
    expect(r.length).toBe(2)
  })
})
