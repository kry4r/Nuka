// test/cli/testPlan.test.ts
//
// Phase 9 §9.5 — acceptance tests for `nuka --test-plan <path>`.
// Spawns the CLI via tsx (mirroring test/cli/offline.test.ts) in three
// scenarios: passing plan, failing plan, parse-error plan.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { execa } from 'execa'
import { join } from 'node:path'
import os from 'node:os'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(os.tmpdir(), 'nuka-tp-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

const CLI = join(process.cwd(), 'src', 'cli.tsx')

async function runCli(args: string[], opts: { home?: string; cwd?: string } = {}) {
  return execa('npx', ['tsx', CLI, ...args], {
    reject: false,
    env: { ...process.env, HOME: opts.home ?? os.homedir() },
    cwd: opts.cwd ?? process.cwd(),
    timeout: 15_000,
  })
}

// -------------------------------------------------------------------------
// Scenario 1: passing plan
// -------------------------------------------------------------------------
describe('--test-plan CLI', () => {
  it('exits 0 and prints summary when plan passes', async () => {
    const planPath = join(tmpDir, 'pass.yaml')
    // A simple plan that renders the app and asserts something that will
    // always be present in the offline banner output.
    await writeFile(planPath, `
name: "passing plan"
steps:
  - render: app
  - assert:
      contains: "nuka"
`, 'utf8')

    const res = await runCli(['--test-plan', planPath])
    const out = res.stdout + res.stderr
    // Should succeed
    expect(res.exitCode).toBe(0)
    // pretty reporter shows summary
    expect(out).toMatch(/passed/)
  }, 20_000)

  // -------------------------------------------------------------------------
  // Scenario 2: failing plan
  // -------------------------------------------------------------------------
  it('exits 1 and shows failure details when an assertion fails', async () => {
    const planPath = join(tmpDir, 'fail.yaml')
    await writeFile(planPath, `
name: "failing plan"
steps:
  - render: app
  - assert:
      contains: "THIS_STRING_WILL_NEVER_APPEAR_XYZ_12345"
`, 'utf8')

    const res = await runCli(['--test-plan', planPath])
    expect(res.exitCode).toBe(1)
    const out = res.stdout + res.stderr
    expect(out).toMatch(/failed/)
  }, 20_000)

  // -------------------------------------------------------------------------
  // Scenario 3: parse-error plan
  // -------------------------------------------------------------------------
  it('exits 2 with parse error message for malformed YAML', async () => {
    const planPath = join(tmpDir, 'bad.yaml')
    // Missing required `steps` field → PlanError
    await writeFile(planPath, `
name: "no steps"
description: "this plan has no steps field"
`, 'utf8')

    const res = await runCli(['--test-plan', planPath])
    expect(res.exitCode).toBe(2)
    const out = res.stdout + res.stderr
    expect(out).toMatch(/parse error|steps/)
  }, 20_000)

  // -------------------------------------------------------------------------
  // Scenario 4: TAP reporter
  // -------------------------------------------------------------------------
  it('emits TAP v13 output with --reporter=tap', async () => {
    const planPath = join(tmpDir, 'tap.yaml')
    await writeFile(planPath, `
name: "tap plan"
steps:
  - render: app
`, 'utf8')

    const res = await runCli(['--test-plan', planPath, '--reporter=tap'])
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toMatch(/TAP version 13/)
    expect(res.stdout).toMatch(/^1\.\.1/m)
    expect(res.stdout).toMatch(/^ok 1/m)
  }, 20_000)

  // -------------------------------------------------------------------------
  // Scenario 5: JSON reporter
  // -------------------------------------------------------------------------
  it('emits valid JSON with --reporter=json', async () => {
    const planPath = join(tmpDir, 'json.yaml')
    await writeFile(planPath, `
name: "json plan"
steps:
  - render: app
`, 'utf8')

    const res = await runCli(['--test-plan', planPath, '--reporter=json'])
    expect(res.exitCode).toBe(0)
    let parsed: unknown
    expect(() => { parsed = JSON.parse(res.stdout) }).not.toThrow()
    expect((parsed as { ok: boolean }).ok).toBe(true)
  }, 20_000)
})
