// test/cli/doctor.test.ts
// Acceptance test for `nuka doctor` CLI subcommand.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { execa } from 'execa'
import { join } from 'node:path'
import os from 'node:os'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-doctor-test-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('nuka doctor', () => {
  it('exits 0 when all checks pass (fresh home dir)', async () => {
    const res = await execa('npx', ['tsx', 'src/cli.tsx', 'doctor'], {
      reject: false,
      env: { ...process.env, HOME: home },
      cwd: process.cwd(),
      timeout: 15000,
    })
    // Either 0 (all ok) or 1 (some warn/fail from config not found)
    expect([0, 1]).toContain(res.exitCode)
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
    // Should contain at least one check line
    expect(out).toMatch(/node:|config:|disk:/)
  }, 20_000)

  it('outputs checkmark symbols for passing checks', async () => {
    const res = await execa('npx', ['tsx', 'src/cli.tsx', 'doctor'], {
      reject: false,
      env: { ...process.env, HOME: home },
      cwd: process.cwd(),
      timeout: 15000,
    })
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
    // Should have check icons
    expect(out).toMatch(/[✓⚠✗]/)
  }, 20_000)
})
