// test/core/cron/tools.test.ts
import { describe, expect, it } from 'vitest'
import { createCronStore, CronStore } from '../../../src/core/cron/store'
import {
  makeCronCreateTool,
  makeCronDeleteTool,
  makeCronListTool,
  makeCronTools,
} from '../../../src/core/cron/tools'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

describe('CronCreate tool', () => {
  it('accepts a valid recurring expression and registers the job', async () => {
    const store = createCronStore()
    const tool = makeCronCreateTool(store)
    const r = await tool.run(
      { cron: '*/5 * * * *', prompt: 'Check the deploy' },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(store.size()).toBe(1)
    const [task] = store.list()
    expect(task!.cron).toBe('*/5 * * * *')
    expect(task!.recurring).toBe(true) // default
    expect(task!.prompt).toBe('Check the deploy')
    expect(typeof r.output).toBe('string')
    expect(r.output).toContain(task!.id)
  })

  it('honors recurring=false for one-shot tasks', async () => {
    const store = createCronStore()
    const tool = makeCronCreateTool(store)
    const r = await tool.run(
      { cron: '30 14 * * *', prompt: 'Lunch', recurring: false },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(store.list()[0]!.recurring).toBe(false)
    expect(r.output).toContain('one-shot')
  })

  it('rejects invalid cron expressions', async () => {
    const store = createCronStore()
    const tool = makeCronCreateTool(store)
    const r = await tool.run(
      { cron: 'not-a-cron', prompt: 'x' },
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('Invalid cron expression')
    expect(store.size()).toBe(0)
  })

  it('refuses to exceed MAX_JOBS', async () => {
    const store = createCronStore()
    const tool = makeCronCreateTool(store)
    for (let i = 0; i < CronStore.MAX_JOBS; i++) {
      // Bypass the tool to seed the store fast
      store.add({ cron: '0 0 * * *', prompt: `seed-${i}`, recurring: true })
    }
    const r = await tool.run(
      { cron: '0 12 * * *', prompt: 'overflow' },
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('Too many scheduled jobs')
    expect(store.size()).toBe(CronStore.MAX_JOBS)
  })

  it('declares no permission needed', () => {
    const store = createCronStore()
    const tool = makeCronCreateTool(store)
    expect(tool.needsPermission({ cron: '* * * * *', prompt: 'x' })).toBe('none')
  })
})

describe('CronList tool', () => {
  it('reports "No scheduled jobs." when empty', async () => {
    const tool = makeCronListTool(createCronStore())
    const r = await tool.run({}, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toBe('No scheduled jobs.')
  })

  it('lists existing jobs with id, schedule, and trimmed prompt', async () => {
    const store = createCronStore()
    store.add({
      cron: '*/5 * * * *',
      prompt: 'short prompt',
      recurring: true,
    })
    store.add({
      cron: '0 9 * * *',
      prompt: 'X'.repeat(200),
      recurring: false,
    })
    const tool = makeCronListTool(store)
    const r = await tool.run({}, ctx)
    expect(r.isError).toBe(false)
    const out = r.output as string
    expect(out).toContain('Every 5 minutes')
    expect(out).toContain('short prompt')
    expect(out).toContain('one-shot')
    // long prompt is truncated with "..."
    expect(out).toContain('...')
    expect(out.split('\n')).toHaveLength(2)
  })

  it('is parallel-safe and read-only', () => {
    const tool = makeCronListTool(createCronStore())
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.annotations?.parallelSafe).toBe(true)
  })
})

describe('CronDelete tool', () => {
  it('deletes an existing job', async () => {
    const store = createCronStore()
    const task = store.add({
      cron: '*/5 * * * *',
      prompt: 'p',
      recurring: true,
    })
    const tool = makeCronDeleteTool(store)
    const r = await tool.run({ id: task.id }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toBe(`Cancelled job ${task.id}.`)
    expect(store.size()).toBe(0)
  })

  it('errors on unknown id', async () => {
    const tool = makeCronDeleteTool(createCronStore())
    const r = await tool.run({ id: 'deadbeef' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('deadbeef')
  })
})

describe('makeCronTools bulk factory', () => {
  it('returns all three tools sharing one store', async () => {
    const store = createCronStore()
    const { create, list, delete: del } = makeCronTools(store)
    expect(create.name).toBe('CronCreate')
    expect(list.name).toBe('CronList')
    expect(del.name).toBe('CronDelete')

    // Round-trip: create → list shows it → delete clears it.
    const created = await create.run(
      { cron: '0 9 * * *', prompt: 'morning' },
      ctx,
    )
    expect(created.isError).toBe(false)
    const id = store.list()[0]!.id

    const listed = await list.run({}, ctx)
    expect(listed.isError).toBe(false)
    expect(listed.output).toContain(id)

    const deleted = await del.run({ id }, ctx)
    expect(deleted.isError).toBe(false)
    const listedAfter = await list.run({}, ctx)
    expect(listedAfter.output).toBe('No scheduled jobs.')
  })
})

describe('CronStore (direct)', () => {
  it('generates 8-char alphanumeric ids', () => {
    const store = createCronStore()
    const t = store.add({ cron: '* * * * *', prompt: 'p', recurring: true })
    expect(t.id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('clear() empties the registry', () => {
    const store = createCronStore()
    store.add({ cron: '* * * * *', prompt: 'a', recurring: true })
    store.add({ cron: '* * * * *', prompt: 'b', recurring: true })
    store.clear()
    expect(store.size()).toBe(0)
  })
})
