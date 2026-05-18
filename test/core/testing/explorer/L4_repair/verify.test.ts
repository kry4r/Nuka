// test/core/testing/explorer/L4_repair/verify.test.ts
//
// M5.T2 — RED-first tests for the in-process verify() helper.
// See locked spec §4.6 step 3.
//
// Contract:
//   * verify({ fixturePath, caseName, viewport, cwd }) returns
//     { clean: true } or { clean: false; violations: Violation[] }.
//   * Re-mounts the target fixture INSIDE the runner process — no spawn,
//     no execa, no worker_threads. Pure in-process.
//   * Module-cache awareness: between two verify() calls the fixture file
//     on disk may change. The second call must observe the new content.
//
// Note (ESM cache limitation): tsImport's per-call evaluation gives us a
// fresh evaluation of the *entry* fixture file but NOT of arbitrary
// transitive imports. This test patches the fixture file itself, which is
// exactly the supported case. Verify also documents this in its own header.

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
import path from 'node:path'
import type { Viewport } from '../../../../../src/core/testing/explorer/types'

// Dot-prefixed under repo root so the .gitignore /.tmp-verify-test/ entry
// hides this from git. Same convention as M2/M3/M4 tmp test roots.
const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const TMP_ROOT = path.join(REPO_ROOT, '.tmp-verify-test')

function cleanup() {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true })
}

afterEach(() => cleanup())
afterAll(() => cleanup())

// Fixture content with a single case that renders a short string —
// "ok-content" fits inside any reasonable viewport, no violations.
const CLEAN_FIXTURE_SRC = `
import React from 'react'
import { Text } from 'ink'
import type { FixtureDef } from '../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'VerifyTest',
  cases: {
    main: {
      render: () => React.createElement(Text, null, 'ok-content'),
    },
  },
}

export default fixture
`

// Same component+case names but the render emits a <Static> block, which
// trips the noStaticWrites invariant (fixture doesn't opt-in via
// allowStatic). We deliberately avoid 'X'.repeat() based overflow because
// ink wraps long text at the viewport boundary, so the cell grid never
// sees a row wider than cols and noContentBeyondColumns won't fire.
const BROKEN_FIXTURE_SRC = `
import React from 'react'
import { Static, Text } from 'ink'
import type { FixtureDef } from '../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'VerifyTest',
  cases: {
    main: {
      render: () =>
        React.createElement(
          Static,
          { items: ['line-1', 'line-2'] },
          (item: string) => React.createElement(Text, { key: item }, item),
        ),
    },
  },
}

export default fixture
`

const VIEWPORT: Viewport = { cols: 20, rows: 6 }

describe('L4_repair/verify — in-process re-mount + L0/L1', () => {
  it('returns { clean: true } on a fixture with no invariant violations', async () => {
    mkdirSync(TMP_ROOT, { recursive: true })
    const fixturePath = path.join(TMP_ROOT, 'clean.fixtures.tsx')
    writeFileSync(fixturePath, CLEAN_FIXTURE_SRC, 'utf8')

    const { verify } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/verify'
    )
    const res = await verify({
      fixturePath,
      caseName: 'main',
      viewport: VIEWPORT,
      cwd: REPO_ROOT,
    })
    expect(res.clean).toBe(true)
  })

  it('reflects on-disk fixture edits between successive calls (cache invalidation)', async () => {
    mkdirSync(TMP_ROOT, { recursive: true })
    const fixturePath = path.join(TMP_ROOT, 'patchable.fixtures.tsx')
    writeFileSync(fixturePath, CLEAN_FIXTURE_SRC, 'utf8')

    const { verify } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/verify'
    )

    // First call: clean fixture → clean.
    const first = await verify({
      fixturePath,
      caseName: 'main',
      viewport: VIEWPORT,
      cwd: REPO_ROOT,
    })
    expect(first.clean).toBe(true)

    // Patch the source on disk to a render that triggers noContentBeyondColumns.
    writeFileSync(fixturePath, BROKEN_FIXTURE_SRC, 'utf8')

    // Second call: must see the new content.
    const second = await verify({
      fixturePath,
      caseName: 'main',
      viewport: VIEWPORT,
      cwd: REPO_ROOT,
    })
    expect(second.clean).toBe(false)
    if (second.clean === false) {
      expect(second.violations.length).toBeGreaterThan(0)
      expect(second.violations.some((v) => v.rule === 'noStaticWrites')).toBe(true)
    }
  })

  it('does NOT spawn a subprocess (pure in-process invariant)', async () => {
    // Hard structural check: the verify.ts source file must not import
    // child_process, execa, or worker_threads. The grep in the M5 acceptance
    // doc covers the whole directory; this test asserts the verify module
    // specifically.
    const { readFileSync } = await import('node:fs')
    const verifySrc = readFileSync(
      path.join(REPO_ROOT, 'src/core/testing/explorer/L4_repair/verify.ts'),
      'utf8',
    )
    expect(verifySrc).not.toMatch(/child_process/)
    expect(verifySrc).not.toMatch(/from ['"]execa['"]/)
    expect(verifySrc).not.toMatch(/worker_threads/)
  })

  it('throws if the fixture path does not exist', async () => {
    const { verify } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/verify'
    )
    const missing = path.join(TMP_ROOT, 'does-not-exist.fixtures.tsx')
    await expect(
      verify({
        fixturePath: missing,
        caseName: 'main',
        viewport: VIEWPORT,
        cwd: REPO_ROOT,
      }),
    ).rejects.toThrow()
  })
})
