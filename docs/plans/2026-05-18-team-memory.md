# Team Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a team-scoped memory tier alongside Nuka's existing per-cwd memory: configure a `teamId` in `ConfigSchema`, persist entries under `~/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md`, render them in the system prompt between (future) user memory and the existing per-cwd (project) memory, with strict hash-collision and symlink containment.

**Architecture:** Nuka's current `loadMemory(cwd)` is already per-project (sha1(cwd) under `~/.nuka/memory/`), so semantically it IS project memory. We add a sibling `~/.nuka/team-memory/<teamId>/<sha1(cwd)>/` tier — same hash, same MEMORY.md format — gated by `config.teamId`. The system prompt grows three slots (`userMemory`, `teamMemory`, `memory` = project) emitted in that order; `userMemory` is a typed stub for a future iter so the ordering is correct today without expanding scope. The two helper files from Nuka-Code are ported with their `PathTraversalError`/symlink-resolution guards intact (security-load-bearing) but stripped of Growthbook feature-flag gating (Nuka has no analytics) and `isAutoMemoryEnabled` (Nuka has no such gate); the enablement test reduces to `config.teamId !== undefined`.

**Tech Stack:** TypeScript (strict), Vitest

---

## File Structure

```
src/core/config/schema.ts                       # MODIFY — add teamId
src/core/memdir/index.ts                        # MODIFY — export new helpers; add loadTeamMemory
src/core/memdir/teamMemPaths.ts                 # CREATE — paths + containment guards
src/core/memdir/teamMemPrompts.ts               # CREATE — prompt-section renderer
src/core/agent/systemPrompt.ts                  # MODIFY — three-tier memory section
src/cli.tsx                                     # MODIFY — load team memory; thread into prompt
test/core/memdir/teamMemPaths.test.ts           # CREATE — path + traversal cases
test/core/memdir/teamMemLoad.test.ts            # CREATE — load + hash-isolation
test/core/agent/systemPromptTeamMemory.test.ts  # CREATE — prompt ordering
```

---

## Task 1 — add `teamId` to `ConfigSchema`

- [ ] **Files:**
  - Modify: `src/core/config/schema.ts`
  - Test: `test/core/config/schema.test.ts` (existing file — append a case)

- [ ] Write failing test. Append to `test/core/config/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../../../src/core/config/schema'

describe('ConfigSchema teamId', () => {
  it('accepts an optional teamId string', () => {
    const parsed = ConfigSchema.parse({ providers: [], active: { providerId: '' }, teamId: 'acme-prod' })
    expect(parsed.teamId).toBe('acme-prod')
  })

  it('omits teamId when absent', () => {
    const parsed = ConfigSchema.parse({ providers: [], active: { providerId: '' } })
    expect(parsed.teamId).toBeUndefined()
  })

  it('rejects an empty-string teamId', () => {
    expect(() =>
      ConfigSchema.parse({ providers: [], active: { providerId: '' }, teamId: '' }),
    ).toThrow()
  })
})
```

- [ ] Run: `npx vitest run test/core/config/schema.test.ts` — expect FAIL (`teamId` not on schema).

- [ ] Implement. In `src/core/config/schema.ts`, inside the `ConfigSchema = z.object({ ... })` block, append a field BEFORE the trailing `})`:

```typescript
  /**
   * 2026-05-18 — team-memory scope. When set, the agent loads team
   * memory entries from `~/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md`
   * in addition to the per-cwd project memory. Plain string by design:
   * the value is treated as an opaque identifier and only ever
   * interpolated into a filesystem path via the `teamMemoryPath`
   * helper (which sanitizes / containment-checks the result).
   */
  teamId: z.string().min(1).optional(),
```

- [ ] Run: `npx vitest run test/core/config/schema.test.ts` — expect PASS.
- [ ] Run: `npx tsc --noEmit` — expect no errors.

- [ ] Commit: `feat(config): add optional teamId to ConfigSchema`

---

## Task 2 — failing test for `teamMemoryPath` + containment guards

- [ ] **Files:**
  - Create: `test/core/memdir/teamMemPaths.test.ts`

- [ ] Write failing test:

