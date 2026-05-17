// src/core/fileSearch/walker.ts
//
// Self-contained recursive file walker. Replaces the upstream's
// git-ls-files / ripgrep / `ignore`-lib machinery with a pure
// `node:fs/promises` traversal.
//
// Why not use the upstream's git+ripgrep approach?
//   - that approach is great for huge repos (270k+ files) but pulls in
//     the `ignore` npm package + spawns subprocesses, and only works
//     inside a git repo;
//   - this module is a building block; callers that already have a
//     file list (from git, from ripgrep, from a watcher) can feed it
//     directly into FileIndex.loadFromFileList and skip this walker
//     entirely;
//   - for the small/medium repos Nuka targets (a few thousand files),
//     a plain fs walk with a sensible skip-list keeps us dependency-free
//     and works in plain-directory mode too.
//
// The walker:
//   - returns paths RELATIVE to `rootDir`, forward-slash-joined (matches
//     how FileIndex / fuzzy ranking treats `/` as a boundary);
//   - skips common build-output and VCS directories by default;
//   - optionally respects .gitignore-style patterns IF the caller passes
//     a `loadIgnorePatterns` callback. We don't pull in `ignore` here;
//     callers who care can lift it from upstream `fileSuggestions.ts`
//     and plug it in.
//
// Side-effects: filesystem reads only.

import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { sep as PATH_SEP } from 'node:path'

import { gitignoreFilter } from './gitignoreFilter.js'

/**
 * Default skip-list. Mirrors the union of upstream defaults +
 * ripgrep's standard ignored dirs. We intentionally keep `.claude/`,
 * `node_modules/`, `dist/`, `build/`, `.git/`, etc. out — none of them
 * are useful in a path palette.
 */
export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.nyc_output',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'target', // rust/java
  '.gradle',
  '.idea',
  '.vscode',
  '.DS_Store',
])

export type WalkOptions = {
  /** Absolute root directory. Required. */
  rootDir: string
  /** Max recursion depth. Default `Infinity`. `0` = `rootDir` itself only. */
  maxDepth?: number
  /** Hard cap on total entries returned. Default `Infinity`. */
  maxEntries?: number
  /** Include dotfiles. Default `false`. */
  includeDotfiles?: boolean
  /** Additional directory names to skip (merged with {@link DEFAULT_SKIP_DIRS}). */
  extraSkipDirs?: Iterable<string>
  /** Override the default skip list entirely. */
  skipDirs?: Iterable<string>
  /**
   * Optional abort signal. Walker checks after every directory read,
   * so a cancel will fire within a few ms on a reasonably-sized tree.
   */
  signal?: AbortSignal
  /**
   * Optional predicate. If provided, every relative path is offered to
   * it; only paths returning `true` are emitted. Useful for hooking
   * in a gitignore-style filter without baking the `ignore` package
   * into this module.
   *
   * Called with FORWARD-SLASH-joined relative paths regardless of OS,
   * to match how FileIndex / scoring sees them.
   */
  shouldInclude?: (relPath: string) => boolean
  /**
   * Opt-in: when `true`, the walker loads gitignore-style patterns from
   * `gitignoreRoot` (or `rootDir` if not specified) via
   * {@link gitignoreFilter} BEFORE walking, and AND-s the resulting
   * predicate with `shouldInclude` (a path must pass BOTH).
   *
   * Default `false` — no extra IO, no behavior change for callers
   * that don't set this.
   *
   * If `gitignoreFilter` throws (e.g., no `.gitignore` exists at the
   * given root), the walker gracefully falls back to a no-op gitignore
   * predicate so the walk still succeeds. In practice
   * `gitignoreFilter` already returns an always-true predicate when no
   * ignore files are present, so this is belt-and-braces.
   */
  respectGitignore?: boolean
  /**
   * Optional override for where to load the `.gitignore` from. Only
   * consulted when `respectGitignore: true`. Defaults to `rootDir`.
   */
  gitignoreRoot?: string
}

