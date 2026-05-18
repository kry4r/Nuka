// test/core/testing/explorer/L4_repair/repair.test.ts
//
// M5.T4 — RED-first end-to-end + idempotency for the repair verb.
// See locked spec §4.6 steps 4–5 and plan M5.T4.
//
// Flow under test:
//   1. read a dump file from .tmp-repair-test/.ink-explorer/failures/foo.md
//   2. run the subagent (mocked: scripted read → edit → verify → clean)
//   3. promote a regression fixture file to <out>/<component>/
//      regression-<id>.fixtures.tsx
//   4. move the dump from failures/ to resolved/
//   5. on a re-run with the dump already in resolved/: idempotent
//      success, no throw

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const TMP_ROOT = path.join(REPO_ROOT, '.tmp-repair-test')

function cleanup() {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true })
}
afterEach(() => cleanup())
afterAll(() => cleanup())

// Synthetic fixture sources for the subagent's verify loop.
const CLEAN_FIXTURE_SRC = `
import React from 'react'
import { Text } from 'ink'
import type { FixtureDef } from '../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'RepairTest',
  cases: { main: { render: () => React.createElement(Text, null, 'ok') } },
}
export default fixture
`

type MockResponse = {
  stop_reason: 'tool_use' | 'end_turn'
  content: Array<
    | { type: 'text'; text: string }
    | {
        type: 'tool_use'
        id: string
        name: string
        input: Record<string, unknown>
      }
  >
}

function scripted(seq: MockResponse[]) {
  let turn = 0
  return async () => {
    if (turn >= seq.length) {
      return {
        stop_reason: 'tool_use' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: `toolu_default_${turn}`,
            name: 'read_file',
            input: { path: 'README.md' },
          },
        ],
      }
    }
    return seq[turn++]!
  }
}

/**
 * Like scripted(), but also tracks how many times the client was called.
 * Used in the idempotency test to assert the subagent is never invoked on
 * the second run (when the dump is already in resolved/).
 */
function scriptedCounted(seq: MockResponse[]): {
  client: ReturnType<typeof scripted>
  callCount: () => number
} {
  let count = 0
  const inner = scripted(seq)
  const client = async (...args: Parameters<typeof inner>) => {
    count++
    return inner(...args)
  }
  return { client, callCount: () => count }
}

function writeDumpFile(args: {
  failuresDir: string
  id: string
  fixturePath: string
}): string {
  const filePath = path.join(args.failuresDir, `${args.id}.md`)
  const body = [
    `# Failure dump: ${args.id}`,
    ``,
    `- **component:** RepairTest`,
    `- **case:** main`,
    `- **viewport:** 20×6`,
    `- **timestamp:** 2026-05-18T00:00:00.000Z`,
    `- **fixturePath:** ${args.fixturePath}`,
    ``,
    `## Violations`,
    ``,
    `### noStaticWrites (error)`,
    ``,
    `unexpected Static write`,
    ``,
    `## ASCII view`,
    ``,
    '```',
    'line-1',
    'line-2',
    '```',
    ``,
  ].join('\n')
  writeFileSync(filePath, body, 'utf8')
  return filePath
}

