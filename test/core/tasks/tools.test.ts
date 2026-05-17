// test/core/tasks/tools.test.ts
import { describe, expect, it } from 'vitest'
import { createTaskStore } from '../../../src/core/tasks/store'
import {
  makeTaskCreateTool,
  makeTaskGetTool,
  makeTaskListTool,
  makeTaskTools,
  makeTaskUpdateTool,
} from '../../../src/core/tasks/tools'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

describe('TaskCreate tool', () => {
  it('creates a pending task and reports its id', async () => {
    const store = createTaskStore()
    const tool = makeTaskCreateTool(store)
    const r = await tool.run(
      { subject: 'Write tests', description: 'Cover all branches' },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(store.size()).toBe(1)
    const [t] = store.list()
    expect(t!.status).toBe('pending')
    expect(t!.subject).toBe('Write tests')
    expect(r.output).toContain(`Task #${t!.id}`)
  })

  it('rejects empty subject or description', async () => {
    const tool = makeTaskCreateTool(createTaskStore())
    const r1 = await tool.run({ subject: '', description: 'x' }, ctx)
    expect(r1.isError).toBe(true)
    expect(r1.output).toContain('subject')
    const r2 = await tool.run({ subject: 'x', description: '   ' }, ctx)
    expect(r2.isError).toBe(true)
    expect(r2.output).toContain('description')
  })

  it('declares no permission needed and is core/tasks tagged', () => {
    const tool = makeTaskCreateTool(createTaskStore())
    expect(tool.needsPermission({ subject: 'x', description: 'x' })).toBe(
      'none',
    )
    expect(tool.tags).toContain('core')
    expect(tool.tags).toContain('tasks')
  })
})

describe('TaskList tool', () => {
  it('reports "No tasks." when empty', async () => {
    const tool = makeTaskListTool(createTaskStore())
    const r = await tool.run({}, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toBe('No tasks.')
  })

  it('renders one-line summaries with status, owner, and open blockers', async () => {
    const store = createTaskStore()
    const a = store.add({ subject: 'a', description: 'aa', owner: 'alice' })
    const b = store.add({ subject: 'b', description: 'bb' })
    store.update(b.id, { addBlockedBy: [a.id] })

    const tool = makeTaskListTool(store)
    const r = await tool.run({}, ctx)
    expect(r.isError).toBe(false)
    const lines = (r.output as string).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(`#${a.id} [pending] a (alice)`)
    expect(lines[1]).toContain(`#${b.id} [pending] b`)
    expect(lines[1]).toContain(`[blocked by #${a.id}]`)
  })

  it('filters resolved blockers out of the blocked-by list', async () => {
    const store = createTaskStore()
    const a = store.add({ subject: 'a', description: 'aa' })
    const b = store.add({ subject: 'b', description: 'bb' })
    store.update(b.id, { addBlockedBy: [a.id] })
    store.update(a.id, { status: 'completed' })

    const tool = makeTaskListTool(store)
    const r = await tool.run({}, ctx)
    expect(r.output).not.toContain('blocked by')
  })

  it('declares read-only and parallelSafe', () => {
    const tool = makeTaskListTool(createTaskStore())
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.annotations?.parallelSafe).toBe(true)
  })
})

describe('TaskGet tool', () => {
  it('returns the task details, owner, and dependency lists', async () => {
    const store = createTaskStore()
    const a = store.add({
      subject: 'A',
      description: 'desc',
      owner: 'alice',
      activeForm: 'doing A',
    })
    const b = store.add({ subject: 'B', description: 'desc' })
    store.update(a.id, { addBlocks: [b.id] })

    const tool = makeTaskGetTool(store)
    const r = await tool.run({ taskId: a.id }, ctx)
    expect(r.isError).toBe(false)
    const out = r.output as string
    expect(out).toContain(`Task #${a.id}: A`)
    expect(out).toContain('Status: pending')
    expect(out).toContain('Description: desc')
    expect(out).toContain('Owner: alice')
    expect(out).toContain('Active form: doing A')
    expect(out).toContain(`Blocks: #${b.id}`)
  })

  it('returns a not-found message for unknown id', async () => {
    const tool = makeTaskGetTool(createTaskStore())
    const r = await tool.run({ taskId: '999' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('not found')
  })
})

describe('TaskUpdate tool', () => {
  it('updates status, subject, description and reports changed fields', async () => {
    const store = createTaskStore()
    const t = store.add({ subject: 'a', description: 'aa' })
    const tool = makeTaskUpdateTool(store)
    const r = await tool.run(
      {
        taskId: t.id,
        status: 'in_progress',
        subject: 'A!',
        description: 'AA!',
      },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(r.output).toContain('subject')
    expect(r.output).toContain('description')
    expect(r.output).toContain('status=in_progress')
    expect(store.get(t.id)!.status).toBe('in_progress')
  })

  it('returns isError when task does not exist', async () => {
    const tool = makeTaskUpdateTool(createTaskStore())
    const r = await tool.run({ taskId: '999', status: 'completed' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('not found')
  })

  it('deletes when status === "deleted"', async () => {
    const store = createTaskStore()
    const t = store.add({ subject: 'a', description: 'aa' })
    const tool = makeTaskUpdateTool(store)
    const r = await tool.run({ taskId: t.id, status: 'deleted' }, ctx)
    expect(r.isError).toBe(false)
    expect(store.get(t.id)).toBeUndefined()
  })

  it('clears owner when owner=null', async () => {
    const store = createTaskStore()
    const t = store.add({ subject: 'a', description: 'aa', owner: 'alice' })
    const tool = makeTaskUpdateTool(store)
    const r = await tool.run({ taskId: t.id, owner: null }, ctx)
    expect(r.isError).toBe(false)
    expect(store.get(t.id)!.owner).toBeUndefined()
  })

  it('rejects invalid status values', async () => {
    const store = createTaskStore()
    const t = store.add({ subject: 'a', description: 'aa' })
    const tool = makeTaskUpdateTool(store)
    const r = await tool.run(
      // Bypass TS for the test of runtime defense-in-depth.
      { taskId: t.id, status: 'lazy' as unknown as 'pending' },
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('Invalid status')
  })

  it('rejects non-string non-null owner', async () => {
    const store = createTaskStore()
    const t = store.add({ subject: 'a', description: 'aa' })
    const tool = makeTaskUpdateTool(store)
    const r = await tool.run(
      { taskId: t.id, owner: 42 as unknown as string },
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('owner must be')
  })

  it('appends addBlocks and mirrors blockedBy on the other side', async () => {
    const store = createTaskStore()
    const a = store.add({ subject: 'a', description: 'aa' })
    const b = store.add({ subject: 'b', description: 'bb' })
    const tool = makeTaskUpdateTool(store)
    const r = await tool.run({ taskId: a.id, addBlocks: [b.id] }, ctx)
    expect(r.isError).toBe(false)
    expect(store.get(a.id)!.blocks).toEqual([b.id])
    expect(store.get(b.id)!.blockedBy).toEqual([a.id])
  })

  it('reports "no changes" when nothing changed', async () => {
    const store = createTaskStore()
    const t = store.add({ subject: 'a', description: 'aa' })
    const tool = makeTaskUpdateTool(store)
    const r = await tool.run({ taskId: t.id }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('no changes')
  })
})

describe('makeTaskTools bulk factory', () => {
  it('builds all four tools sharing one store', async () => {
    const store = createTaskStore()
    const tools = makeTaskTools(store)
    expect(tools.create.name).toBe('TaskCreate')
    expect(tools.list.name).toBe('TaskList')
    expect(tools.get.name).toBe('TaskGet')
    expect(tools.update.name).toBe('TaskUpdate')

    await tools.create.run(
      { subject: 'shared', description: 'shared' },
      ctx,
    )
    const r = await tools.list.run({}, ctx)
    expect(r.output).toContain('shared')
  })
})
