// test/e2e/smoke.test.ts
//
// Phase 7: when offline mode landed (commit 82c9c5d) the CLI no longer
// hard-exits on missing providers; the proper assertion now lives in
// `test/cli/offline.test.ts`. Keep a smoke that runs without requiring
// a `dist/` build and confirms `--help`-ish surface.

import { describe, it, expect } from 'vitest'
import { execa } from 'execa'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

describe('cli smoke', () => {
  it('prints the offline banner instead of hard-exiting when no providers configured', async () => {
    const home = mkdtempSync(join(os.tmpdir(), 'nuka-smoke-'))
    const res = await execa('npx', ['tsx', 'src/cli.tsx'], {
      reject: false,
      env: { ...process.env, HOME: home },
      timeout: 2500,
      killSignal: 'SIGTERM',
    })
    // exits via timeout/SIGTERM, never via the old exit(2) "no providers"
    expect(res.exitCode).not.toBe(2)
    expect(`${res.stderr ?? ''}${res.stdout ?? ''}`).toMatch(/offline mode/i)
  }, 15_000)
})