```typescript
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  teamMemoryPath,
  teamMemoryDir,
  isTeamMemoryEnabled,
  validateTeamMemKey,
  PathTraversalError,
} from '../../../src/core/memdir/teamMemPaths'

describe('teamMemoryPath', () => {
  it('returns <home>/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md', () => {
    const p = teamMemoryPath('acme', '/repo/app', '/h')
    // sha1 of '/repo/app' is deterministic; we just assert the shape.
    expect(p.startsWith('/h/.nuka/team-memory/acme/')).toBe(true)
    expect(p.endsWith('/MEMORY.md')).toBe(true)
  })

  it('produces different hashes for different cwd values', () => {
    const a = teamMemoryPath('acme', '/repo/a', '/h')
    const b = teamMemoryPath('acme', '/repo/b', '/h')
    expect(a).not.toBe(b)
  })

  it('isolates two teams sharing the same cwd', () => {
    const a = teamMemoryPath('teamA', '/repo/x', '/h')
    const b = teamMemoryPath('teamB', '/repo/x', '/h')
    expect(a).not.toBe(b)
    expect(a.includes('/teamA/')).toBe(true)
    expect(b.includes('/teamB/')).toBe(true)
  })
})

describe('isTeamMemoryEnabled', () => {
  it('returns true when teamId is a non-empty string', () => {
    expect(isTeamMemoryEnabled({ teamId: 'acme' })).toBe(true)
  })

  it('returns false when teamId is undefined', () => {
    expect(isTeamMemoryEnabled({})).toBe(false)
  })
})

describe('validateTeamMemKey', () => {
  it('accepts a simple relative key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tm-key-ok-'))
    try {
      const resolved = await validateTeamMemKey('acme', '/repo/app', 'sub/file.md', home)
      expect(resolved.startsWith(teamMemoryDir('acme', '/repo/app', home))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('rejects keys with .. traversal', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', '../escape.md', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects keys with null bytes', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', 'bad\0file.md', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects keys with absolute paths', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', '/etc/passwd', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects keys with backslashes', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', '..\\evil.md', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects URL-encoded traversal', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', '%2e%2e%2fevil.md', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects symlink-based escape', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tm-symlink-'))
    try {
      const teamDir = teamMemoryDir('acme', '/repo/app', home)
      mkdirSync(teamDir, { recursive: true })
      // Create a symlink inside teamDir pointing OUT of teamDir.
      const outside = mkdtempSync(join(tmpdir(), 'nuka-tm-outside-'))
      symlinkSync(outside, join(teamDir, 'escape'))
      await expect(
        validateTeamMemKey('acme', '/repo/app', 'escape/x.md', home),
      ).rejects.toBeInstanceOf(PathTraversalError)
      rmSync(outside, { recursive: true, force: true })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
```

- [ ] Run: `npx vitest run test/core/memdir/teamMemPaths.test.ts` — expect FAIL (module does not exist).

- [ ] Commit (test only): `test(memdir): failing spec for teamMemoryPath + containment`

---

## Task 3 — implement `teamMemPaths.ts`

- [ ] **Files:**
  - Create: `src/core/memdir/teamMemPaths.ts`

- [ ] Write file:

