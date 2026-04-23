// test/core/tools/bash.test.ts
import { describe, it, expect } from 'vitest'
import { BashTool } from '../../../src/core/tools/bash'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

describe('BashTool', () => {
  it('runs a simple command and returns stdout', async () => {
    const r = await BashTool.run({ command: "echo hello" }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('hello')
  })

  it('returns isError with non-zero exit', async () => {
    const r = await BashTool.run({ command: "exit 3" }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/exit\s*3/i)
  })

  it('respects timeout', async () => {
    const r = await BashTool.run({ command: "sleep 2", timeout: 100 }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/timed out|killed/i)
  })

  it('declares exec permission', () => {
    expect(BashTool.needsPermission({ command: 'echo' })).toBe('exec')
  })

  it('aborts on signal', async () => {
    const ac = new AbortController()
    const p = BashTool.run({ command: 'sleep 5' }, { ...ctx, signal: ac.signal })
    setTimeout(() => ac.abort(), 50)
    const r = await p
    expect(r.isError).toBe(true)
  })
})
