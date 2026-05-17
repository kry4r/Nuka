/**
 * `runGit` factory for the prompt-mentions resolver.
 *
 * Wraps execa with paging disabled (GIT_PAGER=cat / PAGER=cat) and
 * coerces the result into the resolver's `{ stdout, stderr, code }`
 * shape. The CLI binary defaults to `git` on PATH — callers can
 * override via the optional `gitBinary` argument (used by tests).
 *
 * Ported from Nuka-Code's `buildPromptResolverRunGit`. Argv shape is
 * controlled by the resolver itself — this layer is purely transport.
 */

import { execa } from 'execa'

export type RunGitResult = { stdout: string; stderr: string; code: number }

export type RunGit = (args: string[]) => Promise<RunGitResult>

export type BuildRunGitOptions = {
  gitBinary?: string
  env?: NodeJS.ProcessEnv
}

export function buildPromptResolverRunGit(
  options: BuildRunGitOptions = {},
): RunGit {
  const gitBinary = options.gitBinary ?? 'git'
  return async args => {
    try {
      const result = await execa(gitBinary, args, {
        env: { ...process.env, ...options.env, GIT_PAGER: 'cat', PAGER: 'cat' },
        reject: false,
      })
      const stdout = typeof result.stdout === 'string' ? result.stdout : ''
      const rawStderr = typeof result.stderr === 'string' ? result.stderr : ''
      // execa surfaces spawn failures (ENOENT, EACCES) via `failed: true`
      // with `exitCode: undefined` and an empty `stderr`. Fall back to its
      // human-readable message so the resolver gets actionable text.
      const stderr =
        rawStderr.length > 0
          ? rawStderr
          : result.failed
            ? (result.shortMessage ??
              result.originalMessage ??
              'git invocation failed')
            : ''
      const code = result.exitCode ?? (result.failed ? 1 : 0)
      return { stdout, stderr, code }
    } catch (error) {
      // Defensive: execa with reject:false should not throw, but if it
      // ever does we want a deterministic shape.
      const message = error instanceof Error ? error.message : String(error)
      return { stdout: '', stderr: message, code: 1 }
    }
  }
}
