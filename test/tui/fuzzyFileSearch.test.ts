// test/tui/fuzzyFileSearch.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fuzzyFileSearch } from '../../src/tui/PromptInput/fuzzyFileSearch'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nuka-fuzz-'))
  // Create a small file tree
  await mkdir(path.join(tmpDir, 'src'), { recursive: true })
  await mkdir(path.join(tmpDir, 'src', 'tui'), { recursive: true })
  await mkdir(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(path.join(tmpDir, '.git'), { recursive: true })
  await mkdir(path.join(tmpDir, 'dist'), { recursive: true })
  await writeFile(path.join(tmpDir, 'README.md'), '')
  await writeFile(path.join(tmpDir, 'src', 'index.ts'), '')
  await writeFile(path.join(tmpDir, 'src', 'tui', 'App.tsx'), '')
  await writeFile(path.join(tmpDir, 'src', 'tui', 'palette.ts'), '')
  await writeFile(path.join(tmpDir, 'node_modules', 'pkg', 'index.js'), '')
  await writeFile(path.join(tmpDir, '.git', 'HEAD'), '')
  await writeFile(path.join(tmpDir, 'dist', 'cli.js'), '')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('fuzzyFileSearch', () => {
  it('exact substring match is ranked first', async () => {
    const results = await fuzzyFileSearch({ query: 'App', cwd: tmpDir })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toContain('App')
  })

  it('subsequence matches return', async () => {
    // 'plt' is a subsequence of 'palette'
    const results = await fuzzyFileSearch({ query: 'plt', cwd: tmpDir })
    expect(results.some(r => r.includes('palette'))).toBe(true)
  })

  it('respects limit', async () => {
    const results = await fuzzyFileSearch({ query: '', cwd: tmpDir, limit: 2 })
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('excludes node_modules, .git, and dist', async () => {
    const results = await fuzzyFileSearch({ query: '', cwd: tmpDir })
    expect(results.some(r => r.includes('node_modules'))).toBe(false)
    expect(results.some(r => r.includes('.git'))).toBe(false)
    expect(results.some(r => r.includes('dist'))).toBe(false)
  })
})