```typescript
// src/core/memdir/teamMemPaths.ts
//
// 2026-05-18 — team-memory storage paths + traversal-resistant key
// validation. Mirrors the upstream Nuka-Code shape (paths.ts +
// teamMemPaths.ts) with two deliberate omissions: Nuka has no analytics
// platform (Growthbook is gone), and there is no `isAutoMemoryEnabled`
// gate (auto-memory is always on). Enablement collapses to "does the
// loaded config carry a teamId?".
//
// Disk layout (sibling to the per-cwd memdir):
//   ~/.nuka/memory/<sha1(cwd)>/MEMORY.md          ← project (per-cwd) tier
//   ~/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md  ← team tier
//
// sha1(cwd) is identical between the two tiers on purpose: a given
// project always resolves to the SAME hash, regardless of which team
// is active, so switching teams flips between sibling MEMORY.md files
// without re-resolving the project root.

import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'

/**
 * Error thrown when a path validation detects a traversal or injection attempt.
 *
 * Callers should NOT proceed with disk I/O when this is thrown — the entry
 * point is the only line of defence between user-controlled keys (from
 * future remote-sync or slash-command input) and the filesystem.
 */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

/**
 * sha1 of the cwd, hex-encoded. Same hash used by per-cwd memdir so the
 * two tiers naturally line up on the same project. sha1 is sufficient —
 * we are NOT using it for security; it is purely a stable directory name.
 */
function projectHash(cwd: string): string {
  return crypto.createHash('sha1').update(cwd).digest('hex')
}

/**
 * Sanitize a relative-key string by rejecting dangerous patterns. Throws
 * {@link PathTraversalError} on any attempt to escape the team-memory
 * directory via null bytes, URL-encoding, backslashes, absolute paths,
 * or unicode-normalised separators.
 *
 * Pure / synchronous — fast first-pass rejection before any filesystem
 * touch. Mirrors the upstream sanitizer line-for-line; the test suite in
 * `teamMemPaths.test.ts` exercises each vector.
 */
function sanitizePathKey(key: string): string {
  if (key.includes('\0')) {
    throw new PathTraversalError(`Null byte in path key: "${key}"`)
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(key)
  } catch {
    decoded = key
  }
  if (decoded !== key && (decoded.includes('..') || decoded.includes('/'))) {
    throw new PathTraversalError(`URL-encoded traversal in path key: "${key}"`)
  }
  const normalized = key.normalize('NFKC')
  if (
    normalized !== key &&
    (normalized.includes('..') ||
      normalized.includes('/') ||
      normalized.includes('\\') ||
      normalized.includes('\0'))
  ) {
    throw new PathTraversalError(
      `Unicode-normalized traversal in path key: "${key}"`,
    )
  }
  if (key.includes('\\')) {
    throw new PathTraversalError(`Backslash in path key: "${key}"`)
  }
  if (key.startsWith('/')) {
    throw new PathTraversalError(`Absolute path key: "${key}"`)
  }
  return key
}

/**
 * Validate a teamId for filesystem use. teamIds come from `ConfigSchema`
 * (parsed via zod with `.min(1)`) so we already know it is a non-empty
 * string; this guard exists to catch malicious values supplied through
 * a future remote-config or hot-reload path.
 */
function sanitizeTeamId(teamId: string): string {
  if (teamId.length === 0) {
    throw new PathTraversalError('Empty teamId')
  }
  if (teamId.includes('\0') || teamId.includes('/') || teamId.includes('\\')) {
    throw new PathTraversalError(`Illegal characters in teamId: "${teamId}"`)
  }
  if (teamId === '.' || teamId === '..') {
    throw new PathTraversalError(`Reserved teamId value: "${teamId}"`)
  }
  return teamId
}

/**
 * Lightweight enablement predicate. The configured value is the single
 * source of truth — no env-var override, no feature flag.
 */
export function isTeamMemoryEnabled(config: { teamId?: string }): boolean {
  return typeof config.teamId === 'string' && config.teamId.length > 0
}

/**
 * Resolve `<home>/.nuka/team-memory/<teamId>/<sha1(cwd)>/`. Trailing
 * separator included so prefix-containment checks (`startsWith(teamDir)`)
 * are not foiled by sibling directories that share a name prefix (e.g.
 * `<teamId>-evil` vs `<teamId>`).
 */
export function teamMemoryDir(
  teamId: string,
  cwd: string,
  home: string = os.homedir(),
): string {
  const id = sanitizeTeamId(teamId)
  const hash = projectHash(cwd)
  return path.join(home, '.nuka', 'team-memory', id, hash) + path.sep
}

/**
 * Resolve `<teamMemoryDir>/MEMORY.md`. The single entrypoint file for
 * the team tier — same shape as the project tier's MEMORY.md.
 */
export function teamMemoryPath(
  teamId: string,
  cwd: string,
  home: string = os.homedir(),
): string {
  return path.join(teamMemoryDir(teamId, cwd, home), 'MEMORY.md')
}

type ErrnoLike = { code?: unknown }

function errnoCode(e: unknown): string | undefined {
  if (e !== null && typeof e === 'object' && 'code' in e) {
    const c = (e as ErrnoLike).code
    if (typeof c === 'string') return c
  }
  return undefined
}

/**
 * Walk up the path until `realpath` succeeds, then re-append the
 * non-existing tail. Ensures we compare ACTUAL filesystem locations
 * (post-symlink-resolution) rather than the user-supplied string,
 * which is the only way to detect symlink-based escapes (the target
 * file may not exist yet; we are about to create it).
 *
 * Ported from upstream Nuka-Code with one simplification: no telemetry
 * on intermediate ELOOP / ENAMETOOLONG cases — Nuka has no analytics
 * backend to feed.
 */
async function realpathDeepestExisting(absolutePath: string): Promise<string> {
  const tail: string[] = []
  let current = absolutePath
  for (
    let parent = path.dirname(current);
    current !== parent;
    parent = path.dirname(current)
  ) {
    try {
      const realCurrent = await realpath(current)
      return tail.length === 0
        ? realCurrent
        : path.join(realCurrent, ...tail.reverse())
    } catch (e: unknown) {
      const code = errnoCode(e)
      if (code === 'ENOENT') {
        try {
          const st = await lstat(current)
          if (st.isSymbolicLink()) {
            throw new PathTraversalError(
              `Dangling symlink detected (target does not exist): "${current}"`,
            )
          }
        } catch (lstatErr: unknown) {
          if (lstatErr instanceof PathTraversalError) throw lstatErr
          // truly non-existent — safe to walk up
        }
      } else if (code === 'ELOOP') {
        throw new PathTraversalError(
          `Symlink loop detected in path: "${current}"`,
        )
      } else if (code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') {
        throw new PathTraversalError(
          `Cannot verify path containment (${String(code)}): "${current}"`,
        )
      }
      tail.push(current.slice(parent.length + path.sep.length))
      current = parent
    }
  }
  return absolutePath
}

/**
 * Compare a candidate's symlink-resolved location against the team
 * directory's symlink-resolved location. When the team dir does not
 * exist (e.g. brand-new session, never written), no symlinks can exist
 * inside it either — the string-level prefix check is sufficient and
 * we return true to avoid spurious traversal errors.
 */
async function isRealPathWithinTeamDir(
  realCandidate: string,
  teamDir: string,
): Promise<boolean> {
  let realTeamDir: string
  try {
    realTeamDir = await realpath(teamDir.replace(/[/\\]+$/, ''))
  } catch (e: unknown) {
    const code = errnoCode(e)
    if (code === 'ENOENT' || code === 'ENOTDIR') return true
    return false
  }
  if (realCandidate === realTeamDir) return true
  return realCandidate.startsWith(realTeamDir + path.sep)
}

/**
 * Validate a relative key (from a future remote-sync or slash-command
 * surface) against the team memory directory. Throws
 * {@link PathTraversalError} on any escape attempt; returns the
 * absolute, symlink-resolved-where-existing path on success.
 *
 * NOT used by the static `teamMemoryPath` resolver above — that path is
 * fully internal and never sees user input. This validator exists for
 * future iters (write tools, sync watchers) so the security primitive
 * lands with the rest of the team-memory module.
 */
export async function validateTeamMemKey(
  teamId: string,
  cwd: string,
  relativeKey: string,
  home: string = os.homedir(),
): Promise<string> {
  sanitizePathKey(relativeKey)
  const teamDir = teamMemoryDir(teamId, cwd, home)
  const fullPath = path.join(teamDir, relativeKey)
  const resolvedPath = path.resolve(fullPath)
  if (!resolvedPath.startsWith(teamDir)) {
    throw new PathTraversalError(
      `Key escapes team memory directory: "${relativeKey}"`,
    )
  }
  const realPath = await realpathDeepestExisting(resolvedPath)
  if (!(await isRealPathWithinTeamDir(realPath, teamDir))) {
    throw new PathTraversalError(
      `Key escapes team memory directory via symlink: "${relativeKey}"`,
    )
  }
  return resolvedPath
}
```