describe('repair (M5.T4) — end-to-end + idempotency', () => {
  it('end-to-end: read dump → subagent (mock) → promote → move to resolved/', async () => {
    mkdirSync(TMP_ROOT, { recursive: true })
    const failuresDir = path.join(TMP_ROOT, '.ink-explorer', 'failures')
    const resolvedDir = path.join(TMP_ROOT, '.ink-explorer', 'resolved')
    const fixtureOutDir = path.join(TMP_ROOT, 'fixtures-out')
    mkdirSync(failuresDir, { recursive: true })
    mkdirSync(resolvedDir, { recursive: true })
    mkdirSync(fixtureOutDir, { recursive: true })

    // Source fixture the dump points at.
    const fixturePath = path.join(TMP_ROOT, 'src.fixtures.tsx')
    writeFileSync(fixturePath, CLEAN_FIXTURE_SRC, 'utf8')

    const id = 'roundtrip-001'
    const dumpPath = writeDumpFile({ failuresDir, id, fixturePath })

    // Subagent script: turn1=verify→clean (no edit needed, fixture is
    // already clean). Repair should still produce a verified outcome.
    const script: MockResponse[] = [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'verify', input: {} },
        ],
      },
    ]

    const { repair } = await import(
      '../../../../../src/core/testing/explorer/repair'
    )
    const res = await repair({
      failureId: id,
      cwd: TMP_ROOT,
      apiKey: 'sk-fake',
      _client: scripted(script),
      fixtureOutDir,
    })

    expect(res.promoted).toBe(true)
    // Regression fixture must exist at
    // <fixtureOutDir>/<component>/regression-<id>.fixtures.tsx
    const expectedFixture = path.join(
      fixtureOutDir,
      'RepairTest',
      `regression-${id}.fixtures.tsx`,
    )
    expect(existsSync(expectedFixture)).toBe(true)
    const fixtureBody = readFileSync(expectedFixture, 'utf8')
    // Fix 6 (M6.P0): deeper assertions — named export, back-link, viewport pin
    expect(fixtureBody).toMatch(new RegExp(`regression_${id}`))
    expect(fixtureBody).toContain(fixturePath)
    expect(fixtureBody).toMatch(/viewport.*\d+.*\d+/)

    // Dump moved from failures/ to resolved/.
    expect(existsSync(dumpPath)).toBe(false)
    const resolvedPath = path.join(resolvedDir, `${id}.md`)
    expect(existsSync(resolvedPath)).toBe(true)
  })

  it('idempotent: running repair twice on the same dump does not throw', async () => {
    mkdirSync(TMP_ROOT, { recursive: true })
    const failuresDir = path.join(TMP_ROOT, '.ink-explorer', 'failures')
    const resolvedDir = path.join(TMP_ROOT, '.ink-explorer', 'resolved')
    const fixtureOutDir = path.join(TMP_ROOT, 'fixtures-out')
    mkdirSync(failuresDir, { recursive: true })
    mkdirSync(resolvedDir, { recursive: true })
    mkdirSync(fixtureOutDir, { recursive: true })

    const fixturePath = path.join(TMP_ROOT, 'src.fixtures.tsx')
    writeFileSync(fixturePath, CLEAN_FIXTURE_SRC, 'utf8')

    const id = 'idem-001'
    writeDumpFile({ failuresDir, id, fixturePath })

    const script: MockResponse[] = [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'verify', input: {} },
        ],
      },
    ]

    const { repair } = await import(
      '../../../../../src/core/testing/explorer/repair'
    )
    const { client: firstClient } = scriptedCounted(script)
    const first = await repair({
      failureId: id,
      cwd: TMP_ROOT,
      apiKey: 'sk-fake',
      _client: firstClient,
      fixtureOutDir,
    })
    expect(first.promoted).toBe(true)

    // Second run — dump has already been moved to resolved/. Repair must:
    //  1. Not throw; treat as a no-op success.
    //  2. NEVER invoke the subagent client (fast-path before any API call).
    //  3. The resolved file still exists; failures/ dir is empty.
    const { client: secondClient, callCount } = scriptedCounted(script)
    const second = await repair({
      failureId: id,
      cwd: TMP_ROOT,
      apiKey: 'sk-fake',
      _client: secondClient,
      fixtureOutDir,
    })
    expect(second.promoted).toBe(true)
    expect(typeof second.summary).toBe('string')
    // Fix 6 (M6.P0): subagent must NOT be invoked on the idempotent fast-path.
    expect(callCount()).toBe(0)
    // Resolved file still present.
    expect(existsSync(path.join(resolvedDir, `${id}.md`))).toBe(true)
    // Failures dir empty.
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(failuresDir)).toHaveLength(0)
  })
})
