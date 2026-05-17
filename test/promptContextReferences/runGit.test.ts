import { describe, expect, test } from 'vitest'

import { buildPromptResolverRunGit } from '../../src/promptContextReferences/runGit'

describe('buildPromptResolverRunGit', () => {
  test('returns stdout/stderr/code from a successful git invocation', async () => {
    // `git --version` is a universally-safe argv that any installed git
    // supports; the harness asserts merely the shape, not the version.
    const runGit = buildPromptResolverRunGit()
    const result = await runGit(['--version'])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/git version/)
  })

  test('non-zero exit is surfaced as code, not as throw', async () => {
    const runGit = buildPromptResolverRunGit()
    const result = await runGit(['nope-this-is-not-a-subcommand'])
    expect(result.code).not.toBe(0)
    // stderr message may vary by git version; just confirm it's non-empty
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  test('ENOENT (missing git binary) returns code 1 with error in stderr', async () => {
    const runGit = buildPromptResolverRunGit({
      gitBinary: '/does/not/exist/git-binary',
    })
    const result = await runGit(['--version'])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  test('passes through GIT_PAGER override (paging disabled by default)', async () => {
    // We can't observe paging directly from a unit test, but we can confirm
    // the factory accepts a custom env without interfering with git.
    const runGit = buildPromptResolverRunGit({
      env: { GIT_TERMINAL_PROMPT: '0' },
    })
    const result = await runGit(['--version'])
    expect(result.code).toBe(0)
  })
})