- [ ] Run: `npx vitest run test/core/memdir/teamMemPaths.test.ts` — expect PASS.
- [ ] Run: `npx tsc --noEmit` — expect no errors.

- [ ] Commit: `feat(memdir): teamMemoryPath + traversal-resistant key validation`

---

## Task 4 — failing test for `loadTeamMemory`

- [ ] **Files:**
  - Create: `test/core/memdir/teamMemLoad.test.ts`

- [ ] Write failing test:

```typescript
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { loadTeamMemory } from '../../../src/core/memdir'
import { teamMemoryPath } from '../../../src/core/memdir/teamMemPaths'

function writeTeamFile(home: string, teamId: string, cwd: string, body: string): void {
  const p = teamMemoryPath(teamId, cwd, home)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, body, 'utf8')
}

describe('loadTeamMemory', () => {
  it('returns [] when the file does not exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tml-empty-'))
    try {
      const out = await loadTeamMemory('acme', '/repo/app', home)
      expect(out).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('parses entries from disk', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tml-parse-'))
    try {
      writeTeamFile(
        home,
        'acme',
        '/repo/app',
        [
          '# Nuka Memory',
          '',
          '## Entry: 2026-05-18T00:00:00.000Z',
          '',
          'Body of the team-memory note.',
          '',
          'Keywords: alpha, beta',
        ].join('\n'),
      )
      const out = await loadTeamMemory('acme', '/repo/app', home)
      expect(out).toHaveLength(1)
      expect(out[0]?.body).toContain('Body of the team-memory note.')
      expect(out[0]?.keywords).toEqual(['alpha', 'beta'])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('isolates entries across teams sharing the same cwd', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tml-isolate-'))
    try {
      writeTeamFile(home, 'teamA', '/repo/x', [
        '# Nuka Memory', '',
        '## Entry: 2026-05-18T00:00:00.000Z', '',
        'team A note', '',
        'Keywords: a',
      ].join('\n'))
      writeTeamFile(home, 'teamB', '/repo/x', [
        '# Nuka Memory', '',
        '## Entry: 2026-05-18T00:00:00.000Z', '',
        'team B note', '',
        'Keywords: b',
      ].join('\n'))

      const a = await loadTeamMemory('teamA', '/repo/x', home)
      const b = await loadTeamMemory('teamB', '/repo/x', home)
      expect(a[0]?.body).toContain('team A note')
      expect(b[0]?.body).toContain('team B note')
      // Cross-team contamination check.
      expect(a.some(e => e.body.includes('team B'))).toBe(false)
      expect(b.some(e => e.body.includes('team A'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('isolates entries across different cwd under the same team', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tml-cwd-'))
    try {
      writeTeamFile(home, 'acme', '/repo/x', [
        '# Nuka Memory', '', '## Entry: 2026-05-18T00:00:00.000Z', '',
        'cwd x note', '', 'Keywords: x',
      ].join('\n'))
      writeTeamFile(home, 'acme', '/repo/y', [
        '# Nuka Memory', '', '## Entry: 2026-05-18T00:00:00.000Z', '',
        'cwd y note', '', 'Keywords: y',
      ].join('\n'))
      const x = await loadTeamMemory('acme', '/repo/x', home)
      const y = await loadTeamMemory('acme', '/repo/y', home)
      expect(x[0]?.body).toContain('cwd x note')
      expect(y[0]?.body).toContain('cwd y note')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
```

