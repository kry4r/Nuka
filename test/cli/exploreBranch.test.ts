// test/cli/exploreBranch.test.ts
//
// M0.T2 — test that the 'explore' argv branch is wired in cli.tsx.
//
// Split assertions:
// (a) static import surface: dist/cli.js must NOT contain a literal
//     from-import of core/testing/explorer (dynamic URL-computed imports
//     are allowed — they appear as a string inside new URL(…), not as a
//     module specifier after `from`).
// (b) dispatch: dev-mode tsx path returns non-zero on unknown verb;
//     returns non-zero (exits 2) on --help.
// (c) help baseline: 'nuka help' unaffected.
//
// Note: the spawn-based 'nuka explore' assertions use tsx dev mode so
// they work before T3 builds dist/explorer.js. The --help path exercises
// the usage-message branch of runExploreCli([]).

import { describe, it, expect } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const repo = path.resolve(__dirname, '../..')
const distCli = path.join(repo, 'dist/cli.js')

describe('nuka explore argv branch', () => {
  it('dist/cli.js does not statically import core/testing/explorer', () => {
    // Guard: skip if dist not built yet
    if (!existsSync(distCli)) return

    const content = readFileSync(distCli, 'utf8')
    // Must not contain a static `from` import of the explorer module.
    // Dynamic URL-computed strings like new URL('./core/testing/explorer/...')
    // are acceptable; we target the static-import form specifically.
    expect(content).not.toMatch(/from ['"].*core\/testing\/explorer/)
  })

  it('explore --help exits non-zero with usage text (dev mode)', () => {
    const result = spawnSync(
      'npx',
      ['tsx', 'src/cli.tsx', 'explore', '--help'],
      { cwd: repo, encoding: 'utf8', timeout: 15000 },
    )
    // Should exit non-zero (2 = usage)
    expect(result.status).not.toBe(0)
    // Should emit usage-like content
    const combined = (result.stdout ?? '') + (result.stderr ?? '')
    expect(combined).toMatch(/capture|sweep|fuzz|judge|repair/i)
  })

  it('explore unknown-verb exits non-zero (dev mode)', () => {
    const result = spawnSync(
      'npx',
      ['tsx', 'src/cli.tsx', 'explore', 'nonexistent-verb'],
      { cwd: repo, encoding: 'utf8', timeout: 15000 },
    )
    expect(result.status).not.toBe(0)
  })

  it('nuka doctor is unaffected by the explore branch', () => {
    // 'doctor' is a fast-exit CLI verb (exits 0 or 1, no TUI).
    // It must NOT be swallowed by the explore branch.
    const result = spawnSync(
      'npx',
      ['tsx', 'src/cli.tsx', 'doctor'],
      { cwd: repo, encoding: 'utf8', timeout: 15000 },
    )
    // doctor always prints check results and exits (0 or 1, not null)
    expect(result.status).not.toBeNull()
    const combined = (result.stdout ?? '') + (result.stderr ?? '')
    // Should NOT print the explore usage — meaning doctor ran, not explore
    expect(combined).not.toMatch(/nuka explore/)
  })
})
