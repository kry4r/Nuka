// test/cli/offline.test.ts
//
// Phase 7 §7.2 acceptance — offline mode no longer hard-exits when no
// providers are configured; the CLI prints the offline banner and waits
// for the user to launch the wizard via /settings or `nuka init`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { execa } from 'execa'
import { join } from 'node:path'
import os from 'node:os'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-offline-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('CLI offline boot', () => {
  it('does not exit immediately when config has zero providers (waits for input)', async () => {
    // Run the CLI under tsx with a stdin that's NOT a TTY but doesn't close
    // the process; we kill it after a short wait. Pre-Phase-7 the process
    // exited 2 with "No providers configured" within ms; now it stays alive.
    const child = execa('npx', ['tsx', 'src/cli.tsx'], {
      reject: false,
      env: { ...process.env, HOME: home },
      cwd: process.cwd(),
      timeout: 4000,
      // ensure it is killed on timeout
      killSignal: 'SIGTERM',
    })
    // wait briefly, then kill if still running
    await new Promise(r => setTimeout(r, 1500))
    let killed = false
    if (!child.killed && child.exitCode === null && child.exitCode === undefined) {
      killed = true
      child.kill('SIGTERM')
    } else if (child.exitCode === null) {
      killed = true
      child.kill('SIGTERM')
    }
    const res = await child
    // The banner is printed to stderr in offline mode.
    const out = `${res.stderr ?? ''}${res.stdout ?? ''}`
    expect(out).toMatch(/offline mode/i)
    // Critically: the process was still alive at +1.5s (we had to kill it).
    // exitCode 143 = SIGTERM, null = killed, but in any case NOT exit 2 from
    // the old "no providers configured" hard-stop.
    expect(res.exitCode).not.toBe(2)
    expect(killed || res.signal === 'SIGTERM').toBe(true)
  }, 15_000)
})
