// test/core/testing/explorer/L4_repair/subagent.test.ts
//
// M5.T3 — RED-first tests for runRepairSubagent (Opus tool-loop).
// See locked spec §4.6 step 2.
//
// Contract:
//   runRepairSubagent({failure, cwd, apiKey, maxTurns?, timeoutMs?,
//                      _client?, _now?}) →
//     { status: 'verified' | 'exhausted' | 'timeout', edits, summary }
//
// The subagent exposes 4 tools to the model:
//   - read_file({path})            → { content }
//   - grep({pattern, glob?})       → { matches }
//   - edit_file({path, old_string, new_string}) → { ok, error? }
//   - verify()                     → { clean, violations? }
//
// Test architecture: a DI mock client (`_client`) yields canned
// tool_use responses turn by turn so we can exercise verified / exhausted
// / timeout paths without an API key.

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
import path from 'node:path'
import type { FailureRecord } from '../../../../../src/core/testing/explorer/types'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const TMP_ROOT = path.join(REPO_ROOT, '.tmp-subagent-test')

function cleanup() {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true })
}

afterEach(() => cleanup())
afterAll(() => cleanup())

// Minimal failure record — only fields the subagent reads on entry.
// We populate FailureRecord.fixturePath so the subagent's `verify` tool
// knows what to re-mount. The field is optional on the type (M2 dumps
// pre-date it) but M5 dumps always populate it.
function makeFailure(fixturePath: string): FailureRecord {
  return {
    id: 'subagent-test-001',
    component: 'VerifyTest',
    fixtureCase: 'main',
    viewport: { cols: 20, rows: 6 },
    violations: [
      {
        rule: 'noStaticWrites',
        severity: 'error',
        message: 'unexpected Static write',
      },
    ],
    asciiView: 'line-1\nline-2\n',
    fixturePath,
    timestamp: '2026-05-18T00:00:00.000Z',
  }
}

// Shape of a single mock-client turn: stop_reason + content blocks.
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
  usage?: { input_tokens?: number; output_tokens?: number }
}

// The mock client replays a scripted sequence of turns.
function makeScriptedClient(script: MockResponse[]) {
  let turn = 0
  return async () => {
    if (turn >= script.length) {
      // Default tail: read_file forever (used by the exhausted-path test).
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
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    }
    return script[turn++]!
  }
}

const CLEAN_FIXTURE_SRC = `
import React from 'react'
import { Text } from 'ink'
import type { FixtureDef } from '../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'VerifyTest',
  cases: { main: { render: () => React.createElement(Text, null, 'fixed') } },
}
export default fixture
`

describe('L4_repair/subagent — runRepairSubagent', () => {
  it('verified path: read → edit → verify(clean) → status=verified', async () => {
    mkdirSync(TMP_ROOT, { recursive: true })
    const fixturePath = path.join(TMP_ROOT, 'verified.fixtures.tsx')
    writeFileSync(fixturePath, CLEAN_FIXTURE_SRC, 'utf8')

    // The 3-turn synthetic script:
    //   turn 1 → read_file (subagent looks at the fixture)
    //   turn 2 → edit_file (subagent makes a no-op edit just so EditLog
    //                       contains one entry)
    //   turn 3 → verify    (verify reports clean → status=verified)
    const script: MockResponse[] = [
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'read_file',
            input: { path: fixturePath },
          },
        ],
      },
      {
        // Mixed content block: text reasoning followed by a tool_use call.
        // Locks the parser's handling of assistant turns that contain both
        // text and tool_use blocks (the parser must not drop the tool_use
        // because a text block preceded it).
        stop_reason: 'tool_use',
        content: [
          {
            type: 'text',
            text: "I'll edit the fixture to fix the violation.",
          },
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'edit_file',
            input: {
              path: fixturePath,
              old_string: "'fixed'",
              new_string: "'fixed-2'",
            },
          },
        ],
      },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_3',
            name: 'verify',
            input: {},
          },
        ],
      },
    ]

    const { runRepairSubagent } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/subagent'
    )
    const failure = makeFailure(fixturePath)
    const res = await runRepairSubagent({
      failure,
      cwd: REPO_ROOT,
      apiKey: 'sk-fake',
      _client: makeScriptedClient(script),
    })

    expect(res.status).toBe('verified')
    expect(res.edits).toHaveLength(1)
    expect(res.edits[0]?.path).toBe(fixturePath)
    expect(res.edits[0]?.before).toContain("'fixed'")
    expect(res.edits[0]?.after).toContain("'fixed-2'")
    expect(typeof res.summary).toBe('string')
  })

  it('exhausted path: turn budget reached without verify-clean → status=exhausted', async () => {
    mkdirSync(TMP_ROOT, { recursive: true })
    const fixturePath = path.join(TMP_ROOT, 'exhaust.fixtures.tsx')
    writeFileSync(fixturePath, CLEAN_FIXTURE_SRC, 'utf8')

    // Empty script → the scripted client's default-tail logic returns
    // read_file forever. After maxTurns the subagent must give up.
    const { runRepairSubagent } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/subagent'
    )
    const failure = makeFailure(fixturePath)
    const res = await runRepairSubagent({
      failure,
      cwd: REPO_ROOT,
      apiKey: 'sk-fake',
      maxTurns: 4,
      _client: makeScriptedClient([]),
    })
    expect(res.status).toBe('exhausted')
    expect(res.edits).toHaveLength(0)
  })

  it('timeout path: wall-clock budget exhausted mid-loop → status=timeout', async () => {
    mkdirSync(TMP_ROOT, { recursive: true })
    const fixturePath = path.join(TMP_ROOT, 'timeout.fixtures.tsx')
    writeFileSync(fixturePath, CLEAN_FIXTURE_SRC, 'utf8')

    // Use a controllable clock: first reading is t=0, second is past
    // timeoutMs. The subagent must detect the budget overshoot and bail.
    let t = 0
    const fakeNow = () => {
      const cur = t
      t += 1000 // advance one second per call
      return cur
    }

    const { runRepairSubagent } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/subagent'
    )
    const failure = makeFailure(fixturePath)
    const res = await runRepairSubagent({
      failure,
      cwd: REPO_ROOT,
      apiKey: 'sk-fake',
      maxTurns: 100,
      timeoutMs: 500, // smaller than a single 1000ms tick
      _client: makeScriptedClient([]),
      _now: fakeNow,
    })
    expect(res.status).toBe('timeout')
  })
})
