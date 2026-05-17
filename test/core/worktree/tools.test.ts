// test/core/worktree/tools.test.ts
import { describe, expect, it } from 'vitest'
import { createWorktreeStore } from '../../../src/core/worktree/store'
import {
  makeEnterWorktreeTool,
  makeExitWorktreeTool,
  makeListWorktreesTool,
  makeWorktreeTools,
  normalizeWorktreeName,
} from '../../../src/core/worktree/tools'
import type { GitRunner, GitResult } from '../../../src/core/worktree/git'

const ctx = (cwd = '/repo') => ({ signal: new AbortController().signal, cwd })

/** Build a controllable fake git runner. */
function makeRunner(opts: {
  toplevel?: string | null
  addOk?: boolean
  addStderr?: string
  removeOk?: boolean
  removeStderr?: string
}): { runner: GitRunner; calls: { args: string[]; cwd: string }[] } {
  const calls: { args: string[]; cwd: string }[] = []
  const toplevel = opts.toplevel === undefined ? '/repo' : opts.toplevel
  const runner: GitRunner = (args, runOpts) => {
    calls.push({ args, cwd: runOpts.cwd })
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
      if (toplevel === null) {
        return { code: 128, stdout: '', stderr: 'not a git repo' } as GitResult
      }
      return { code: 0, stdout: `${toplevel}\n`, stderr: '' } as GitResult
    }
    if (args[0] === 'worktree' && args[1] === 'add') {
      const ok = opts.addOk ?? true
      return ok
        ? { code: 0, stdout: '', stderr: '' }
        : { code: 1, stdout: '', stderr: opts.addStderr ?? 'add failed' }
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      const ok = opts.removeOk ?? true
      return ok
        ? { code: 0, stdout: '', stderr: '' }
        : { code: 1, stdout: '', stderr: opts.removeStderr ?? 'remove failed' }
    }
    return { code: 1, stdout: '', stderr: 'unhandled args in test runner' }
  }
  return { runner, calls }
}