- [ ] Run: `npx vitest run test/core/memdir/teamMemLoad.test.ts` — expect FAIL (`loadTeamMemory` is not exported).

- [ ] Commit (test only): `test(memdir): failing spec for loadTeamMemory`

---

## Task 5 — implement `loadTeamMemory` in `memdir/index.ts`

- [ ] **Files:**
  - Modify: `src/core/memdir/index.ts`

- [ ] Insert (after the existing `clearMemory` function, at end of file):

```typescript
import {
  teamMemoryPath,
  teamMemoryDir,
  isTeamMemoryEnabled as isTeamMemoryEnabledForConfig,
  validateTeamMemKey,
  PathTraversalError,
} from './teamMemPaths'

// Re-export so external consumers import one canonical entrypoint.
export {
  teamMemoryPath,
  teamMemoryDir,
  validateTeamMemKey,
  PathTraversalError,
}
export const isTeamMemoryEnabled = isTeamMemoryEnabledForConfig

/**
 * Load team-memory entries for `<teamId, cwd>`. Returns `[]` on ENOENT
 * (most common state — a brand-new team hasn't written anything yet)
 * and rethrows any other I/O error. Parsing uses the SAME parser as
 * per-cwd memory because the on-disk format is identical; only the
 * directory differs.
 */
export async function loadTeamMemory(
  teamId: string,
  cwd: string,
  home?: string,
): Promise<MemoryEntry[]> {
  const file = teamMemoryPath(teamId, cwd, home)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return parseMemoryFile(raw)
}
```

- [ ] Run: `npx vitest run test/core/memdir/teamMemLoad.test.ts` — expect PASS.
- [ ] Run: `npx tsc --noEmit` — expect no errors.

- [ ] Commit: `feat(memdir): loadTeamMemory + re-export of team-memory primitives`

---

## Task 6 — implement `teamMemPrompts.ts` (renderer)

- [ ] **Files:**
  - Create: `src/core/memdir/teamMemPrompts.ts`

This is the prompt-section helper. Nuka-Code's upstream version builds a long "memory system" preamble (XML-style `<type>` blocks, frontmatter examples); Nuka's existing prompt uses a tight bullet-list under `## Memory`. We mirror Nuka's style (short, terminal-agent-y) rather than back-porting upstream's verbosity.

- [ ] Write file:

```typescript
// src/core/memdir/teamMemPrompts.ts
//
// 2026-05-18 — system-prompt section renderer for team memory. The
// section sits between `userMemory` (future tier) and the existing
// project memory (`memory`) in the assembled prompt. When `entries`
// is empty, returns an empty array so the prompt builder can `...spread`
// it unconditionally without emitting an orphan heading.
//
// Format matches the per-cwd memdir bullet style (see
// `src/core/agent/systemPrompt.ts` lines 70-76) so downstream
// consumers parse all three tiers identically.

import type { MemoryEntry } from './parser'

/**
 * Render the `## Team Memory` section as a string[] of lines (no
 * trailing newline). Returns an empty array when there are no entries
 * so callers can spread unconditionally:
 *
 *     lines.push(...renderTeamMemorySection(entries))
 */
