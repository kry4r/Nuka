import { describe, it, expect } from 'vitest'
import { Blackboard } from '../../../../src/core/agents/coordinator/blackboard'
import { makeBlackboardTools } from '../../../../src/core/tools/coordinator/blackboardTool'

const ctx = () => ({
  signal: new AbortController().signal,
  cwd: process.cwd(),
})

describe('bb_write / bb_read tools', () => {
  it('exposes two tools with deterministic names', () => {
    const bb = new Blackboard()
    const { read, write } = makeBlackboardTools(bb)
    expect(read.name).toBe('bb_read')
    expect(write.name).toBe('bb_write')
  })

  it('write persists, read returns the same value', async () => {
    const bb = new Blackboard()
    const { read, write } = makeBlackboardTools(bb)
    const wRes = await write.run({ key: 'finding', value: 'null pointer' }, ctx())
    expect(wRes.isError).toBe(false)
    const rRes = await read.run({ key: 'finding' }, ctx())
    expect(rRes.isError).toBe(false)
    expect(rRes.output).toBe('null pointer')
  })

  it('read of missing key is non-error with empty output', async () => {
    const bb = new Blackboard()
    const { read } = makeBlackboardTools(bb)
    const res = await read.run({ key: 'nope' }, ctx())
    expect(res.isError).toBe(false)
    expect(res.output).toBe('')
  })

  it('bb_write surfaces size-cap as ToolResult error (no throw)', async () => {
    const bb = new Blackboard()
    const { write } = makeBlackboardTools(bb)
    const big = 'x'.repeat(300_000)
    const res = await write.run({ key: 'k', value: big }, ctx())
    expect(res.isError).toBe(true)
    expect(typeof res.output).toBe('string')
  })

  it('bb_read with `list: true` returns key list', async () => {
    const bb = new Blackboard()
    const { write, read } = makeBlackboardTools(bb)
    await write.run({ key: 'a', value: '1' }, ctx())
    await write.run({ key: 'b', value: '2' }, ctx())
    const res = await read.run({ key: '', list: true }, ctx())
    expect(res.isError).toBe(false)
    expect(res.output).toMatch(/a/)
    expect(res.output).toMatch(/b/)
  })
})
