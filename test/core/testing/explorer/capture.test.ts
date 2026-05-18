// test/core/testing/explorer/capture.test.ts
//
// M1.T4 tests for the capture() function and runExploreCli 'capture' dispatch.
// Locked spec §4.1: capture mounts a fixture at one viewport, writes grid files.

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import React from 'react'
import { Text } from 'ink'
import type { FixtureDef } from '../../../../src/core/testing/explorer/types'
import { capture, runExploreCli } from '../../../../src/core/testing/explorer/index'

// ---------------------------------------------------------------------------
// Inline fixture helper — write a temporary .fixtures.tsx file for runExploreCli
// ---------------------------------------------------------------------------

let tmpDir: string | undefined
const tmpFixturePaths: string[] = []

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-explorer-test-'))
  return tmpDir
}

function cleanup() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
  for (const p of tmpFixturePaths) {
    fs.rmSync(p, { recursive: true, force: true })
  }
  tmpFixturePaths.length = 0
}

afterEach(cleanup)
afterAll(cleanup)

// ---------------------------------------------------------------------------
// Inline fixture def (used directly in capture() calls)
// ---------------------------------------------------------------------------
const inlineFixture: FixtureDef = {
  component: 'InlineText',
  cases: {
    hello: {
      render: () => React.createElement(Text, null, 'hello world'),
    },
  },
}

// Write a temporary fixture file inside the project src tree (so node_modules
// are reachable via normal resolution during dynamic import in vitest ESM).
// Dot-prefixed + .gitignored so an interrupted test run cannot pollute the repo.
function writeTmpFixture(_dir: string): string {
  const tmpTestDir = path.join(process.cwd(), '.tmp-ink-explorer-test')
  fs.mkdirSync(tmpTestDir, { recursive: true })
  const fixturePath = path.join(tmpTestDir, 'inline.fixtures.mts')
  fs.writeFileSync(
    fixturePath,
    `import React from 'react'
import { Text } from 'ink'

const fixture = {
  component: 'InlineText',
  cases: {
    hello: {
      render: () => React.createElement(Text, null, 'cli test frame'),
    },
  },
}

export default fixture
`,
  )
  // Register cleanup
  if (!tmpFixturePaths.includes(tmpTestDir)) tmpFixturePaths.push(tmpTestDir)
  return fixturePath
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('capture()', () => {
  it('mounts inline fixture and writes .ink-explorer/captures/ files', async () => {
    const dir = makeTmpDir()
    const outDir = path.join(dir, '.ink-explorer')

    const result = await capture({
      fixturePath: '__inline__',
      caseName: 'hello',
      viewport: { cols: 40, rows: 10 },
      cwd: dir,
      out: outDir,
      // Pass the fixture def directly for inline usage
      _fixtureDef: inlineFixture,
    } as Parameters<typeof capture>[0])

    // Must produce at least one grid
    expect(result.grids.length).toBeGreaterThan(0)

    // capturePath must exist
    expect(fs.existsSync(result.capturePath)).toBe(true)

    // Both .txt and .json must exist alongside capturePath
    const base = result.capturePath.replace(/\.(txt|json)$/, '')
    expect(fs.existsSync(`${base}.txt`)).toBe(true)
    expect(fs.existsSync(`${base}.json`)).toBe(true)

    // .txt should contain the asciiView of the last grid
    const txt = fs.readFileSync(`${base}.txt`, 'utf8')
    expect(txt).toMatch(/hello world/)
  })

  it('asciiView matches expected text content', async () => {
    const dir = makeTmpDir()
    const outDir = path.join(dir, '.ink-explorer')

    const result = await capture({
      fixturePath: '__inline__',
      caseName: 'hello',
      viewport: { cols: 40, rows: 10 },
      cwd: dir,
      out: outDir,
      _fixtureDef: inlineFixture,
    } as Parameters<typeof capture>[0])

    const grid = result.grids[result.grids.length - 1]!
    expect(grid.asciiView).toMatch(/hello world/)
  })

  it('runExploreCli capture with --viewport exits 0', async () => {
    const dir = makeTmpDir()
    const fixturePath = writeTmpFixture(dir)

    // runExploreCli dispatches capture; the fixture file exists on disk
    // and can be dynamically imported
    const code = await runExploreCli([
      'capture',
      fixturePath,
      '--viewport=40x10',
      `--out=${path.join(dir, '.ink-explorer')}`,
    ])

    expect(code).toBe(0)
  })
})