export function renderTeamMemorySection(entries: readonly MemoryEntry[]): string[] {
  if (entries.length === 0) return []
  const lines: string[] = ['', '## Team Memory', '']
  for (const e of entries) {
    const kw = e.keywords.length > 0 ? ` [${e.keywords.join(', ')}]` : ''
    lines.push(`- ${e.body}${kw}`)
  }
  return lines
}
```

- [ ] No new test file — exercised end-to-end in Task 8 via `systemPromptTeamMemory.test.ts`.

- [ ] Run: `npx tsc --noEmit` — expect no errors.

- [ ] Commit: `feat(memdir): renderTeamMemorySection helper`

---

## Task 7 — failing test for system-prompt ordering

- [ ] **Files:**
  - Create: `test/core/agent/systemPromptTeamMemory.test.ts`

- [ ] Write failing test:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../../src/core/agent/systemPrompt'
import type { MemoryEntry } from '../../../src/core/memdir'

function baseInput() {
  return {
    cwd: '/r',
    platform: 'linux',
    shell: '/bin/bash',
    nodeVersion: 'v20',
    gitBranch: null,
  } as const
}

const userEntry: MemoryEntry = {
  timestamp: '2026-01-01T00:00:00.000Z',
  body: 'USER MEMORY ENTRY',
  keywords: ['u'],
}
const teamEntry: MemoryEntry = {
  timestamp: '2026-02-01T00:00:00.000Z',
  body: 'TEAM MEMORY ENTRY',
  keywords: ['t'],
}
const projectEntry: MemoryEntry = {
  timestamp: '2026-03-01T00:00:00.000Z',
  body: 'PROJECT MEMORY ENTRY',
  keywords: ['p'],
}

describe('buildSystemPrompt — three-tier memory ordering', () => {
  it('omits all sections when none of userMemory / teamMemory / memory is set', () => {
    const out = buildSystemPrompt(baseInput())
    expect(out).not.toMatch(/## Memory/)
    expect(out).not.toMatch(/## Team Memory/)
    expect(out).not.toMatch(/## User Memory/)
  })

  it('renders project memory only (back-compat with pre-team Nuka)', () => {
    const out = buildSystemPrompt({ ...baseInput(), memory: [projectEntry] })
    expect(out).toMatch(/## Memory/)
    expect(out).not.toMatch(/## Team Memory/)
    expect(out).not.toMatch(/## User Memory/)
    expect(out).toContain('PROJECT MEMORY ENTRY')
  })

  it('omits team memory section when teamMemory is an empty array', () => {
    const out = buildSystemPrompt({
      ...baseInput(),
      teamMemory: [],
      memory: [projectEntry],
    })
    expect(out).not.toMatch(/## Team Memory/)
    expect(out).toMatch(/## Memory/)
  })

  it('emits user → team → project in that exact order', () => {
    const out = buildSystemPrompt({
      ...baseInput(),
      userMemory: [userEntry],
      teamMemory: [teamEntry],
      memory: [projectEntry],
    })
    const idxUser = out.indexOf('## User Memory')
    const idxTeam = out.indexOf('## Team Memory')
    const idxProject = out.indexOf('## Memory')  // project section
    // All three present
    expect(idxUser).toBeGreaterThan(-1)
    expect(idxTeam).toBeGreaterThan(-1)
    expect(idxProject).toBeGreaterThan(-1)
    // ordered user < team < project
    expect(idxUser).toBeLessThan(idxTeam)
    expect(idxTeam).toBeLessThan(idxProject)
    // ## Memory header must NOT collide with `## Team Memory` for prefix matches.
    // The project header is `## Memory` (no Team prefix). Verify by counting
    // exact-headers — the substring `## Memory` appears in `## Team Memory`
    // so we use line-anchored matching for safety:
    const lines = out.split('\n')
    const headers = lines.filter(l => /^## (User Memory|Team Memory|Memory)$/.test(l))
    expect(headers).toEqual(['## User Memory', '## Team Memory', '## Memory'])
  })

  it('renders only team memory when project is absent', () => {
    const out = buildSystemPrompt({
      ...baseInput(),
      teamMemory: [teamEntry],
    })
    expect(out).toMatch(/## Team Memory/)
    expect(out).toContain('TEAM MEMORY ENTRY')
    expect(out).not.toMatch(/## Memory\b(?! Memory)/)  // no project section
  })
})
```

- [ ] Run: `npx vitest run test/core/agent/systemPromptTeamMemory.test.ts` — expect FAIL (`userMemory` / `teamMemory` not on `SystemPromptInput`).

- [ ] Commit (test only): `test(prompt): failing spec for three-tier memory ordering`

---

## Task 8 — extend `SystemPromptInput` + render three tiers

- [ ] **Files:**
  - Modify: `src/core/agent/systemPrompt.ts`

- [ ] Replace the file body with:

```typescript
import { alwaysOnSkills } from '../skill/activator'
import type { Skill } from '../skill/types'
import type { MemoryEntry } from '../memdir/parser'
import type { OutputStyle } from '../outputStyles/types'
import { applyOutputStyle } from '../outputStyles/resolve'
import { renderTeamMemorySection } from '../memdir/teamMemPrompts'

