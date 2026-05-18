// test/core/testing/explorer/capture.test.ts
//
// M1.T4 tests for the capture() function and runExploreCli 'capture' dispatch.
// Locked spec §4.1: capture mounts a fixture at one viewport, writes grid files.

import { describe, it, expect, afterEach } from 'vitest'
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

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-explorer-test-'))
  return tmpDir
}

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

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

// Write a temporary fixture file that exports a default FixtureDef
function writeTmpFixture(dir: string): string {
  const fixturePath = path.join(dir, 'inline.fixtures.tsx')
  fs.writeFileSync(
    fixturePath,
    `import React from 'react'
import { Text } from 'ink'
import type { FixtureDef } from '${path.resolve('/data/xtzhang/Nuka/src/core/testing/explorer/types.js').replace(/\.tsx?$/, '')}'

const fixture: FixtureDef = {
  component: 'InlineText',
  cases: {
    hello: {
      render: () => React.createElement(Text, null, 'hello world'),
    },
  },
}

export default fixture
`,
  )
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
