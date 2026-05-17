// src/core/worktree/git.ts
//
// Thin git CLI wrappers for `git worktree {add,remove}` and `git rev-parse`.
// Kept narrow on purpose — the upstream tool is much bigger because it also
// handles hooks, tmux, system-prompt invalidation, etc. None of that
// infrastructure exists in Nuka yet, so this port limits itself to the
// minimum filesystem effect: create/remove a worktree, return its path.
//
// All exec helpers are mockable through the `GitRunner` interface used by
// `makeWorktreeTools()`. Tests inject a fake runner; production wiring
// uses `defaultGitRunner` which shells out via `execFileSync`.

import { execFileSync, type SpawnSyncReturns } from 'node:child_process'
import * as path from 'node:path'

export type GitResult = {
  code: number
  stdout: string
  stderr: string
}

export type GitRunner = (
  args: string[],
  opts: { cwd: string },
) => GitResult

/**
 * Default production runner. Resolves the working tree by shelling out to
 * `git`. Returns the full stdout/stderr instead of throwing — failures are
 * surfaced via `code !== 0` so tool layers can decide on the user-facing
 * message.
 */
export const defaultGitRunner: GitRunner = (args, opts) => {
  try {
    const stdout = execFileSync('git', args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    const err = e as SpawnSyncReturns<string>
    return {
      code: err.status ?? 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : String(e),
    }
  }
}

/** Return the canonical absolute path of the repo containing `cwd`, or null. */
export function findGitRoot(runner: GitRunner, cwd: string): string | null {
  const r = runner(['rev-parse', '--show-toplevel'], { cwd })
  if (r.code !== 0) return null
  const root = r.stdout.trim()
  return root.length > 0 ? root : null
}

export type CreateWorktreeOk = {
  ok: true
  worktreePath: string
  branch?: string
}
export type CreateWorktreeErr = {
  ok: false
  message: string
}

/**
 * Create a new worktree at `<repoRoot>/.nuka/worktrees/<slug>` on a fresh
 * branch named `<slug>`. The slug is validated by `validateSlug` first.
 *
 * The location is deliberately inside the repo so `git status` from the
 * main tree shows it (the user can audit/clean up); we never write outside
 * the repo root.
 */
export function createWorktree(
  runner: GitRunner,
  opts: { repoRoot: string; slug: string },
): CreateWorktreeOk | CreateWorktreeErr {
  const slugErr = validateSlug(opts.slug)
  if (slugErr) return { ok: false, message: slugErr }

  const worktreePath = path.join(opts.repoRoot, '.nuka', 'worktrees', opts.slug)
  const branch = opts.slug

  const r = runner(['worktree', 'add', '-b', branch, worktreePath], {
    cwd: opts.repoRoot,
  })
  if (r.code !== 0) {
    return {
      ok: false,
      message: `git worktree add failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim() || 'unknown error'}`,
    }
  }
  return { ok: true, worktreePath, branch }
}

export type RemoveWorktreeOk = { ok: true }
export type RemoveWorktreeErr = { ok: false; message: string }

/**
 * Remove a worktree previously created by `createWorktree`. `force` maps to
 * `git worktree remove --force` — needed when the tree has uncommitted
 * changes.
 */
export function removeWorktree(
  runner: GitRunner,
  opts: { repoRoot: string; worktreePath: string; force: boolean },
): RemoveWorktreeOk | RemoveWorktreeErr {
  const args = ['worktree', 'remove']
  if (opts.force) args.push('--force')
  args.push(opts.worktreePath)
  const r = runner(args, { cwd: opts.repoRoot })
  if (r.code !== 0) {
    return {
      ok: false,
      message: `git worktree remove failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim() || 'unknown error'}`,
    }
  }
  return { ok: true }
}

/**
 * Worktree slug validation, ported in spirit from Nuka-Code's
 * `validateWorktreeSlug`. Allowed: letters, digits, dot, underscore, dash,
 * and `/` segments; each segment <=64 chars; total path <=200 chars; no
 * leading/trailing slash; no `..`.
 */
export function validateSlug(slug: string): string | null {
  if (slug.length === 0) return 'Worktree slug must not be empty'
  if (slug.length > 200) return 'Worktree slug must be ≤200 characters'
  if (slug.startsWith('/') || slug.endsWith('/')) {
    return 'Worktree slug must not start or end with "/"'
  }
  const segments = slug.split('/')
  for (const seg of segments) {
    if (seg.length === 0) return 'Worktree slug contains an empty segment'
    if (seg.length > 64) return 'Worktree slug segment must be ≤64 characters'
    if (seg === '..' || seg === '.') {
      return `Worktree slug segment "${seg}" is not allowed`
    }
    if (!/^[A-Za-z0-9._-]+$/.test(seg)) {
      return `Worktree slug segment "${seg}" contains invalid characters; allowed: letters, digits, ".", "_", "-"`
    }
  }
  return null
}
