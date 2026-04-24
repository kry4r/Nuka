import { describe, it, expect } from 'vitest'
import { createTodoStore, makeTodoWriteTool } from '../../../src/core/tools/todoWrite'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

describe('makeTodoWriteTool', () => {
  it('replace-all updates the store state', async () => {
    const store = createTodoStore()
    const tool = makeTodoWriteTool(store)
    await tool.run({ items: [{ title: 'First', status: 'pending' }] }, ctx)
    expect(store.items).toHaveLength(1)
    expect(store.items[0]!.title).toBe('First')
    const r = await tool.run({ items: [{ title: 'Second', status: 'completed' }] }, ctx)
    expect(r.isError).toBe(false)
    expect(store.items).toHaveLength(1)
    expect(store.items[0]!.title).toBe('Second')
  })

  it('second call overrides the first (replace-all semantics)', async () => {
    const store = createTodoStore()
    const tool = makeTodoWriteTool(store)
    await tool.run({ items: [{ title: 'A', status: 'pending' }, { title: 'B', status: 'in_progress' }] }, ctx)
    await tool.run({ items: [{ title: 'C', status: 'completed' }] }, ctx)
    expect(store.items).toHaveLength(1)
    expect(store.items[0]!.title).toBe('C')
  })

  it('renders empty list as (no todos)', async () => {
    const store = createTodoStore()
    const tool = makeTodoWriteTool(store)
    const r = await tool.run({ items: [] }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toBe('(no todos)')
  })

  it('renders correct status markers', async () => {
    const store = createTodoStore()
    const tool = makeTodoWriteTool(store)
    const r = await tool.run({
      items: [
        { title: 'Todo', status: 'pending' },
        { title: 'Doing', status: 'in_progress' },
        { title: 'Done', status: 'completed' },
      ],
    }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('[ ] Todo')
    expect(r.output).toContain('[-] Doing')
    expect(r.output).toContain('[x] Done')
  })

  it('declares no permission needed', () => {
    const store = createTodoStore()
    const tool = makeTodoWriteTool(store)
    expect(tool.needsPermission({ items: [] })).toBe('none')
  })
})
