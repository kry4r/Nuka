// src/core/worktree/tools.ts
//
// Three tools for managing isolated git worktrees from inside the agent
// loop. This is a simplified port of Nuka-Code's EnterWorktreeTool /
// ExitWorktreeTool — Nuka has none of the surrounding infrastructure
// (system-prompt invalidation, tmux integration, hooks snapshots, etc.),
// so the port focuses on the minimum viable contract:
//
//   EnterWorktree — `git worktree add -b <slug>` at `<repo>/.nuka/worktrees/<slug>`,
//                   register the new path in the session store, and return
//                   `cwdOverride` in the result. The ToolContext wiring
//                   (next iter) reads `cwdOverride` and feeds it into the
//                   shared cwd state so subsequent tool calls run there.
//   ListWorktrees — enumerate the worktrees this session created.
//   ExitWorktree  — `git worktree remove` and unregister. Refuses to
//                   touch worktrees not created by EnterWorktree (safety
//                   gate — same as upstream). The result includes
//                   `cwdOverride` set back to the original cwd.
//
// All filesystem side effects go through a `GitRunner` so tests can mock
// the git CLI without spawning processes.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  createWorktree,
  defaultGitRunner,
  findGitRoot,
  removeWorktree,
  validateSlug,
  type GitRunner,
} from './git'
// Direct import from the helper module instead of the barrel — keeps
// the slug Tool surface out of the main bundle (Phase P2 #12).
import { slugify } from '../slug/slug'
import { WorktreeStore } from './store'

/**
 * Normalize a user-typed worktree name into the strict character set
 * `validateSlug` accepts (`[A-Za-z0-9._-]` per segment), using the slug
 * helper. Forward-slash segment separators are preserved — `validateSlug`
 * treats them as namespace boundaries, mirroring git's `feat/foo` style.
 *
 * Each segment is slugified independently with `{ strict: true }`, which
 * produces ASCII `[a-z0-9-]` output. That is a subset of validateSlug's
 * allowed character class, so the post-normalize string is guaranteed to
 * pass validation (or be empty, in which case validateSlug surfaces the
 * empty-segment error). Already-safe input is idempotent — `feat-a`
 * stays `feat-a`.
 */
export function normalizeWorktreeName(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  return raw
    .split('/')
    .map((seg) => slugify(seg, { separator: '-', strict: true }))
    .join('/')
}

export type WorktreeToolsDeps = {
  store: WorktreeStore
  /** Defaults to `defaultGitRunner` (shells out to real git). */
  gitRunner?: GitRunner
}

// --- EnterWorktree ----------------------------------------------------------

export type EnterWorktreeInput = {
  name: string
  /**
   * When true (default), the supplied `name` is first run through the
   * slug helper so user-typed labels like `"feat: my thing"` become
   * `"feat-my-thing"` instead of being rejected by `validateSlug`.
   * Already-safe input is idempotent. Set to `false` to require the
   * caller to pre-sanitize and surface the strict validation errors.
   */
  normalize?: boolean
}

export function makeEnterWorktreeTool(
  deps: WorktreeToolsDeps,
): Tool<EnterWorktreeInput> {
  const runner = deps.gitRunner ?? defaultGitRunner
  return defineTool<EnterWorktreeInput>({
    name: 'EnterWorktree',
    description:
      'Create an isolated git worktree at <repo>/.nuka/worktrees/<name> on a new branch named <name>, and switch the session into it. The name is slugified by default (spaces and punctuation become dashes). Returns the new cwd in the result.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description:
            'Name for the worktree and its branch. Each "/"-separated segment may contain only letters, digits, ".", "_", "-"; max 64 chars per segment, 200 total. With normalize=true (default), the input is slugified first so user-friendly names like "feat: my thing" become "feat-my-thing".',
          minLength: 1,
        },
        normalize: {
          type: 'boolean',
          description:
            'When true (default), the supplied `name` is run through the slug helper before validation so user-typed labels are accepted. When false, the strict character set is enforced unchanged.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'worktree'],
    needsPermission: () => 'exec',
    annotations: { readOnly: false },
    searchHint: ['worktree', 'branch', 'isolate', 'parallel'],
    async run(
      input: EnterWorktreeInput,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const normalize = input.normalize !== false
      const candidate = normalize ? normalizeWorktreeName(input.name) : input.name
      const slugErr = validateSlug(candidate)
      if (slugErr) return { isError: true, output: slugErr }

      if (deps.store.size() >= WorktreeStore.MAX_WORKTREES) {
        return {
          isError: true,
          output: `Too many tracked worktrees (max ${WorktreeStore.MAX_WORKTREES}). Use ExitWorktree to release one first.`,
        }
      }

      const repoRoot = findGitRoot(runner, ctx.cwd)
      if (!repoRoot) {
        return {
          isError: true,
          output: `Not inside a git repository (cwd=${ctx.cwd}). EnterWorktree requires a git repo.`,
        }
      }

      const res = createWorktree(runner, { repoRoot, slug: candidate })
      if (!res.ok) return { isError: true, output: res.message }

      const record = deps.store.add({
        path: res.worktreePath,
        branch: res.branch,
        originalCwd: ctx.cwd,
      })
      // P1 #6 — make this worktree the session's active cwd override.
      // The agent loop reads `store.getActive()` on every tool call, so
      // subsequent Read/Write/Bash invocations land inside the new
      // worktree dir. The `cwdOverride=...` text below stays as a
      // human-readable marker / observability hint, but is NOT parsed
      // by the loop — `setActive` is the wiring.
      deps.store.setActive(record.id)

      return {
        isError: false,
        output: `Created worktree ${record.id} at ${record.path} on branch ${record.branch ?? '?'}. cwdOverride=${record.path}`,
      }
    },
  })
}

