// test/core/testing/explorer/skeleton.test.ts
//
// M0.T1 skeleton test — red until explorer stubs are in place.
// For each of the 5 verbs, assert that calling the stub rejects with
// /not implemented/. Also asserts that runExploreCli([]) returns exit code 2
// (usage / bad args) without throwing.

import { describe, it, expect, vi } from 'vitest'
import {
  capture,
  sweep,
  fuzz,
  judge,
  repair,
  runExploreCli,
} from '../../../../src/core/testing/explorer/index'

describe('explorer skeleton stubs', () => {
  it('capture rejects with /not implemented/', async () => {
    await expect(capture({} as never)).rejects.toThrow(/not implemented/)
  })

  it('sweep rejects with /not implemented/', async () => {
    await expect(sweep({} as never)).rejects.toThrow(/not implemented/)
  })

  it('fuzz rejects with /not implemented/', async () => {
    await expect(fuzz({} as never)).rejects.toThrow(/not implemented/)
  })

  it('judge rejects with /not implemented/', async () => {
    await expect(judge({} as never)).rejects.toThrow(/not implemented/)
  })

  it('repair rejects with /not implemented/', async () => {
    await expect(repair({} as never)).rejects.toThrow(/not implemented/)
  })

  it('runExploreCli([]) returns exit code 2 (usage)', async () => {
    const written: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(typeof chunk === 'string' ? chunk : chunk.toString())
      return true
    })
    const code = await runExploreCli([])
    spy.mockRestore()
    expect(code).toBe(2)
    // Usage text must mention all 5 verb names individually
    const usage = written.join('')
    expect(usage).toMatch(/capture/)
    expect(usage).toMatch(/sweep/)
    expect(usage).toMatch(/fuzz/)
    expect(usage).toMatch(/judge/)
    expect(usage).toMatch(/repair/)
  })
})
