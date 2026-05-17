/**
 * Tests for `buildDefaultResolverDeps()`. We deliberately wire each
 * dep with a stub so we can assert the *bindings* (which CLI argv go
 * through runGit for diff/staged, that the URL fetcher returns
 * `{ url, content }`, etc.) without touching real fs, network, or git.
 *
 * For the file/dir/image deps we use real `node:fs/promises` on a
 * temporary file — the test surface area is small enough that os.tmpdir
 * is faster than mocking `fs`, and it exercises the buffer-to-base64
 * round trip end-to-end.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { buildDefaultResolverDeps } from '../../src/promptContextReferences/deps'

let tmpDir = ''
let textPath = ''
let imagePath = ''
const pngMagic = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
])

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuka-deps-'))
  textPath = path.join(tmpDir, 'sample.txt')
  imagePath = path.join(tmpDir, 'sample.png')
  await fs.writeFile(textPath, 'hello deps')
  await fs.writeFile(imagePath, pngMagic)
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('buildDefaultResolverDeps', () => {
  test('readTextFile reads UTF-8 content', async () => {
    const deps = buildDefaultResolverDeps()
    expect(await deps.readTextFile(textPath)).toBe('hello deps')
  })

  test('readDirectory returns entry names', async () => {
    const deps = buildDefaultResolverDeps()
    const entries = await deps.readDirectory(tmpDir)
    expect(entries.sort()).toEqual(['sample.png', 'sample.txt'])
  })

  test('readLocalImage returns mimeType + base64 from disk', async () => {
    const deps = buildDefaultResolverDeps()
    const result = await deps.readLocalImage(imagePath)
    expect(result.mimeType).toBe('image/png')
    expect(result.dataBase64).toBe(pngMagic.toString('base64'))
  })

  test('getDiff routes through runGit with the upstream argv', async () => {
    const calls: string[][] = []
    const deps = buildDefaultResolverDeps({
      runGit: async args => {
        calls.push(args)
        return { stdout: 'diff body', stderr: '', code: 0 }
      },
    })
    expect(await deps.getDiff()).toBe('diff body')
    expect(calls).toEqual([['diff', '--no-ext-diff']])
  })

  test('getStagedDiff routes through runGit with --cached', async () => {
    const calls: string[][] = []
    const deps = buildDefaultResolverDeps({
      runGit: async args => {
        calls.push(args)
        return { stdout: 'staged body', stderr: '', code: 0 }
      },
    })
    expect(await deps.getStagedDiff()).toBe('staged body')
    expect(calls).toEqual([['diff', '--cached', '--no-ext-diff']])
  })

  test('fetchUrlText returns { url, content } from response', async () => {
    const original = globalThis.fetch
    const fakeResponse = {
      url: 'https://example.test/redirected',
      text: async () => 'page body',
    }
    globalThis.fetch = (async () => fakeResponse) as unknown as typeof fetch
    try {
      const deps = buildDefaultResolverDeps()
      const result = await deps.fetchUrlText('https://example.test/orig')
      expect(result).toEqual({
        url: 'https://example.test/redirected',
        content: 'page body',
      })
    } finally {
      globalThis.fetch = original
    }
  })

  test('options override individual deps without breaking the rest', async () => {
    const deps = buildDefaultResolverDeps({
      readTextFile: async () => 'override',
      fetchUrlText: async url => ({ url, content: 'stubbed' }),
    })
    expect(await deps.readTextFile('anything')).toBe('override')
    expect(await deps.fetchUrlText('https://stub/')).toEqual({
      url: 'https://stub/',
      content: 'stubbed',
    })
    // unrelated deps still work
    expect((await deps.readDirectory(tmpDir)).length).toBeGreaterThan(0)
  })
})
