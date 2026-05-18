// test/build/explorerBundle.test.ts
//
// M0.T3 — assert that after `npm run build`:
//   1. dist/explorer.js exists
//   2. dist/cli.js size <= 720 * 1024 bytes (720 KB cap)
//   3. dist/cli.js does not statically reference core/testing/explorer
//      (the dynamic URL-computed import is allowed — it appears as a string
//      inside `new URL(…)`, not after `from`)

import { describe, it, expect } from 'vitest'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const repo = path.resolve(__dirname, '../..')
const distCli = path.join(repo, 'dist/cli.js')
const distExplorer = path.join(repo, 'dist/explorer.js')

// Build once for this test file.
// Vitest runs in the repo root; the build is fast (~200ms).
execSync('npm run build', { cwd: repo, stdio: 'pipe' })

describe('explorer bundle gate (M0.T3)', () => {
  it('dist/explorer.js exists after build', () => {
    expect(existsSync(distExplorer)).toBe(true)
  })

  it('dist/cli.js size <= 720 KB', () => {
    const size = statSync(distCli).size
    const cap = 720 * 1024 // 737280 bytes
    expect(size).toBeLessThanOrEqual(cap)
  })

  it('dist/cli.js has no static from-import of core/testing/explorer', () => {
    const content = readFileSync(distCli, 'utf8')
    // The dev-fallback URL string is acceptable; we reject only `from '…explorer…'`
    expect(content).not.toMatch(/from ['"].*core\/testing\/explorer/)
  })
})
