// test/tui/bangShell.test.ts
import { describe, it, expect } from 'vitest'
import { runBangShell } from '../../src/tui/bangShell'

describe('runBangShell', () => {
  it('returns stdout for a successful command', async () => {
    const out = await runBangShell('echo hello', process.cwd())
    expect(out.trim()).toBe('hello')
  })

  it('includes [exit N] prefix for non-zero exit', async () => {
    const out = await runBangShell('exit 2', process.cwd())
    expect(out).toContain('[exit 2]')
  })
})