// --- ListWorktrees ----------------------------------------------------------

export type ListWorktreesInput = Record<string, never>

export function makeListWorktreesTool(
  deps: WorktreeToolsDeps,
): Tool<ListWorktreesInput> {
  return defineTool<ListWorktreesInput>({
    name: 'ListWorktrees',
    description:
      'List all git worktrees this session created via EnterWorktree (read-only).',
    parameters: {
      type: 'object',
      properties: {},
    },
    source: 'builtin',
    tags: ['core', 'worktree'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: ['worktree', 'list'],
    async run() {
      const all = deps.store.list()
      if (all.length === 0) {
        return { isError: false, output: 'No worktrees registered in this session.' }
      }
      const lines = all.map((w) => {
        const branch = w.branch ? ` [${w.branch}]` : ''
        return `${w.id} — ${w.path}${branch}`
      })
      return { isError: false, output: lines.join('\n') }
    },
  })
}

// --- ExitWorktree -----------------------------------------------------------

export type ExitWorktreeInput = {
  id: string
  force?: boolean
}

export function makeExitWorktreeTool(
  deps: WorktreeToolsDeps,
): Tool<ExitWorktreeInput> {
  const runner = deps.gitRunner ?? defaultGitRunner
  return defineTool<ExitWorktreeInput>({
    name: 'ExitWorktree',
    description:
      'Remove a worktree previously created by EnterWorktree and switch the session back to its original cwd. Returns cwdOverride in the result. Use force=true if the worktree has uncommitted changes.',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          description: 'Worktree ID as reported by EnterWorktree / ListWorktrees.',
          minLength: 1,
        },
        force: {
          type: 'boolean',
          description:
            'When true, pass --force to git worktree remove (discards uncommitted changes). Default false.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'worktree'],
    needsPermission: () => 'exec',
    annotations: { readOnly: false, destructive: true },
    async run(
      input: ExitWorktreeInput,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const record = deps.store.get(input.id)
      if (!record) {
        return {
          isError: true,
          output: `No worktree with id '${input.id}' is tracked by this session. ExitWorktree only operates on worktrees created via EnterWorktree in the current session.`,
        }
      }

      const repoRoot = findGitRoot(runner, ctx.cwd)
      if (!repoRoot) {
        return {
          isError: true,
          output: `Not inside a git repository (cwd=${ctx.cwd}); cannot run git worktree remove.`,
        }
      }

      const res = removeWorktree(runner, {
        repoRoot,
        worktreePath: record.path,
        force: input.force ?? false,
      })
      if (!res.ok) {
        // Keep the record in the store on failure so the agent can retry
        // with force=true.
        return { isError: true, output: res.message }
      }

      deps.store.remove(record.id)

      return {
        isError: false,
        output: `Removed worktree ${record.id} at ${record.path}. cwdOverride=${record.originalCwd}`,
      }
    },
  })
}

// --- bulk factory -----------------------------------------------------------

export function makeWorktreeTools(deps: WorktreeToolsDeps): {
  enter: Tool<EnterWorktreeInput>
  list: Tool<ListWorktreesInput>
  exit: Tool<ExitWorktreeInput>
} {
  return {
    enter: makeEnterWorktreeTool(deps),
    list: makeListWorktreesTool(deps),
    exit: makeExitWorktreeTool(deps),
  }
}