describe('EnterWorktree tool', () => {
  it('creates a worktree, registers it, and reports cwdOverride', async () => {
    const store = createWorktreeStore()
    const { runner, calls } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: 'feat-a' }, ctx())
    expect(r.isError).toBe(false)
    expect(store.size()).toBe(1)
    const [rec] = store.list()
    expect(rec!.branch).toBe('feat-a')
    expect(rec!.path).toBe('/repo/.nuka/worktrees/feat-a')
    const out = r.output as string
    expect(out).toContain('cwdOverride=/repo/.nuka/worktrees/feat-a')
    expect(out).toContain('feat-a')
    // git was actually invoked with the right args
    const addCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'add')
    expect(addCall?.args).toEqual([
      'worktree',
      'add',
      '-b',
      'feat-a',
      '/repo/.nuka/worktrees/feat-a',
    ])
  })

  it('marks the new worktree as active so subsequent tools see the override (P1 #6)', async () => {
    const store = createWorktreeStore()
    const { runner } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    expect(store.getActive()).toBeUndefined()
    const r = await tool.run({ name: 'feat-a' }, ctx())
    expect(r.isError).toBe(false)
    const active = store.getActive()
    expect(active?.path).toBe('/repo/.nuka/worktrees/feat-a')
    expect(active?.branch).toBe('feat-a')
  })

  it('does NOT set active when the git command fails (P1 #6)', async () => {
    const store = createWorktreeStore()
    const { runner } = makeRunner({ addOk: false, addStderr: 'branch exists' })
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: 'dupe' }, ctx())
    expect(r.isError).toBe(true)
    expect(store.getActive()).toBeUndefined()
  })

  it('rejects invalid slugs without touching git', async () => {
    const store = createWorktreeStore()
    const { runner, calls } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: '../escape' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/invalid characters|not allowed|"\/"/i)
    expect(store.size()).toBe(0)
    expect(calls.some((c) => c.args[0] === 'worktree')).toBe(false)
  })

  it('errors when cwd is not inside a git repo', async () => {
    const store = createWorktreeStore()
    const { runner } = makeRunner({ toplevel: null })
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: 'x' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain('Not inside a git repository')
    expect(store.size()).toBe(0)
  })

  it('surfaces git failures and does not register the record', async () => {
    const store = createWorktreeStore()
    const { runner } = makeRunner({ addOk: false, addStderr: 'branch exists' })
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: 'dupe' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain('git worktree add failed')
    expect(r.output).toContain('branch exists')
    expect(store.size()).toBe(0)
  })

  it('declares exec permission and is not parallel-safe', () => {
    const store = createWorktreeStore()
    const { runner } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    expect(tool.needsPermission({ name: 'x' })).toBe('exec')
    expect(tool.annotations?.readOnly).toBeFalsy()
  })

  it('normalizes user-friendly names through slugify by default', async () => {
    const store = createWorktreeStore()
    const { runner, calls } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: 'feat: my new thing!' }, ctx())
    expect(r.isError).toBe(false)
    const [rec] = store.list()
    // Spaces and punctuation collapse to a single dash; the trailing `!` is
    // stripped along with the leading `:` separator.
    expect(rec!.branch).toBe('feat-my-new-thing')
    expect(rec!.path).toBe('/repo/.nuka/worktrees/feat-my-new-thing')
    expect(r.output).toContain('cwdOverride=/repo/.nuka/worktrees/feat-my-new-thing')
    const addCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'add')
    expect(addCall?.args).toEqual([
      'worktree',
      'add',
      '-b',
      'feat-my-new-thing',
      '/repo/.nuka/worktrees/feat-my-new-thing',
    ])
  })

  it('preserves `/` segment boundaries when normalizing', async () => {
    const store = createWorktreeStore()
    const { runner, calls } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: 'feat/My Bug Fix' }, ctx())
    expect(r.isError).toBe(false)
    const [rec] = store.list()
    expect(rec!.branch).toBe('feat/my-bug-fix')
    const addCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'add')
    expect(addCall?.args[3]).toBe('feat/my-bug-fix')
  })

  it('is idempotent on already-clean names', async () => {
    const store = createWorktreeStore()
    const { runner, calls } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: 'feat-a' }, ctx())
    expect(r.isError).toBe(false)
    const [rec] = store.list()
    expect(rec!.branch).toBe('feat-a')
    const addCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'add')
    expect(addCall?.args[3]).toBe('feat-a')
  })

  it('passes input through unchanged when normalize=false', async () => {
    const store = createWorktreeStore()
    const { runner, calls } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: 'feat: my thing', normalize: false }, ctx())
    // Strict validateSlug rejects ':' and ' '.
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/invalid characters/i)
    expect(calls.some((c) => c.args[0] === 'worktree')).toBe(false)
  })

  it('still errors on names that slugify to empty', async () => {
    const store = createWorktreeStore()
    const { runner, calls } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    // Pure punctuation reduces to empty after slugify.
    const r = await tool.run({ name: '!@#$' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/empty/i)
    expect(calls.some((c) => c.args[0] === 'worktree')).toBe(false)
  })

  it('strips accents (NFKD) while normalizing', async () => {
    const store = createWorktreeStore()
    const { runner, calls } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ name: 'Café résumé' }, ctx())
    expect(r.isError).toBe(false)
    const [rec] = store.list()
    expect(rec!.branch).toBe('cafe-resume')
    const addCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'add')
    expect(addCall?.args[3]).toBe('cafe-resume')
  })

  it('still rejects leading-/ inputs even when normalize fixes other chars', async () => {
    const store = createWorktreeStore()
    const { runner, calls } = makeRunner({})
    const tool = makeEnterWorktreeTool({ store, gitRunner: runner })
    // '../escape' slug-normalizes to '/escape' (empty first segment),
    // which `validateSlug` rejects for the leading slash.
    const r = await tool.run({ name: '../escape' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/start or end with "\/"/i)
    expect(calls.some((c) => c.args[0] === 'worktree')).toBe(false)
  })
})

describe('normalizeWorktreeName helper', () => {
  it('is idempotent on already-safe names', () => {
    expect(normalizeWorktreeName('feat-a')).toBe('feat-a')
    expect(normalizeWorktreeName('feat/foo-bar')).toBe('feat/foo-bar')
  })

  it('returns empty for empty input', () => {
    expect(normalizeWorktreeName('')).toBe('')
    expect(normalizeWorktreeName(undefined as unknown as string)).toBe('')
  })

  it('collapses spaces and punctuation per segment', () => {
    expect(normalizeWorktreeName('feat: my thing')).toBe('feat-my-thing')
    expect(normalizeWorktreeName('Hot   FIX!')).toBe('hot-fix')
  })

  it('keeps `/` boundaries as segment separators', () => {
    expect(normalizeWorktreeName('feat/My Bug')).toBe('feat/my-bug')
    expect(normalizeWorktreeName('a/b/c d')).toBe('a/b/c-d')
  })
})

