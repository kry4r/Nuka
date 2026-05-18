// test/core/testing/explorer/L4_repair/verify.test.ts
//
// M5.T2 — RED-first tests for the in-process verify() helper.
// See locked spec §4.6 step 3.
//
// Contract:
//   * verify({ fixturePath, caseName, viewport, cwd }) returns
//     { clean: true } or { clean: false; violations: Violation[] }.
//   * Re-mounts the target fixture via worker_threads — same PID, separate
//     V8 isolate, fresh module graph (transitive deps included).
//     Spec §4.6/§509 "no subprocess" = no child_process/execa; worker_threads
//     shares the same process PID so this is NOT a subprocess per spec intent.
//   * Module-cache awareness: between two verify() calls the fixture file
//     AND any of its transitive imports may change on disk. Both calls must
//     reflect the on-disk state at call time.
//
// M6.P0 note: the transitive-dep test below (Fix 3) is RED on the current
// copy-rename verify.ts implementation (which only freshens the entry file).
// It turns GREEN after the worker_threads refactor in the GREEN commit.

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

  it('does NOT use child_process or execa (spec §4.6/§509 — worker_threads is allowed)', async () => {
    // Hard structural check: the verify.ts source file must not import
    // child_process or execa. worker_threads IS permitted — it runs in the
    // same PID as a separate V8 isolate (not a subprocess per spec intent).
    const { readFileSync } = await import('node:fs')
    const verifySrc = readFileSync(
      path.join(REPO_ROOT, 'src/core/testing/explorer/L4_repair/verify.ts'),
      'utf8',
    )
    expect(verifySrc).not.toMatch(/child_process/)
    expect(verifySrc).not.toMatch(/from ['"]execa['"]/)
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

  // ---------------------------------------------------------------------------
  // Fix 3 (M6.P0) — transitive-dep test: verify() must see edits to files
  // imported BY the fixture, not just the fixture entry itself.
  //
  // This test is intentionally RED on the pre-Fix-2 copy-rename strategy
  // because that strategy only freshens the entry file's module-cache key;
  // transitive imports still hit the original cached entries. It turns GREEN
  // after the worker_threads refactor gives every verify() call its own fresh
  // V8 module registry.
  // ---------------------------------------------------------------------------
  it('reflects on-disk edits to transitive dependencies (Fix 3 — RED before worker refactor)', async () => {
    mkdirSync(TMP_ROOT, { recursive: true })

    // sharedSource.ts — a transitive dep; fixture imports it
    const sharedSourcePath = path.join(TMP_ROOT, 'sharedSource.ts')
    writeFileSync(
      sharedSourcePath,
      `export function getValue() { return 'BEFORE' }\n`,
      'utf8',
    )

    // fixture.ts imports sharedSource and renders getValue()
    // The fixture uses mustContain: ['AFTER'] so it fails when it sees 'BEFORE'.
    const fixturePath = path.join(TMP_ROOT, 'transitive.fixtures.tsx')
    writeFileSync(
      fixturePath,
      `
import React from 'react'
import { Text } from 'ink'
import { getValue } from './sharedSource'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'TransitiveTest',
  cases: {
    main: {
      render: () => React.createElement(Text, null, getValue()),
      mustContain: ['AFTER'],
    },
  },
}

export default fixture
`,
      'utf8',
    )

    const { verify } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/verify'
    )

    // Step 3: First verify — fixture contains 'BEFORE', mustContain=['AFTER'] → fails.
    const firstResult = await verify({
      fixturePath,
      caseName: 'main',
      viewport: VIEWPORT,
      cwd: REPO_ROOT,
    })
    expect(firstResult.clean).toBe(false)

    // Step 4: Rewrite sharedSource.ts to return 'AFTER'.
    writeFileSync(
      sharedSourcePath,
      `export function getValue() { return 'AFTER' }\n`,
      'utf8',
    )

    // Step 5: Second verify — must pick up the transitive dep change.
    // On current verify.ts (copy-rename only) this FAILS (still sees BEFORE).
    // After the worker_threads refactor this PASSES (fresh module registry).
    const secondResult = await verify({
      fixturePath,
      caseName: 'main',
      viewport: VIEWPORT,
      cwd: REPO_ROOT,
    })
    expect(secondResult.clean).toBe(true)
  }, 60000) // generous timeout for worker startup
})
