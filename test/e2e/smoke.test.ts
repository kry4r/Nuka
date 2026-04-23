import { describe, it, expect } from 'vitest'
import { execa } from 'execa'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

describe('cli smoke', () => {
  it('exits non-zero when no providers are configured', async () => {
    const home = mkdtempSync(join(os.tmpdir(), 'nuka-smoke-'))
    const res = await execa('node', ['dist/cli.js'], {
      reject: false,
      env: { HOME: home, PATH: process.env.PATH ?? '' },
      timeout: 3000,
    })
    expect(res.exitCode).toBe(2)
    expect(res.stderr).toMatch(/No providers configured/)
  })
})
