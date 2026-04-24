import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { persistLargeOutput } from '../../../src/core/mcp/outputPersist'

const TEST_HOME = path.join(os.tmpdir(), `nuka-test-persist-${process.pid}`)

afterEach(() => {
  // Clean up files written during tests
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe('persistLargeOutput', () => {
  it('writes full text to ~/.nuka/tmp/mcp-out-<id>.txt', async () => {
    const text = 'hello world from the big output'
    const result = await persistLargeOutput({ home: TEST_HOME, fullText: text })
    expect(result.path).toMatch(/mcp-out-.+\.txt$/)
    expect(fs.existsSync(result.path)).toBe(true)
    expect(fs.readFileSync(result.path, 'utf8')).toBe(text)
  })

  it('places the file inside ~/.nuka/tmp/', async () => {
    const result = await persistLargeOutput({ home: TEST_HOME, fullText: 'data' })
    const expected = path.join(TEST_HOME, '.nuka', 'tmp')
    expect(result.path.startsWith(expected)).toBe(true)
  })

  it('creates the directory if it does not exist', async () => {
    const tmpHome = path.join(os.tmpdir(), `nuka-fresh-${Date.now()}`)
    try {
      const result = await persistLargeOutput({ home: tmpHome, fullText: 'x' })
      expect(fs.existsSync(result.path)).toBe(true)
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('each call produces a unique file path', async () => {
    const [r1, r2] = await Promise.all([
      persistLargeOutput({ home: TEST_HOME, fullText: 'aaa' }),
      persistLargeOutput({ home: TEST_HOME, fullText: 'bbb' }),
    ])
    expect(r1.path).not.toBe(r2.path)
  })

  it('uses os.homedir() when home is not specified', async () => {
    const text = 'default home test'
    const result = await persistLargeOutput({ fullText: text })
    expect(result.path.startsWith(os.homedir())).toBe(true)
    expect(fs.existsSync(result.path)).toBe(true)
    // Clean up
    fs.unlinkSync(result.path)
  })
})