describe('ListWorktrees tool', () => {
  it('reports empty state', async () => {
    const tool = makeListWorktreesTool({ store: createWorktreeStore() })
    const r = await tool.run({}, ctx())
    expect(r.isError).toBe(false)
    expect(r.output).toContain('No worktrees registered')
  })

  it('lists registered worktrees', async () => {
    const store = createWorktreeStore()
    store.add({ path: '/repo/.nuka/worktrees/a', branch: 'a', originalCwd: '/repo' })
    store.add({ path: '/repo/.nuka/worktrees/b', branch: 'b', originalCwd: '/repo' })
    const tool = makeListWorktreesTool({ store })
    const r = await tool.run({}, ctx())
    expect(r.isError).toBe(false)
    const out = r.output as string
    expect(out).toContain('/repo/.nuka/worktrees/a')
    expect(out).toContain('[a]')
    expect(out).toContain('/repo/.nuka/worktrees/b')
    expect(out.split('\n')).toHaveLength(2)
  })

  it('is parallel-safe and read-only', () => {
    const tool = makeListWorktreesTool({ store: createWorktreeStore() })
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.annotations?.parallelSafe).toBe(true)
  })
})

describe('ExitWorktree tool', () => {
  it('removes a tracked worktree and returns the original cwd in cwdOverride', async () => {
    const store = createWorktreeStore()
    const rec = store.add({
      path: '/repo/.nuka/worktrees/x',
      branch: 'x',
      originalCwd: '/repo',
    })
    const { runner, calls } = makeRunner({})
    const tool = makeExitWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ id: rec.id }, ctx('/repo/.nuka/worktrees/x'))
    expect(r.isError).toBe(false)
    expect(r.output).toContain('cwdOverride=/repo')
    expect(store.size()).toBe(0)
    // git worktree remove was called without --force by default
    const removeCall = calls.find(
      (c) => c.args[0] === 'worktree' && c.args[1] === 'remove',
    )
    expect(removeCall?.args).toEqual([
      'worktree',
      'remove',
      '/repo/.nuka/worktrees/x',
    ])
  })

  it('passes --force when force=true', async () => {
    const store = createWorktreeStore()
    const rec = store.add({ path: '/r/wt', originalCwd: '/r' })
    const { runner, calls } = makeRunner({})
    const tool = makeExitWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ id: rec.id, force: true }, ctx('/r'))
    expect(r.isError).toBe(false)
    const removeCall = calls.find(
      (c) => c.args[0] === 'worktree' && c.args[1] === 'remove',
    )
    expect(removeCall?.args).toEqual(['worktree', 'remove', '--force', '/r/wt'])
  })

  it('refuses unknown ids', async () => {
    const store = createWorktreeStore()
    const { runner } = makeRunner({})
    const tool = makeExitWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ id: 'deadbeef' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain('deadbeef')
    expect(r.output).toContain('only operates on worktrees created via EnterWorktree')
  })

  it('clears the active pointer when removing the active worktree (P1 #6)', async () => {
    const store = createWorktreeStore()
    const rec = store.add({
      path: '/repo/.nuka/worktrees/x',
      branch: 'x',
      originalCwd: '/repo',
    })
    store.setActive(rec.id)
    expect(store.getActive()?.id).toBe(rec.id)
    const { runner } = makeRunner({})
    const tool = makeExitWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ id: rec.id }, ctx('/repo/.nuka/worktrees/x'))
    expect(r.isError).toBe(false)
    expect(store.getActive()).toBeUndefined()
  })

  it('keeps the record on git failure so retry with force is possible', async () => {
    const store = createWorktreeStore()
    const rec = store.add({ path: '/r/wt', originalCwd: '/r' })
    const { runner } = makeRunner({ removeOk: false, removeStderr: 'dirty' })
    const tool = makeExitWorktreeTool({ store, gitRunner: runner })
    const r = await tool.run({ id: rec.id }, ctx('/r'))
    expect(r.isError).toBe(true)
    expect(r.output).toContain('git worktree remove failed')
    expect(r.output).toContain('dirty')
    expect(store.size()).toBe(1)
  })
})

describe('makeWorktreeTools bulk factory', () => {
  it('returns three tools sharing one store', async () => {
    const store = createWorktreeStore()
    const { runner } = makeRunner({})
    const { enter, list, exit } = makeWorktreeTools({ store, gitRunner: runner })
    expect(enter.name).toBe('EnterWorktree')
    expect(list.name).toBe('ListWorktrees')
    expect(exit.name).toBe('ExitWorktree')

    // Round-trip: enter → list shows it → exit clears it.
    const created = await enter.run({ name: 'demo' }, ctx())
    expect(created.isError).toBe(false)
    const rec = store.list()[0]!
    const listed = await list.run({}, ctx())
    expect(listed.output).toContain(rec.id)
    const exited = await exit.run({ id: rec.id }, ctx('/repo/.nuka/worktrees/demo'))
    expect(exited.isError).toBe(false)
    expect(store.size()).toBe(0)
  })
})