export type SystemPromptInput = {
  cwd: string
  platform: string
  shell: string
  nodeVersion: string
  gitBranch: { branch: string; dirty: boolean } | null
  skills?: Skill[]
  /**
   * User-scoped memory (cross-project, single user). Reserved for a
   * follow-up iter that wires a `~/.nuka/user-memory/<sha1(uid)>/`
   * loader; declared here so the three-tier prompt ordering (user →
   * team → project) is locked in today and adding the loader later is
   * a pure data-source change with no prompt-builder churn.
   */
  userMemory?: MemoryEntry[]
  /**
   * Team-scoped memory loaded from
   * `~/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md` when
   * `config.teamId` is set. Empty array → section omitted (same as
   * project memory). Sits between user and project in the rendered
   * prompt; teams override user prefs, projects override teams.
   */
  teamMemory?: MemoryEntry[]
  /**
   * Project-scoped (per-cwd) memory. Phase 7 §5.3.  Caller resolves
   * relevance via `findRelevant` before passing in. Empty array →
   * section is omitted. Naming preserved as `memory` rather than
   * `projectMemory` so existing call sites compile unchanged.
   */
  memory?: MemoryEntry[]
  /**
   * Phase 8 §4.4 — injected under a `## Plan` heading when present AND
   * the active session is in plan mode. Callers should pass the raw
   * Markdown contents of the per-cwd plan file; the empty string is
   * treated as "no plan" and the section is omitted.
   */
  plan?: { active: boolean; body: string }
  /**
   * User-defined output style resolved upstream from
   * `.nuka/output-styles/*.md`. When present, the prompt is post-
   * processed by {@link applyOutputStyle}: appended under a
   * `## Output Style` header when `keepCodingInstructions` is true /
   * unset, or replacing the assembled base entirely when it is false.
   * Caller passes `null` (or omits the field) to skip merging — the
   * prompt then matches the pre-output-styles behaviour byte-for-byte.
   */
  outputStyle?: OutputStyle | null
}

function renderEntryBullets(heading: string, entries: readonly MemoryEntry[]): string[] {
  if (entries.length === 0) return []
  const out: string[] = ['', heading, '']
  for (const e of entries) {
    const kw = e.keywords.length > 0 ? ` [${e.keywords.join(', ')}]` : ''
    out.push(`- ${e.body}${kw}`)
  }
  return out
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const git = input.gitBranch
    ? `git: ${input.gitBranch.branch}${input.gitBranch.dirty ? ' (dirty)' : ''}`
    : 'git: (not a git repository)'
  const lines: string[] = [
    'You are Nuka, a terminal coding agent. Be concise. Act. Ask before destructive changes.',
    '',
    'Environment:',
    `  cwd: ${input.cwd}`,
    `  platform: ${input.platform}`,
    `  shell: ${input.shell}`,
    `  node: ${input.nodeVersion}`,
    `  ${git}`,
    '',
    'Tool usage:',
    '  - Use tools to read files, edit files, and run commands rather than guessing.',
    '  - Prefer Edit for targeted changes; Write when creating new files.',
    '  - Announce destructive shell commands before executing them.',
    '  - Report results briefly; let the user review diffs and outputs.',
  ]

  if (input.skills && input.skills.length > 0) {
    const active = alwaysOnSkills(input.skills)
    if (active.length > 0) {
      lines.push('', 'Skills:')
      for (const skill of active) {
        lines.push('', `# ${skill.name}`, '', skill.body)
      }
    }
  }

  // Memory tiers — emitted in user → team → project order so more-specific
  // scopes (project) win when downstream summarisers / dedupers see
  // overlapping entries. Each section is omitted entirely when its
  // entries array is empty or undefined.
  if (input.userMemory && input.userMemory.length > 0) {
    lines.push(...renderEntryBullets('## User Memory', input.userMemory))
  }
  if (input.teamMemory && input.teamMemory.length > 0) {
    lines.push(...renderTeamMemorySection(input.teamMemory))
  }
  if (input.memory && input.memory.length > 0) {
    lines.push(...renderEntryBullets('## Memory', input.memory))
  }

  if (input.plan?.active && input.plan.body.trim().length > 0) {
    lines.push('', '## Plan', '', input.plan.body.trimEnd())
  }

  const assembled = lines.join('\n')
  if (input.outputStyle) {
    return applyOutputStyle(assembled, input.outputStyle)
  }
  return assembled
}
```

- [ ] Run: `npx vitest run test/core/agent/systemPromptTeamMemory.test.ts` — expect PASS.
- [ ] Run: `npx vitest run test/core/agent/` — expect no regressions on existing system-prompt tests.
- [ ] Run: `npx tsc --noEmit` — expect no errors.

- [ ] Commit: `feat(prompt): three-tier memory ordering (user → team → project)`

---

## Task 9 — wire team memory into `cli.tsx`

- [ ] **Files:**
  - Modify: `src/cli.tsx`

- [ ] Add an import (near the existing memdir imports — grep for `from './core/memdir'` to find the site):

```typescript
import { loadMemory, loadTeamMemory, appendMemory } from './core/memdir'
```

(Replace the existing `import { loadMemory, appendMemory }` line — additive insertion of `loadTeamMemory`.)

- [ ] Find the line `let memoryCache: MemoryEntry[] = await loadMemory(cwd).catch(() => [])` (currently line 1212). Insert immediately AFTER:

```typescript
  // 2026-05-18 — team memory tier (config.teamId opt-in). Best-effort
  // load; failures fall through to empty so missing/corrupt team files
  // don't block startup. Refreshed alongside `memoryCache` on each turn.
  let teamMemoryCache: MemoryEntry[] = config.teamId
    ? await loadTeamMemory(config.teamId, cwd).catch(() => [])
    : []