/**
 * Recursively walk `rootDir`, returning relative paths (forward-slash
 * joined). Files only — directories are traversed but not emitted.
 *
 * Throws if `rootDir` cannot be read. Per-directory read failures
 * (permission denied, missing dir during walk) are swallowed and the
 * walker continues — same behavior as the upstream basic walker.
 */
export async function walkFiles(opts: WalkOptions): Promise<string[]> {
  const {
    rootDir,
    maxDepth = Number.POSITIVE_INFINITY,
    maxEntries = Number.POSITIVE_INFINITY,
    includeDotfiles = false,
    signal,
    shouldInclude,
    respectGitignore = false,
    gitignoreRoot,
  } = opts

  const skipDirs: ReadonlySet<string> = opts.skipDirs
    ? new Set(opts.skipDirs)
    : opts.extraSkipDirs
      ? new Set([...DEFAULT_SKIP_DIRS, ...opts.extraSkipDirs])
      : DEFAULT_SKIP_DIRS

  // Resolve the effective `shouldInclude` predicate BEFORE walking.
  //
  // When `respectGitignore` is false (default) we skip all gitignore
  // IO and behave identically to the pre-gitignore walker.
  //
  // When `respectGitignore` is true we load the predicate from
  // `gitignoreRoot ?? rootDir`. If that throws — e.g., the directory
  // is unreadable for some reason — we fall back to an always-true
  // predicate so the walk continues. `gitignoreFilter` itself already
  // tolerates missing ignore files, so the catch here is belt-and-
  // braces, but it preserves the documented "graceful no-op" contract.
  let effectiveShouldInclude = shouldInclude
  if (respectGitignore) {
    let ignorePred: (relPath: string) => boolean
    try {
      ignorePred = await gitignoreFilter(gitignoreRoot ?? rootDir)
    } catch {
      ignorePred = () => true
    }
    if (shouldInclude !== undefined) {
      // AND both predicates — a path must pass the caller's filter
      // AND the gitignore filter.
      effectiveShouldInclude = (rel: string): boolean =>
        shouldInclude(rel) && ignorePred(rel)
    } else {
      effectiveShouldInclude = ignorePred
    }
  }

  const out: string[] = []
  await walkInner(rootDir, '', 0, {
    maxDepth,
    maxEntries,
    includeDotfiles,
    skipDirs,
    signal,
    shouldInclude: effectiveShouldInclude,
    out,
  })
  return out
}

type InnerCtx = {
  maxDepth: number
  maxEntries: number
  includeDotfiles: boolean
  skipDirs: ReadonlySet<string>
  signal: AbortSignal | undefined
  shouldInclude: ((relPath: string) => boolean) | undefined
  out: string[]
}

async function walkInner(
  dir: string,
  relDir: string,
  depth: number,
  ctx: InnerCtx,
): Promise<void> {
  if (ctx.out.length >= ctx.maxEntries) return
  if (ctx.signal?.aborted) return
  if (depth > ctx.maxDepth) return

  let entries: Dirent[]
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[]
  } catch {
    return
  }

  for (const entry of entries) {
    if (ctx.out.length >= ctx.maxEntries) return
    if (ctx.signal?.aborted) return

    const name = entry.name
    if (!ctx.includeDotfiles && name.startsWith('.') && name !== '.') continue

    if (entry.isDirectory()) {
      if (ctx.skipDirs.has(name)) continue
      const childAbs = dir + PATH_SEP + name
      const childRel = relDir.length === 0 ? name : relDir + '/' + name
      await walkInner(childAbs, childRel, depth + 1, ctx)
    } else if (entry.isFile()) {
      const rel = relDir.length === 0 ? name : relDir + '/' + name
      if (ctx.shouldInclude && !ctx.shouldInclude(rel)) continue
      ctx.out.push(rel)
    }
    // Symlinks / other types: ignored. Matches upstream basic walker.
  }
}
