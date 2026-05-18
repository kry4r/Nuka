import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readLinesReverse } from '../../../../src/core/session/history/reader'

describe('readLinesReverse', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })
  it('yields lines newest-first', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-rev-'))
    const file = path.join(dir, 'log.jsonl')
    writeFileSync(file, 'a\nb\nc\n', 'utf8')
    const collected: string[] = []
    for await (const line of readLinesReverse(file)) collected.push(line)
    expect(collected).toEqual(['c', 'b', 'a'])
  })
  it('returns nothing for missing file', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-rev-'))
    const collected: string[] = []
    for await (const line of readLinesReverse(path.join(dir, 'missing.jsonl'))) {
      collected.push(line)
    }
    expect(collected).toEqual([])
  })
  it('handles file with no trailing newline', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-rev-'))
    const file = path.join(dir, 'log.jsonl')
    writeFileSync(file, 'one\ntwo', 'utf8')
    const collected: string[] = []
    for await (const line of readLinesReverse(file)) collected.push(line)
    expect(collected).toEqual(['two', 'one'])
  })
  it('skips empty lines', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-rev-'))
    const file = path.join(dir, 'log.jsonl')
    writeFileSync(file, 'a\n\nb\n', 'utf8')
    const collected: string[] = []
    for await (const line of readLinesReverse(file)) collected.push(line)
    expect(collected).toEqual(['b', 'a'])
  })
})