```

- [ ] Find the `systemPromptInput: () => ({ ... })` block (currently line 1230). Augment the returned object with `teamMemory`:

```typescript
      systemPromptInput: () => ({
        cwd, platform, shell, nodeVersion, gitBranch, skills,
        memory: findRelevant(memoryCache, tokenize(input.text), 5),
        teamMemory: config.teamId
          ? findRelevant(teamMemoryCache, tokenize(input.text), 5)
          : undefined,
        outputStyle: resolveActiveOutputStyleNow(),
      }),
```

- [ ] Find the cache-refresh point inside `synthAndAppend` (currently line 1262): `memoryCache = await loadMemory(cwd).catch(() => memoryCache)`. Append immediately AFTER:

```typescript
      if (config.teamId) {
        teamMemoryCache = await loadTeamMemory(config.teamId, cwd).catch(
          () => teamMemoryCache,
        )
      }
```

- [ ] Run: `npx tsc --noEmit` — expect no errors.
- [ ] Run: `npx vitest run` — expect no regressions (team memory caches default to `[]` for any test fixture that omits `config.teamId`).

- [ ] Commit: `feat(cli): load team memory when config.teamId is set; thread into prompt`

---

## Task 10 — final verification

- [ ] Run full type-check: `npx tsc --noEmit` — clean.
- [ ] Run targeted tests: `npx vitest run test/core/memdir/ test/core/agent/ test/core/config/` — all green.
- [ ] Run full suite as smoke: `npx vitest run` — green modulo pre-existing skipped baselines.

- [ ] Manual smoke (optional, no commit needed): set `teamId: my-team` in `~/.nuka/config.yaml`, drop a hand-written entry into the expected MEMORY.md path (use `node -e "console.log(require('./dist/core/memdir/teamMemPaths').teamMemoryPath('my-team', process.cwd()))"` to print the path), run `nuka`, verify the prompt's `## Team Memory` section appears in `/debug prompt` output.

- [ ] Verify spec requirements:
  - [ ] `rg "teamId\?: " src/core/config/schema.ts` — one hit.
  - [ ] `rg "loadTeamMemory" src/` — at least two hits (`memdir/index.ts` declaration + `cli.tsx` consumer).
  - [ ] `rg "## Team Memory" src/` — one hit (`teamMemPrompts.ts`).
  - [ ] Three-tier ordering test passes: `npx vitest run test/core/agent/systemPromptTeamMemory.test.ts`.

---

## Self-review

- **Spec coverage**:
  - `teamId?: string` added to `ConfigSchema` (Task 1).
  - Disk layout `~/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md` implemented (Task 3); sibling to existing per-cwd memdir.
  - Prompt-injection rule "user → team → project" enforced (Tasks 7-8); test verifies absolute and relative order of all three headers.
  - Two source files ported: paths helper (`teamMemPaths.ts`, Task 3) + prompt-rendering helper (`teamMemPrompts.ts`, Task 6).
  - Tests cover: (a) no teamId → no team memory in prompt (Task 7, case 2); (b) with teamId → present (Task 7, case 4 + Task 4 load test); (c) hash collision across teams isolated (Task 4, cases 3-4 + Task 2 path test).
- **No placeholders**: every code block is complete and type-checks against current Nuka APIs (`MemoryEntry` shape verified against `src/core/memdir/parser.ts` which exposes `body` + `keywords` + `timestamp`; `Config` carries optional `teamId` after Task 1; `SystemPromptInput` extended in lockstep with the test in Task 7).
- **Type consistency**: every new field on `SystemPromptInput` is optional (no breaking change to existing callers); `loadTeamMemory` returns the same `MemoryEntry[]` as `loadMemory` so call sites can swap or merge transparently.
- **No new deps**: uses only `node:crypto`, `node:path`, `node:os`, `node:fs/promises`, `zod` (already a dep), and existing Nuka modules.
- **Additive, env opt-in default**: when `config.teamId` is absent, EVERY new code path returns the existing behaviour (empty arrays, omitted prompt sections, no disk I/O). The flag is `config.teamId` itself — explicit opt-in via config, no env var, no feature flag.
- **Strict TS**: no `any`, no `@ts-ignore`. Catch-block narrowing via `errnoCode` typeguard mirrors the rest of memdir.
- **Commit messages**: no `Co-Authored-By:` lines.
