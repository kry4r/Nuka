// test/build/explorerBundle.test.ts
//
// M0.T3 — assert that after `npm run build`:
//   1. dist/explorer.js exists
//   2. dist/cli.js size <= 720 * 1024 bytes (720 KB cap)
//   3. dist/cli.js does not statically reference core/testing/explorer
//      (the dynamic URL-computed import is allowed — it appears as a string
//      inside `new URL(…)`, not after `from`)

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { CLI_BUNDLE_CEILING_BYTES } from './_constants'

const repo = path.resolve(__dirname, '../..')
const distCli = path.join(repo, 'dist/cli.js')
const distExplorer = path.join(repo, 'dist/explorer.js')

describe('explorer bundle gate (M0.T3)', () => {
  beforeAll(() => {
    // Run the production build with the npm script so we exercise the same
    // path CI/users do. spawnSync is synchronous which keeps the test simple.
    execSync('npm run build', { cwd: repo, stdio: 'pipe', timeout: 60_000 })
  }, 60_000)

  it('dist/explorer.js exists after build', () => {
    expect(existsSync(distExplorer)).toBe(true)
  })

  it(`dist/cli.js size <= ${CLI_BUNDLE_CEILING_BYTES / 1024} KB`, () => {
    const size = statSync(distCli).size
    expect(size).toBeLessThanOrEqual(CLI_BUNDLE_CEILING_BYTES)
  })

  it('dist/cli.js has no static from-import of core/testing/explorer', () => {
    const content = readFileSync(distCli, 'utf8')
    // The dev-fallback URL string is acceptable; we reject only `from '…explorer…'`
    expect(content).not.toMatch(/from ['"].*core\/testing\/explorer/)
  })
})
