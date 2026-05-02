# Spec B Implementation Plan — Modernize Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land worktree-as-thread (B1), persisted `/goal` (G1), and two-axis permission with real OS sandbox (S1) per `docs/superpowers/specs/2026-05-02-spec-b-modernize-core-design.md`.

**Architecture:** Nine milestones (M0–M8). M0 is blocking (schemas + paths + config wiring). After M0, three independent tracks may proceed in parallel:
- Worktree track: M1 → M2 → M3
- Goal track: M4 → M5
- Sandbox track: M6 → M7 → M8

Within each track the steps are sequential. All work is **test-first**: every new public type ships with a `*.test-d.ts` expectation, then unit tests, then implementation.

**Tech Stack:** TypeScript 5.6, Node ≥ 18, vitest 2.1, zod 4.3, picomatch (already in deps), `child_process.spawn`. No new npm dependencies. The OS-sandbox helpers ship outside the JS bundle (binary helper for Windows is platform-prebuild; static `.sb` template for macOS; bwrap is a runtime requirement on Linux).

**Source-of-truth spec:** `docs/superpowers/specs/2026-05-02-spec-b-modernize-core-design.md`

---

## File Structure

**New files (creation):**

```
src/core/worktree/
  types.ts                       § 5.1 — WorktreeMetadata + WorktreeRegistry zod
  manager.ts                     § 6.1.1 — WorktreeManager class
  resolver.ts                    § 6.1.2 — WorktreeResolver
  gitOps.ts                      § 6.1.3 — typed git invocations
  registry.ts                    § 6.1.4 — JSON-backed LRU registry
  snapshot.ts                    § 5.1 / 6.1.4 — tar.gz of evicted worktree
src/core/goal/
  types.ts                       § 5.2 — Goal + GoalState zod
  trace.ts                       § 5.3 / 6.3.2 — RolloutTraceRecord + writer
  registry.ts                    § 6.3.1 — GoalRegistry
src/core/permission/
  profile.ts                     § 5.4 — SandboxMode + ApprovalPolicy + PermissionProfile
  sandboxLauncher.ts             § 6.4.3 — SandboxLauncher interface + pick fn
  seatbeltLauncher.ts            § 5.6 — macOS Seatbelt
  bwrapLauncher.ts               § 5.7 — Linux bubblewrap
  windowsJobLauncher.ts          § 5.8 — Windows job-objects
  noopFallbackLauncher.ts        § 5.7 — fallback raw spawn with env-allowlist
  autoReview.ts                  § 6.4.4 — reviewer subagent invocation
  migration.ts                   § 5.5 — SessionMode → {sandboxMode, approvalPolicy}
src/slash/
  worktree.ts                    § 6.5 — /worktree on/off/status/list/adopt
  handoff.ts                     § 6.5 — /handoff with 4-row conflict table
  goal.ts                        § 6.3.3 — /goal new/list/pause/.../inject
  permission.ts                  § 6.5 — /permission show/use/escalate/list

assets/sandbox/
  seatbelt.sb.tmpl               § 5.6 — Seatbelt template
  COMPAT.md                      § 9 risk #12 — tested-versions table
assets/prompts/
  autoReviewSystem.md            § 6.4.4 — reviewer system prompt

test/core/worktree/
  types.test-d.ts
  manager.test.ts
  resolver.test.ts
  gitOps.test.ts
  registry.test.ts
  snapshot.test.ts
test/core/goal/
  types.test-d.ts
  registry.test.ts
  trace.test.ts
test/core/permission/
  profile.test.ts
  migration.test.ts
  checker.twoaxis.test.ts
  seatbeltLauncher.test.ts
  bwrapLauncher.test.ts
  windowsJobLauncher.test.ts
  autoReview.test.ts
test/slash/
  worktree.test.ts
  handoff.test.ts
  goal.test.ts
  permission.test.ts
test/integration/
  spec-b-worktree-handoff.test.ts
  spec-b-goal-trace.test.ts
  spec-b-permission-migration.test.ts
test/e2e/
  spec-b-bwrap.linux.test.ts     gated by platform === 'linux'
  spec-b-seatbelt.darwin.test.ts gated by platform === 'darwin'
```

**Modified files:**

```
src/core/paths.ts                add worktreesDir, worktreeSnapshotsDir, goalsDir, sandboxProfilesDir
                                 + extend ensureNukaLayout to create them
src/core/config/schema.ts        add WorktreeConfigSchema, GoalConfigSchema, PermissionConfigSchema
                                 + insert into top-level ConfigSchema
src/core/session/types.ts        add worktreeId?, permissionProfile?, goalId?,
                                 sandboxMode?, approvalPolicy? (additive only)
src/core/session/session.ts      createSession passes new optional fields through
src/core/session/store.ts        SessionMeta gains optional new fields; round-trip migration
src/core/permission/types.ts     PermissionCall gains sandboxMode?, approvalPolicy?, profile?
src/core/permission/checker.ts   5-step decision in check(); preserve plan-mode lockout
src/core/agent/loop.ts           prompt builder injects goal block when session.goalId set
src/slash/fork.ts                if parent has worktreeId, branch a new worktree
src/slash/rewind.ts              file checkpoint paths resolve via WorktreeResolver
src/cli.tsx                      construct WorktreeManager / GoalRegistry / sandbox launcher;
                                 attachGoalTraceWriter; pass into PermissionChecker;
                                 register slash commands
src/slash/registry.ts            register WorktreeCommand, HandoffCommand, GoalCommand,
                                 PermissionCommand
src/slash/doctor.ts              report sandbox availability (bwrap version, sandbox-exec,
                                 win-jobsandbox.exe, userns flag)
```

---

## Task 1: M0 — Worktree, Goal, RolloutTrace, PermissionProfile schemas

**Files:**
- Create: `src/core/worktree/types.ts`
- Create: `src/core/goal/types.ts`
- Create: `src/core/goal/trace.ts` (schema only this task)
- Create: `src/core/permission/profile.ts`
- Test: `test/core/worktree/types.test-d.ts`
- Test: `test/core/goal/types.test-d.ts`
- Test: `test/core/permission/profile.test.ts`

- [ ] **Step 1: Write the failing type tests**

`test/core/worktree/types.test-d.ts`:

```ts
import { expectTypeOf } from 'vitest'
import type { WorktreeMetadata, WorktreeRegistry } from '../../../src/core/worktree/types'

expectTypeOf<WorktreeMetadata>().toHaveProperty('id').toEqualTypeOf<string>()
expectTypeOf<WorktreeMetadata>().toHaveProperty('path').toEqualTypeOf<string>()
expectTypeOf<WorktreeMetadata>().toHaveProperty('lastTouchedAt').toEqualTypeOf<number>()
expectTypeOf<WorktreeRegistry>().toHaveProperty('entries').toBeArray()
```

`test/core/goal/types.test-d.ts`:

```ts
import { expectTypeOf } from 'vitest'
import type { Goal, GoalState } from '../../../src/core/goal/types'

expectTypeOf<GoalState>().toEqualTypeOf<'active' | 'paused' | 'completed' | 'archived'>()
expectTypeOf<Goal>().toHaveProperty('rolloutTraceFile').toEqualTypeOf<string>()
expectTypeOf<Goal>().toHaveProperty('sessions').toBeArray()
```

`test/core/permission/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  PermissionProfileSchema,
  SandboxModeSchema,
  ApprovalPolicySchema,
  PermissionConfigSchema,
} from '../../../src/core/permission/profile'

describe('PermissionProfileSchema', () => {
  it('parses a strict default profile', () => {
    const p = PermissionProfileSchema.parse({
      name: 'strict',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    })
    expect(p.envAllowlist).toContain('HOME')
    expect(p.autoReview).toBe(false)
    expect(p.denyReadGlobs).toEqual([])
  })

  it('rejects bad name', () => {
    expect(() => PermissionProfileSchema.parse({
      name: '1bad',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
    })).toThrow()
  })

  it('exposes the three sandbox modes', () => {
    expect(SandboxModeSchema.options).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
  })

  it('exposes the three approval policies', () => {
    expect(ApprovalPolicySchema.options).toEqual(['untrusted', 'on-request', 'never'])
  })

  it('PermissionConfig defaults', () => {
    const c = PermissionConfigSchema.parse({})
    expect(c.profiles).toEqual({})
    expect(c.defaultProfile).toBe('strict')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```
npx vitest run test/core/permission/profile.test.ts
npx tsc --noEmit -p tsconfig.test.json
```

Expected: cannot find modules.

- [ ] **Step 3: Implement `src/core/worktree/types.ts`** — full Zod from spec §5.1.

- [ ] **Step 4: Implement `src/core/goal/types.ts`** — full Zod from spec §5.2.

- [ ] **Step 5: Implement `src/core/goal/trace.ts`** (schema-only this task; writer in Task 14):

```ts
import { z } from 'zod'

export const RolloutTraceRecordSchema = z.discriminatedUnion('kind', [
  // 5 arms exactly as in spec §5.3 …
])
export type RolloutTraceRecord = z.infer<typeof RolloutTraceRecordSchema>
```

- [ ] **Step 6: Implement `src/core/permission/profile.ts`** — full Zod from spec §5.4.

- [ ] **Step 7: Run tests — verify they pass**

```
npx vitest run test/core/worktree/types.test-d.ts test/core/goal/types.test-d.ts test/core/permission/profile.test.ts
npx tsc --noEmit -p tsconfig.test.json
```

- [ ] **Step 8: Commit**

```bash
git add src/core/worktree/types.ts src/core/goal/types.ts src/core/goal/trace.ts src/core/permission/profile.ts test/core/worktree/types.test-d.ts test/core/goal/types.test-d.ts test/core/permission/profile.test.ts
git commit -m "feat(spec-b/m0): zod schemas for worktree, goal, rollout-trace, permission profile"
```

**LOC est.:** 220. **Acceptance:** all schemas parse defaults; type tests green.

---

## Task 2: M0 — paths.ts and ensureNukaLayout extensions

**Files:**
- Modify: `src/core/paths.ts`
- Test: `test/core/paths.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Append to `test/core/paths.test.ts`:

```ts
it('ensureNukaLayout creates worktree, goal, and sandbox-profile dirs', () => {
  const tmp = mkTempDir()
  ensureNukaLayout(tmp)
  expect(fs.existsSync(path.join(tmp, '.nuka', 'worktrees'))).toBe(true)
  expect(fs.existsSync(path.join(tmp, '.nuka', 'worktree-snapshots'))).toBe(true)
  expect(fs.existsSync(path.join(tmp, '.nuka', 'goals'))).toBe(true)
  expect(fs.existsSync(path.join(tmp, '.nuka', 'sandbox-profiles'))).toBe(true)
})
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Edit `src/core/paths.ts`** — add 4 helpers:

```ts
export function worktreesDir(home: string): string {
  return path.join(nukaHome(home), 'worktrees')
}
export function worktreeSnapshotsDir(home: string): string {
  return path.join(nukaHome(home), 'worktree-snapshots')
}
export function goalsDir(home: string): string {
  return path.join(nukaHome(home), 'goals')
}
export function sandboxProfilesDir(home: string): string {
  return path.join(nukaHome(home), 'sandbox-profiles')
}
```

Then extend `ensureNukaLayout`'s `dirs` array with the four new entries.

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(spec-b/m0): paths.ts adds worktree/goal/sandbox-profile dirs"
```

**LOC est.:** 30. **Acceptance:** all 4 dirs exist after `ensureNukaLayout`.

---

## Task 3: M0 — config/schema.ts WorktreeConfig + GoalConfig + PermissionConfig

**Files:**
- Modify: `src/core/config/schema.ts`
- Test: `test/core/config/schema.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it('parses worktree, goal, permission config defaults', () => {
  const cfg = ConfigSchema.parse({
    providers: [],
    active: { providerId: 'p' },
    worktree: {},
    goal: {},
    permission: {},
  })
  expect(cfg.worktree?.lruCap).toBe(15)
  expect(cfg.worktree?.snapshotRetentionDays).toBe(14)
  expect(cfg.goal?.autoBindActive).toBe(false)
  expect(cfg.permission?.defaultProfile).toBe('strict')
})
```

- [ ] **Step 2: Add schemas to `src/core/config/schema.ts`** — WorktreeConfigSchema (lruCap default 15, snapshotRetentionDays default 14, enabledByDefault default false), GoalConfigSchema, PermissionConfigSchema (re-export). Insert under `ConfigSchema`.

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

**LOC est.:** 60. **Acceptance:** ConfigSchema typechecks new keys; defaults verified.

---

## Task 4: M0 — Session model additive fields + migration

**Files:**
- Modify: `src/core/session/types.ts`
- Modify: `src/core/session/session.ts`
- Modify: `src/core/session/store.ts`
- Create: `src/core/permission/migration.ts`
- Test: `test/core/permission/migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

```ts
import { describe, it, expect } from 'vitest'
import { migrateSessionMode } from '../../../src/core/permission/migration'

describe('migrateSessionMode', () => {
  it('normal → {workspace-write, on-request}', () => {
    expect(migrateSessionMode('normal')).toEqual({
      sandboxMode: 'workspace-write', approvalPolicy: 'on-request',
    })
  })
  it('plan → {read-only, on-request}', () => {
    expect(migrateSessionMode('plan')).toEqual({
      sandboxMode: 'read-only', approvalPolicy: 'on-request',
    })
  })
  it('bypass → {danger-full-access, never}', () => {
    expect(migrateSessionMode('bypass')).toEqual({
      sandboxMode: 'danger-full-access', approvalPolicy: 'never',
    })
  })
})
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement `src/core/permission/migration.ts`**

```ts
import type { SandboxMode, ApprovalPolicy } from './profile'
import type { SessionMode } from '../session/types'

export type StructuredMode = { sandboxMode: SandboxMode; approvalPolicy: ApprovalPolicy }

const TABLE: Record<SessionMode, StructuredMode> = {
  normal: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' },
  plan:   { sandboxMode: 'read-only',       approvalPolicy: 'on-request' },
  bypass: { sandboxMode: 'danger-full-access', approvalPolicy: 'never' },
}

export function migrateSessionMode(mode: SessionMode): StructuredMode {
  return TABLE[mode]
}
```

- [ ] **Step 4: Edit `src/core/session/types.ts`** — add additive fields:

```ts
import type { SandboxMode, ApprovalPolicy } from '../permission/profile'

export type Session = {
  // …existing fields
  /** § 6.2 G1 */
  worktreeId?: string
  /** § 6.2 G3 */
  permissionProfile?: string
  /** § 6.2 G2 */
  goalId?: string
  /** § 6.2 G3 — takes precedence over `mode` when both set. */
  sandboxMode?: SandboxMode
  approvalPolicy?: ApprovalPolicy
}
```

- [ ] **Step 5: Edit `src/core/session/session.ts`** — `createSession` accepts new optional fields:

```ts
export function createSession(opts: {
  // …existing fields
  worktreeId?: string
  permissionProfile?: string
  goalId?: string
  sandboxMode?: SandboxMode
  approvalPolicy?: ApprovalPolicy
}): Session {
  return {
    // …existing
    worktreeId: opts.worktreeId,
    permissionProfile: opts.permissionProfile,
    goalId: opts.goalId,
    sandboxMode: opts.sandboxMode,
    approvalPolicy: opts.approvalPolicy,
  }
}
```

- [ ] **Step 6: Edit `src/core/session/store.ts`** — extend `SessionMeta` round-trip with the same fields; on resume, if `sandboxMode === undefined`, synthesise from `mode` via `migrateSessionMode`.

- [ ] **Step 7: Run — passes**

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(spec-b/m0): Session gains worktreeId, permissionProfile, goalId, two-axis mode (legacy mode kept one release)"
```

**LOC est.:** 120. **Acceptance:** existing session-store round-trip stays green; new fields persist.

---

## Task 5: M1 — gitOps.ts typed git invocations

**Files:**
- Create: `src/core/worktree/gitOps.ts`
- Test: `test/core/worktree/gitOps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import * as childProc from 'node:child_process'
import { worktreeAdd, GitError } from '../../../src/core/worktree/gitOps'

vi.mock('node:child_process')

describe('worktreeAdd', () => {
  it('parses base commit from stdout', async () => {
    vi.mocked(childProc.spawn).mockReturnValueOnce({
      // mock stdout/stderr/exit per project convention
    } as any)
    const r = await worktreeAdd({ repoRoot: '/r', path: '/r/.nuka/worktrees/sess', branch: 'main' })
    expect(r.baseCommit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('maps "is already checked out" stderr to GitError(branch-in-use)', async () => {
    // mock spawn returning exit code 128 with the canonical stderr string
    await expect(worktreeAdd({ /* … */ })).rejects.toMatchObject({
      kind: 'branch-in-use',
    })
  })
})
```

(Use the project's existing `runChildProcess` mock pattern; reference `test/core/tasks/run-bash.test.ts` for the pattern in this codebase.)

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement gitOps.ts** — pure functions, all spawn `git -C <path> …`. Implement `worktreeAdd`, `worktreeRemove`, `worktreeIsClean`, `worktreeStash`, `listWorktrees`, plus `GitError` class. The error mapper inspects stderr substrings:

```ts
function mapStderr(stderr: string): GitErrorKind {
  if (stderr.includes('is already checked out')) return 'branch-in-use'
  if (stderr.includes('contains modified or untracked')) return 'dirty-tree'
  if (stderr.includes('No such file or directory')) return 'worktree-missing'
  return 'unknown'
}
```

Each fn returns/throws as documented in spec §6.1.3.

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(spec-b/m1): typed gitOps wrapper for worktree add/remove/clean/stash/list"
```

**LOC est.:** 200. **Acceptance:** all 5 GitErrorKinds testable from canonical stderr fixtures.

---

## Task 6: M1 — WorktreeRegistry JSON-backed LRU

**Files:**
- Create: `src/core/worktree/registry.ts`
- Test: `test/core/worktree/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('WorktreeRegistry', () => {
  it('round-trips empty registry', async () => {
    const r = new WorktreeRegistry({ home: tmp })
    await r.load()
    expect(r.list()).toEqual([])
  })

  it('append puts new entry at MRU; touch bumps to MRU', async () => {
    const r = new WorktreeRegistry({ home: tmp, lruCap: 3 })
    await r.load()
    await r.append(meta('a'))
    await r.append(meta('b'))
    await r.append(meta('c'))
    await r.touch('a')
    expect(r.list().map(e => e.id)).toEqual(['a', 'c', 'b'])
  })

  it('append over cap returns the evicted entry', async () => {
    const r = new WorktreeRegistry({ home: tmp, lruCap: 2 })
    await r.append(meta('a'))
    await r.append(meta('b'))
    const evicted = await r.append(meta('c'))
    expect(evicted?.id).toBe('a')
    expect(r.list().map(e => e.id)).toEqual(['c', 'b'])
  })

  it('atomic write survives mid-write crash', async () => {
    // simulate by writing via tmpfile + rename; verify final file is well-formed
  })
})
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement `src/core/worktree/registry.ts`**

```ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { WorktreeRegistrySchema, type WorktreeMetadata } from './types'
import { worktreesDir } from '../paths'

export class WorktreeRegistry {
  private entries: WorktreeMetadata[] = []
  private readonly file: string
  private readonly lruCap: number

  constructor(opts: { home: string; lruCap?: number }) {
    this.file = path.join(worktreesDir(opts.home), '.registry.json')
    this.lruCap = opts.lruCap ?? 15
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = WorktreeRegistrySchema.parse(JSON.parse(raw))
      this.entries = parsed.entries
    } catch {
      this.entries = []
    }
  }

  async append(m: WorktreeMetadata): Promise<WorktreeMetadata | undefined> {
    this.entries = [m, ...this.entries.filter(e => e.id !== m.id)]
    let evicted: WorktreeMetadata | undefined
    if (this.entries.length > this.lruCap) {
      evicted = this.entries.pop()
    }
    await this.flush()
    return evicted
  }

  async touch(id: string): Promise<void> {
    const idx = this.entries.findIndex(e => e.id === id)
    if (idx < 0) return
    const [m] = this.entries.splice(idx, 1)
    m!.lastTouchedAt = Date.now()
    this.entries.unshift(m!)
    await this.flush()
  }

  async remove(id: string): Promise<void> {
    this.entries = this.entries.filter(e => e.id !== id)
    await this.flush()
  }

  list(): WorktreeMetadata[] { return [...this.entries] }
  find(id: string): WorktreeMetadata | undefined {
    return this.entries.find(e => e.id === id)
  }

  private async flush(): Promise<void> {
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ version: 1, entries: this.entries }, null, 2), 'utf8')
    await fs.rename(tmp, this.file)
  }
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

**LOC est.:** 110. **Acceptance:** LRU + atomic write tests all green.

---

## Task 7: M1 — WorktreeManager attach / detach / find / list / adopt

**Files:**
- Create: `src/core/worktree/manager.ts`
- Create: `src/core/worktree/snapshot.ts`
- Test: `test/core/worktree/manager.test.ts`
- Test: `test/core/worktree/snapshot.test.ts`

- [ ] **Step 1: Write the failing manager test**

```ts
describe('WorktreeManager.attach + detach', () => {
  let repo: string
  beforeEach(async () => {
    repo = await mkGitRepo()  // helper: init + commit one file
  })

  it('attach round-trips clean detach', async () => {
    const mgr = new WorktreeManager({ home: tmp, bus })
    await mgr.load()
    const session = mkSession()
    const meta = await mgr.attach({ session, repoRoot: repo })
    expect(fs.existsSync(meta.path)).toBe(true)
    expect(meta.id).toBe(session.id)
    expect(meta.baseCommit).toMatch(/^[0-9a-f]{40}$/)

    await mgr.detach(session.id, 'clean')
    expect(fs.existsSync(meta.path)).toBe(false)
  })

  it('LRU eviction at cap+1 produces a snapshot', async () => {
    const mgr = new WorktreeManager({ home: tmp, bus, lruCap: 2 })
    await mgr.load()
    await mgr.attach({ session: mkSession('a'), repoRoot: repo })
    await mgr.attach({ session: mkSession('b'), repoRoot: repo })
    await mgr.attach({ session: mkSession('c'), repoRoot: repo })
    const snaps = fs.readdirSync(path.join(tmp, '.nuka', 'worktree-snapshots'))
    expect(snaps.length).toBe(1)
    expect(snaps[0]).toMatch(/^a-\d+\.tar\.gz$/)
  })

  it('orphan adoption recovers a directory not in registry', async () => {
    const orphan = await mkOrphanWorktree(repo)
    const mgr = new WorktreeManager({ home: tmp, bus })
    await mgr.load()
    const meta = await mgr.adopt('sess-orphan', orphan)
    expect(meta.path).toBe(orphan)
    expect(mgr.find('sess-orphan')).toBeTruthy()
  })

  it('detach mode=stash preserves changes via git stash', async () => {
    // attach, write a file inside the worktree, detach 'stash'
    // verify `git stash list` shows the entry
  })
})
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement `src/core/worktree/snapshot.ts`**

```ts
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { worktreeSnapshotsDir } from '../paths'

export async function snapshotWorktree(opts: {
  home: string
  sessionId: string
  worktreePath: string
}): Promise<string> {
  const out = path.join(
    worktreeSnapshotsDir(opts.home),
    `${opts.sessionId}-${Date.now()}.tar.gz`,
  )
  await new Promise<void>((res, rej) => {
    const p = spawn('tar', ['-czf', out, '-C', opts.worktreePath, '.'], { stdio: 'ignore' })
    p.on('exit', code => code === 0 ? res() : rej(new Error(`tar exit ${code}`)))
    p.on('error', rej)
  })
  return out
}

export async function sweepOldSnapshots(home: string, retentionDays: number): Promise<number> {
  const dir = worktreeSnapshotsDir(home)
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  // delete files with mtimeMs < cutoff; return count
}
```

- [ ] **Step 4: Implement `src/core/worktree/manager.ts`**

Implements the full `WorktreeManager` class per spec §6.1.1. Key bits:

- `attach()`: calls `worktreeAdd`, builds `WorktreeMetadata`, calls `registry.append(meta)`, on eviction → `snapshotWorktree` then `worktreeRemove`, emits `task.created` / `task.evicted` on bus.
- `detach(sessionId, mode)`: switch on mode:
  - `clean`: call `worktreeIsClean`; if dirty throw; else `worktreeRemove`.
  - `stash`: `worktreeStash` then `worktreeRemove`.
  - `snapshot`: `snapshotWorktree` then `worktreeRemove --force`.
  - `force`: `worktreeRemove --force`.
- `resolveCwd`, `touch`, `list`, `find`, `adopt` per spec.

- [ ] **Step 5: Run — passes**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(spec-b/m1): WorktreeManager with LRU eviction + snapshot tar.gz"
```

**LOC est.:** 380. **Acceptance:** 4 manager tests green; snapshot tar verified by extracting and listing.

---

## Task 8: M1 — Boot wiring for WorktreeManager

**Files:**
- Modify: `src/cli.tsx`

- [ ] **Step 1: Add construction immediately after `ensureNukaLayout(home)`**

```ts
const worktreeMgr = new WorktreeManager({
  home,
  bus: eventBus,
  lruCap: config.worktree?.lruCap,
  snapshotRetentionDays: config.worktree?.snapshotRetentionDays,
})
await worktreeMgr.load()
const worktreeResolver = new WorktreeResolver(worktreeMgr)
```

- [ ] **Step 2: Add boot retention sweep call**

```ts
try {
  await sweepOldSnapshots(home, config.worktree?.snapshotRetentionDays ?? 14)
} catch (err) {
  process.stderr.write(`[nuka] worktree snapshot sweep failed: ${(err as Error).message}\n`)
}
```

- [ ] **Step 3: typecheck + run**

- [ ] **Step 4: Commit**

**LOC est.:** 30. **Acceptance:** existing `npm test` stays green; manual `nuka` boots cleanly with empty `~/.nuka/worktrees/`.

---

## Task 9: M2 — WorktreeResolver + tool cwd injection

**Files:**
- Create: `src/core/worktree/resolver.ts`
- Modify: `src/core/tools/read.ts`, `write.ts`, `edit.ts`, `bash.ts`, `grep.ts`, `glob.ts` (cwd injection)
- Test: `test/core/worktree/resolver.test.ts`

- [ ] **Step 1: Write the failing resolver test**

```ts
describe('WorktreeResolver', () => {
  it('returns process.cwd() when no worktreeId', () => {
    const r = new WorktreeResolver(mgr)
    expect(r.cwd({ id: 's1' } as Session)).toBe(process.cwd())
  })
  it('returns worktree path and touches LRU', async () => {
    const m = await mgr.attach({ session: mkSession('s2'), repoRoot: repo })
    const r = new WorktreeResolver(mgr)
    expect(r.cwd({ id: 's2', worktreeId: 's2' } as Session)).toBe(m.path)
    // touch was bumped: list[0].id === 's2'
  })
  it('orphaned worktreeId silently degrades to process.cwd()', () => {
    const r = new WorktreeResolver(mgr)
    expect(r.cwd({ id: 'x', worktreeId: 'x' } as Session)).toBe(process.cwd())
  })
})
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement resolver per spec §6.1.2**

- [ ] **Step 4: Inject resolver into tool runners**

For each of Read/Write/Edit/Bash/Grep/Glob, change the cwd resolution to call the resolver. The cleanest path is to extend the tool's `Ctx` parameter (the project already passes a context with `session`); inside the runner replace `process.cwd()` with `resolver.cwd(ctx.session)`.

`src/core/tools/bash.ts` — inside `run()`:

```ts
const cwd = ctx.worktreeResolver?.cwd(ctx.session) ?? process.cwd()
const proc = spawn(command, args, { cwd, env, /* … */ })
```

Same for `Read`/`Write`/`Edit` (resolve relative paths against `resolver.cwd`); for `Grep`/`Glob` (default search root).

The resolver is wired into `RunCtx` at registry construction in `src/cli.tsx`.

- [ ] **Step 5: Run all existing tool tests + new resolver tests**

```
npx vitest run test/core/worktree/resolver.test.ts test/core/tools/
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(spec-b/m2): WorktreeResolver injects cwd into Read/Write/Edit/Bash/Grep/Glob"
```

**LOC est.:** 220. **Acceptance:** existing tool tests stay green; new resolver test green; manual smoke: a `Read` inside a worktree-backed session reads from the worktree.

---

## Task 10: M2 — /worktree slash command

**Files:**
- Create: `src/slash/worktree.ts`
- Test: `test/slash/worktree.test.ts`
- Modify: `src/cli.tsx` — register

- [ ] **Step 1: Write the failing test**

```ts
describe('/worktree', () => {
  it('on attaches a worktree to the active session', async () => {
    const ctx = mkSlashCtx({ /* session, worktreeMgr, … */ })
    const r = await WorktreeCommand.run('on', ctx)
    expect(r.type).toBe('text')
    expect(ctx.sessions.active()?.worktreeId).toBe(ctx.sessions.active()?.id)
  })
  it('off detaches with mode=clean', async () => { /* … */ })
  it('status renders meta', async () => { /* … */ })
  it('list returns LRU-ordered table', async () => { /* … */ })
  it('adopt <path> rescues orphans', async () => { /* … */ })
})
```

- [ ] **Step 2: Implement `src/slash/worktree.ts`** — switch on `args.split(' ')[0]`. Sub-commands: `on`, `off`, `status`, `list`, `adopt <path>`. Each branch calls `ctx.worktreeMgr.{attach, detach, find, list, adopt}` and returns `{type:'text', text:…}` or `{type:'dialog', dialog:…}` per existing slash patterns.

- [ ] **Step 3: Register in `src/cli.tsx`**

```ts
slashRegistry.register(WorktreeCommand)
```

Add `worktreeMgr` to `SlashContext` (extend `src/slash/types.ts`).

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

**LOC est.:** 180. **Acceptance:** all 5 sub-command tests green.

---

## Task 11: M3 — /handoff slash with 4-row conflict table

**Files:**
- Create: `src/slash/handoff.ts`
- Test: `test/slash/handoff.test.ts` + `test/integration/spec-b-worktree-handoff.test.ts`

- [ ] **Step 1: Write the failing integration test (covers all 4 rows)**

```ts
describe('/handoff conflict table', () => {
  it('clean tree: in-place handoff removes worktree', async () => {
    // attach worktree, no edits, /handoff in-place → worktreeId cleared, dir removed
  })
  it('dirty tree + stash: stashes and removes', async () => {
    // attach, write file, /handoff in-place stash → git stash list shows entry
  })
  it('dirty tree + abort: leaves worktree intact', async () => {
    // attach, write file, /handoff in-place abort → worktreeId still set, dir still present
  })
  it('branch-already-checked-out: refuses', async () => {
    // checkout a branch in primary repo, attempt /handoff worktree --branch X → refused
  })
  it('worktree dir missing on disk: clears worktreeId without git error', async () => {
    // attach, rm -rf the dir externally, /handoff in-place → worktreeId cleared, no throw
  })
})
```

- [ ] **Step 2: Implement `src/slash/handoff.ts`**

```ts
export const HandoffCommand: SlashCommand = {
  name: 'handoff',
  description: 'Swap the active session between in-place and worktree',
  usage: '/handoff [in-place|worktree] [--snapshot|--stash|--force]',
  async run(args, ctx) {
    const session = ctx.sessions.active()
    if (!session) return { type: 'text', text: 'No active session.' }
    const tokens = args.trim().split(/\s+/)
    const target = tokens[0] ?? (session.worktreeId ? 'in-place' : 'worktree')
    const mode = tokens.includes('--snapshot') ? 'snapshot'
               : tokens.includes('--stash') ? 'stash'
               : tokens.includes('--force') ? 'force'
               : 'clean'

    if (target === 'in-place' && session.worktreeId) {
      try {
        await ctx.worktreeMgr.detach(session.id, mode as DetachMode)
        session.worktreeId = undefined
        return { type: 'text', text: `Handed off to in-place (mode=${mode}).` }
      } catch (err) {
        const e = err as GitError
        if (e.kind === 'dirty-tree') {
          return { type: 'dialog', dialog: { kind: 'handoff-dirty', sessionId: session.id } }
        }
        if (e.kind === 'worktree-missing') {
          session.worktreeId = undefined
          return { type: 'text', text: 'Worktree directory missing; cleared id.' }
        }
        return { type: 'text', text: `Handoff failed: ${e.message}` }
      }
    }

    if (target === 'worktree' && !session.worktreeId) {
      try {
        const meta = await ctx.worktreeMgr.attach({ session })
        session.worktreeId = meta.id
        return { type: 'text', text: `Handed off to worktree at ${meta.path}.` }
      } catch (err) {
        const e = err as GitError
        if (e.kind === 'branch-in-use') {
          return { type: 'text', text: `Refused: ${e.stderr.trim()} (run \`git worktree list\`)` }
        }
        return { type: 'text', text: `Handoff failed: ${e.message}` }
      }
    }

    return { type: 'text', text: `Already at ${target}.` }
  },
}
```

- [ ] **Step 3: Implement the `handoff-dirty` dialog handler in TUI** (mirror existing `message-selector` dialog wiring in `src/tui/`).

- [ ] **Step 4: Run integration test — verify all 4 rows pass**

- [ ] **Step 5: Commit**

**LOC est.:** 240. **Acceptance:** integration test passes for all 5 scenarios in §4.3.

---

## Task 12: M3 — /fork extension to branch a worktree; /rewind worktree-relative

**Files:**
- Modify: `src/slash/fork.ts`
- Modify: `src/slash/rewind.ts`
- Modify: `src/core/rewind/checkpoint.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('/fork from worktree-backed session', () => {
  it('creates a new worktree branched from the same baseCommit', async () => {
    // attach worktree to s1, write a file, /fork → new session s2 with own worktree
    // s2.worktreeId !== s1.worktreeId, both share baseCommit
  })
})

describe('/rewind worktree-relative', () => {
  it('captureFileSnapshot resolves against worktree path when set', async () => {
    // session has worktreeId; loop writes to worktree; checkpoint records worktree path
  })
})
```

- [ ] **Step 2: Edit `src/slash/fork.ts`** — when parent has `worktreeId`, call `ctx.worktreeMgr.attach({ session: forkedSession })` after `forkSession()`. Effect now becomes:

```ts
{ kind: 'fork-session', branchWorktree: true }
```

- [ ] **Step 3: Edit `src/core/rewind/checkpoint.ts` `filePathsFromToolInput`** — accept an optional `cwd` param (resolved from the worktree resolver) and resolve relative paths against it.

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

**LOC est.:** 110. **Acceptance:** both new tests pass; existing `/fork` and `/rewind` tests still green.

---

## Task 13: M4 — GoalRegistry CRUD + atomic JSON write

**Files:**
- Create: `src/core/goal/registry.ts`
- Test: `test/core/goal/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('GoalRegistry', () => {
  it('create writes JSON and returns Goal', async () => {
    const reg = new GoalRegistry({ home: tmp, bus })
    await reg.load()
    const g = await reg.create({ name: 'refactor permissions', description: 'spec-b/g3' })
    expect(g.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(fs.existsSync(path.join(tmp, '.nuka', 'goals', `${g.id}.json`))).toBe(true)
  })

  it('setState bumps updatedAt and persists', async () => {
    const reg = await mkRegistryWithGoal()
    const before = reg.find(id)!.updatedAt
    await wait(2)
    const after = await reg.setState(id, 'paused')
    expect(after.state).toBe('paused')
    expect(after.updatedAt).toBeGreaterThan(before)
  })

  it('addSession is idempotent', async () => {
    await reg.addSession(id, 's1')
    await reg.addSession(id, 's1')
    expect(reg.find(id)!.sessions).toEqual(['s1'])
  })

  it('quarantines invalid JSON on hydrate', async () => {
    fs.writeFileSync(path.join(tmp, '.nuka', 'goals', 'bad.json'), '{not json')
    const reg = new GoalRegistry({ home: tmp, bus })
    await reg.load()
    expect(fs.existsSync(path.join(tmp, '.nuka', 'goals', '.quarantine', 'bad.json'))).toBe(true)
  })

  it('list filters by state and label', async () => {
    // create 3 goals with mixed states/labels; assert list({state:'active'}).length and list({label:'x'}).length
  })

  it('rolloutTraceFile path matches goalId', () => {
    const reg = new GoalRegistry({ home: tmp, bus })
    expect(reg.rolloutTraceFile('GID')).toMatch(/goals\/GID\.ndjson$/)
  })
})
```

- [ ] **Step 2: Implement `src/core/goal/registry.ts`** per spec §6.3.1. Highlights:

- `create()` generates ULID via `ulid()`, builds `Goal`, calls `persist(g)`.
- `persist()` writes `<id>.json.tmp` then `rename`.
- `load()` scans `goalsDir(home)`, parses each file via `GoalSchema`, quarantines on parse error.
- `setState`, `setSummary`, `addSession`, `removeSession`, `note` all mutate in-memory + persist.
- `note` appends a `goal.note` record to the rollout NDJSON via the trace writer (Task 14 dependency).

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

**LOC est.:** 240. **Acceptance:** all 6 tests green; quarantine path observable.

---

## Task 14: M4 — GoalTraceWriter (bus subscriber)

**Files:**
- Modify: `src/core/goal/trace.ts` — append the `attachGoalTraceWriter` function
- Test: `test/core/goal/trace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('attachGoalTraceWriter', () => {
  it('appends only for sessionIds bound to a goal', async () => {
    const reg = await mkRegistry()
    const g = await reg.create({ name: 'x', description: 'y' })
    await reg.addSession(g.id, 'sess-A')
    const detach = attachGoalTraceWriter({
      bus, registry: reg,
      goalFor: id => id === 'sess-A' ? g.id : undefined,
    })
    bus.emit('agent', { type: 'agent.message.assistant', sessionId: 'sess-A', text: 'hi'.repeat(200) })
    bus.emit('agent', { type: 'agent.message.assistant', sessionId: 'sess-OTHER', text: 'no' })
    detach()
    const lines = fs.readFileSync(reg.rolloutTraceFile(g.id), 'utf8').trim().split('\n')
    expect(lines.length).toBe(1)
    const rec = JSON.parse(lines[0]!) as RolloutTraceRecord
    expect(rec.kind).toBe('agent.message.assistant')
    expect((rec as any).excerpt.length).toBeLessThanOrEqual(280)
  })

  it('seq is monotonic per goal across topics', async () => {
    // emit task.created, harness.stage.enter, agent.message.assistant
    // verify all 3 records have seq 0, 1, 2
  })

  it('cursor sidecar is written after append', async () => {
    // verify <id>.<seq>.cursor file exists with correct integer
  })

  it('rotates ndjson > 50 MB to .gz', async () => {
    // mock fs.statSync to return size > 50MB; emit; verify rotation
  })
})
```

- [ ] **Step 2: Implement the writer**

```ts
export function attachGoalTraceWriter(opts: GoalTraceWriterOpts): () => void {
  const offs: Array<() => void> = []
  const seqs = new Map<string, number>()  // goalId → next seq

  function append(goalId: string, rec: Omit<RolloutTraceRecord, 'seq'>): void {
    const seq = (seqs.get(goalId) ?? 0)
    const out = { ...rec, seq } as RolloutTraceRecord
    const file = opts.registry.rolloutTraceFile(goalId)
    fs.appendFileSync(file, JSON.stringify(out) + '\n', 'utf8')
    seqs.set(goalId, seq + 1)
    fs.writeFileSync(file + '.cursor', String(seq + 1), 'utf8')
    // rotate if > 50 MB
    if (fs.statSync(file).size > 50 * 1024 * 1024) rotate(file)
  }

  offs.push(opts.bus.subscribe('task', (e) => {
    if (e.type === 'task.created') {
      const sessionId = (e.task as any).sessionId
      const goalId = sessionId && opts.goalFor(sessionId)
      if (goalId) append(goalId, {
        kind: 'task.created', t: Date.now(),
        sessionId, taskId: e.task.id, taskKind: e.task.kind,
        description: e.task.description,
      })
    }
    if (e.type === 'task.state') {
      // similar lookup; may need to read sessionId from in-memory task map
    }
  }))
  offs.push(opts.bus.subscribe('agent', (e) => {
    if (e.type === 'agent.message.assistant') {
      const goalId = opts.goalFor(e.sessionId)
      if (goalId) append(goalId, {
        kind: 'agent.message.assistant', t: Date.now(),
        sessionId: e.sessionId, excerpt: e.text.slice(0, 280),
      })
    }
  }))
  offs.push(opts.bus.subscribe('harness', (e) => {
    if (e.type === 'harness.stage.enter') {
      const goalId = opts.goalFor(e.sessionId)
      if (goalId) append(goalId, {
        kind: 'harness.stage.enter', t: Date.now(),
        sessionId: e.sessionId, stage: e.stage,
      })
    }
  }))

  return () => offs.forEach(o => o())
}
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

**LOC est.:** 200. **Acceptance:** all 4 trace tests pass; sidecar reconciliation tested by deleting NDJSON and recovering from cursor.

---

## Task 15: M4 — Boot wiring for GoalRegistry + trace writer

**Files:**
- Modify: `src/cli.tsx`
- Modify: `src/slash/types.ts` — extend `SlashContext` with `goalRegistry`

- [ ] **Step 1: Add to boot**

```ts
const goalRegistry = new GoalRegistry({ home, bus: eventBus })
await goalRegistry.load()
const detachGoalTrace = attachGoalTraceWriter({
  bus: eventBus,
  registry: goalRegistry,
  goalFor: sid => sessionMgr.list().find(s => s.id === sid)?.goalId,
})
process.on('beforeExit', detachGoalTrace)
```

- [ ] **Step 2: Extend `SlashContext`**

```ts
export type SlashContext = {
  // …
  goalRegistry: GoalRegistry
  worktreeMgr: WorktreeManager
}
```

- [ ] **Step 3: Run typecheck + existing tests**

- [ ] **Step 4: Commit**

**LOC est.:** 30. **Acceptance:** boots cleanly; old test suite green.

---

## Task 16: M5 — /goal slash command (12 sub-commands)

**Files:**
- Create: `src/slash/goal.ts`
- Test: `test/slash/goal.test.ts`

- [ ] **Step 1: Write tests for each sub-command**

```ts
describe('/goal', () => {
  it('new <name> opens an inline description prompt then creates+binds', async () => {
    // mock askUser to return a description; expect a goal exists and active session.goalId is set
  })
  it('list renders 5-column table', async () => { /* … */ })
  it('pause/resume/complete/archive transitions state', async () => { /* … */ })
  it('show renders header + last 10 trace lines', async () => { /* … */ })
  it('bind <id> sets active session.goalId; unbind clears it', async () => { /* … */ })
  it('note <text> appends a goal.note record', async () => { /* … */ })
  it('inject re-injects the goal block into the system prompt', async () => { /* … */ })
  it('complete runs editor agent (mocked) and writes goal.summary', async () => { /* … */ })
})
```

- [ ] **Step 2: Implement `src/slash/goal.ts`** per spec §6.3.3.

The `complete` branch invokes `runForkedAgent` (phase14 §6.6) with the editor system prompt asking for a 5-paragraph summary; result piped to `registry.setSummary`.

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

**LOC est.:** 320. **Acceptance:** all 12 sub-command tests green.

---

## Task 17: M5 — system-prompt injection template

**Files:**
- Modify: `src/core/agent/loop.ts` (or wherever the system prompt is assembled — likely `src/core/agent/prompt.ts`)
- Create: `assets/prompts/goalInject.md.tmpl`
- Test: `test/core/agent/goalInject.test.ts`

- [ ] **Step 1: Locate the prompt builder** — search:

```
grep -n "## Plan\|systemPrompt\b" src/core/agent/
```

- [ ] **Step 2: Add `buildGoalBlock(session, registry, traceFile)`**

Returns the literal Markdown block from spec §6.3.4. Last-5 trace events read by `tail -n 5` equivalent (read NDJSON file, parse last 5 lines).

- [ ] **Step 3: Inject after harness header, before user message**

Wired in the existing prompt assembly fn.

- [ ] **Step 4: Write the test**

```ts
it('injects ## Goal block when session.goalId set', () => {
  const session = mkSession({ goalId: g.id })
  const sys = buildSystemPrompt(session, { goals: registry, /* … */ })
  expect(sys).toContain(`## Goal: ${g.name}`)
  expect(sys).toContain(`### Rolling summary`)
})
```

- [ ] **Step 5: Run — passes**

- [ ] **Step 6: Commit**

**LOC est.:** 90. **Acceptance:** prompt diff shows `## Goal: …` block when goalId set.

---

## Task 18: M6 — Two-axis PermissionCall extension

**Files:**
- Modify: `src/core/permission/types.ts` — add fields per spec §6.4.1
- Modify: `src/core/permission/cache.ts` — accept new fields when matching
- Test: `test/core/permission/checker.twoaxis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('PermissionChecker 5-step decision', () => {
  it('plan-mode lockout still wins (legacy compat)', async () => { /* mode=plan + Write → refuse */ })
  it('read-only sandboxMode refuses any write', async () => {
    const r = await checker.check({
      toolName: 'Write',
      hint: 'write',
      input: { path: '/a' },
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/read-only/)
  })
  it('workspace-write refuses path escape', async () => {
    const r = await checker.check({
      toolName: 'Write', hint: 'write',
      input: { path: '/etc/passwd' },
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      profile: { /* workspace = /tmp/wt */ },
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/escape/i)
  })
  it('profile denyWriteGlobs refuses', async () => { /* … */ })
  it('approvalPolicy=never silently approves non-blocked', async () => { /* … */ })
  it('approvalPolicy=untrusted prompts even for read-only', async () => { /* … */ })
})
```

- [ ] **Step 2: Modify `src/core/permission/types.ts`** — add `sandboxMode?`, `approvalPolicy?`, `profile?` to `PermissionCall`.

- [ ] **Step 3: Run — fails**

(Implementation lands in Task 19.)

- [ ] **Step 4: Commit type-only widening**

```bash
git commit -m "feat(spec-b/m6): widen PermissionCall with sandboxMode/approvalPolicy/profile"
```

**LOC est.:** 40. **Acceptance:** typecheck green; tests fail awaiting Task 19.

---

## Task 19: M6 — 5-step PermissionChecker.check

**Files:**
- Modify: `src/core/permission/checker.ts`

- [ ] **Step 1: Re-run the Task 18 tests — confirm baseline failures**

- [ ] **Step 2: Implement 5-step decision**

```ts
async check(call: PermissionCall): Promise<PermissionDecision> {
  // (1) Plan-mode lockout (retained)
  if (call.mode === 'plan') {
    const ann = call.annotations
    if (PLAN_BLOCKED_TOOLS.has(call.toolName) || ann?.destructive || ann?.openWorld) {
      return { allowed: false, reason: PLAN_BLOCKED_REASON }
    }
  }

  // (2) sandboxMode gate
  const sm = call.sandboxMode ?? 'workspace-write'
  if (sm === 'read-only') {
    if (call.hint === 'write' || call.hint === 'exec' || call.annotations?.destructive || call.annotations?.openWorld) {
      return { allowed: false, reason: 'sandbox: read-only mode forbids write/destructive/openWorld' }
    }
  } else if (sm === 'workspace-write') {
    if (call.hint === 'write' && call.profile) {
      const p = (call.input as any)?.path
      const wsRoot = (call as any).workspace as string | undefined
      if (typeof p === 'string' && wsRoot && !path.resolve(wsRoot, p).startsWith(wsRoot)) {
        return { allowed: false, reason: `sandbox: write escapes workspace ${wsRoot}` }
      }
    }
  } // danger-full-access: fall through

  // (3) Profile deny-globs
  const subj = subjectFor(call)
  if (call.profile && subj) {
    if (call.hint === 'read' && call.profile.denyReadGlobs.some(g => picomatch(g)(subj))) {
      return { allowed: false, reason: `profile ${call.profile.name} denies read: ${subj}` }
    }
    if (call.hint === 'write' && call.profile.denyWriteGlobs.some(g => picomatch(g)(subj))) {
      return { allowed: false, reason: `profile ${call.profile.name} denies write: ${subj}` }
    }
  }

  // (4) Approval
  const policy = call.approvalPolicy ?? 'on-request'
  if (policy === 'never') return { allowed: true }
  if (call.hint === 'none' && policy !== 'untrusted') return { allowed: true }
  if (this.getCache().isAllowed(call)) return { allowed: true }
  const decision = await this.askUser({ call, annotationBadges: deriveBadges(call) })
  if (decision.allowed && decision.remember) this.getCache().add(decision.remember)
  return decision

  // (5) OS sandbox dispatch — handled at the runner level for exec-style tools.
}
```

- [ ] **Step 3: Run all permission tests — verify green**

- [ ] **Step 4: Commit**

**LOC est.:** 130. **Acceptance:** Task 18 tests + existing checker tests all green.

---

## Task 20: M6 — /permission slash command

**Files:**
- Create: `src/slash/permission.ts`
- Test: `test/slash/permission.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('/permission', () => {
  it('show renders the active profile + sandboxMode + approvalPolicy', async () => { /* … */ })
  it('use <name> swaps active session permissionProfile', async () => { /* … */ })
  it('list returns configured profile names', async () => { /* … */ })
  it('escalate requires confirmation; on accept sets sandboxMode=danger-full-access', async () => { /* … */ })
})
```

- [ ] **Step 2: Implement** per spec §6.5. The `escalate` branch calls into the auto-review module (Task 24) when the active profile has `autoReview === true`.

- [ ] **Step 3: Register in cli.tsx**

- [ ] **Step 4: Commit**

**LOC est.:** 150. **Acceptance:** all 4 sub-command tests green.

---

## Task 21: M7 — SandboxLauncher interface + NoopFallbackLauncher

**Files:**
- Create: `src/core/permission/sandboxLauncher.ts`
- Create: `src/core/permission/noopFallbackLauncher.ts`
- Test: `test/core/permission/sandboxLauncher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('NoopFallbackLauncher', () => {
  it('available() always true', async () => { /* … */ })
  it('spawn applies envAllowlist', async () => {
    // pass envAllowlist=['HOME']; spawn /usr/bin/env; verify only HOME is set
  })
})

describe('pickSandboxLauncher', () => {
  it('returns the platform-appropriate launcher', () => {
    const l = pickSandboxLauncher()
    if (process.platform === 'darwin')  expect(l.constructor.name).toBe('SeatbeltLauncher')
    if (process.platform === 'linux')   expect(l.constructor.name).toBe('BwrapLauncher')
    if (process.platform === 'win32')   expect(l.constructor.name).toBe('WindowsJobLauncher')
  })
})
```

- [ ] **Step 2: Implement interface + noop launcher**

```ts
export interface SandboxLauncher {
  available(): Promise<boolean>
  spawn(input: SandboxSpawnInput): Promise<SandboxSpawnResult>
}

export class NoopFallbackLauncher implements SandboxLauncher {
  async available() { return true }
  async spawn(input: SandboxSpawnInput): Promise<SandboxSpawnResult> {
    const env: NodeJS.ProcessEnv = {}
    for (const k of input.profile.envAllowlist) {
      if (k === '*') Object.assign(env, process.env); else env[k] = process.env[k]
    }
    const proc = spawn(input.command, input.args, { cwd: input.cwd, env, signal: input.signal })
    // wire stdout/stderr/exit; resolve { exitCode, stdout, stderr, fallback: 'no-bwrap' | … }
  }
}

export function pickSandboxLauncher(): SandboxLauncher {
  if (process.platform === 'darwin') return new SeatbeltLauncher()
  if (process.platform === 'linux')  return new BwrapLauncher()
  if (process.platform === 'win32')  return new WindowsJobLauncher()
  return new NoopFallbackLauncher()
}
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

**LOC est.:** 130. **Acceptance:** noop test green; pick test green.

---

## Task 22: M7 — SeatbeltLauncher (macOS) + .sb template

**Files:**
- Create: `src/core/permission/seatbeltLauncher.ts`
- Create: `assets/sandbox/seatbelt.sb.tmpl`
- Test: `test/core/permission/seatbeltLauncher.test.ts`

- [ ] **Step 1: Drop the literal `.sb` template** from spec §5.6 into `assets/sandbox/seatbelt.sb.tmpl` (the template uses `<HOME>`, `<WORKSPACE>`, `<DENY_WRITE_RULES>`, `<DENY_READ_RULES>` placeholders).

- [ ] **Step 2: Write the failing test**

```ts
describe('SeatbeltLauncher', () => {
  it('available() returns false off macOS', async () => {
    if (process.platform !== 'darwin') {
      expect(await new SeatbeltLauncher().available()).toBe(false)
    }
  })
  it('renders the template with workspace and deny globs', () => {
    const l = new SeatbeltLauncher()
    const sb = l.renderProfile({
      home: '/Users/u', workspace: '/Users/u/code/repo',
      profile: mkProfile({ denyWriteGlobs: ['secret/**'], denyReadGlobs: ['*.pem'] }),
    })
    expect(sb).toContain('(subpath "/Users/u/code/repo")')
    expect(sb).toMatch(/deny file-write\* \(subpath "\/Users\/u\/code\/repo\/secret\/"\)/)
    expect(sb).toMatch(/deny file-read\*  \(.*\.pem.*\)/)
  })
  it('caches profile to ~/.nuka/sandbox-profiles/<sess>.sb', async () => { /* … */ })
})
```

- [ ] **Step 3: Implement `seatbeltLauncher.ts`**

```ts
export class SeatbeltLauncher implements SandboxLauncher {
  async available() { return process.platform === 'darwin' }
  renderProfile(opts: { home: string; workspace: string; profile: PermissionProfile }): string {
    const tmpl = fs.readFileSync(path.join(__dirname, '../../../assets/sandbox/seatbelt.sb.tmpl'), 'utf8')
    return tmpl
      .replace(/<HOME>/g, opts.home)
      .replace(/<WORKSPACE>/g, opts.workspace)
      .replace('<DENY_WRITE_RULES>', this.deny('file-write*', opts.profile.denyWriteGlobs, opts.workspace))
      .replace('<DENY_READ_RULES>',  this.deny('file-read*',  opts.profile.denyReadGlobs,  opts.workspace))
  }
  async spawn(input: SandboxSpawnInput): Promise<SandboxSpawnResult> {
    const profilePath = await this.cacheProfile(input)
    const proc = spawn('sandbox-exec', ['-f', profilePath, input.command, ...input.args], {
      cwd: input.cwd, env: this.filterEnv(input), signal: input.signal,
    })
    return wireProc(proc)
  }
  private deny(directive: string, globs: string[], workspace: string): string {
    return globs.map(g => `(deny ${directive} (subpath "${path.join(workspace, g.split('*')[0]!)}"))`).join('\n')
  }
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

**LOC est.:** 180. **Acceptance:** template renders correctly; profile is cached per sessionId.

---

## Task 23: M7 — BwrapLauncher (Linux)

**Files:**
- Create: `src/core/permission/bwrapLauncher.ts`
- Test: `test/core/permission/bwrapLauncher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('BwrapLauncher', () => {
  it('available() probes bwrap --version', async () => { /* mock spawn */ })

  it('builds argv per spec §5.7 for workspace-write', () => {
    const l = new BwrapLauncher()
    const argv = l.buildArgv({
      command: '/bin/echo', args: ['hi'],
      workspace: '/tmp/wt',
      home: '/home/u',
      profile: mkProfile({ sandboxMode: 'workspace-write' }),
    })
    expect(argv).toContain('--bind')
    expect(argv).toContain('/tmp/wt')
    expect(argv).toContain('--ro-bind')
    expect(argv).toContain('--unshare-pid')
    expect(argv).not.toContain('--unshare-net')  // network egress preserved
  })

  it('read-only mode uses --ro-bind for workspace', () => {
    const argv = l.buildArgv({ /* sandboxMode: 'read-only' */ })
    const wsBindIdx = argv.findIndex(a => a === '/tmp/wt')
    expect(argv[wsBindIdx - 1]).toBe('--ro-bind')
  })

  it('danger-full-access does not invoke bwrap', () => {
    const argv = l.buildArgv({ /* danger-full-access */ })
    expect(argv).toBeNull()  // signals raw spawn
  })

  it('userns-disabled stderr triggers fallback', async () => {
    // mock spawn to emit "setting up uid map: Permission denied"; verify result.fallback === 'userns-disabled'
  })
})
```

- [ ] **Step 2: Implement `bwrapLauncher.ts`** with the literal argv from spec §5.7.

```ts
buildArgv(input: { command, args, workspace, home, profile }): string[] | null {
  if (input.profile.sandboxMode === 'danger-full-access') return null
  const wsBind = input.profile.sandboxMode === 'read-only' ? '--ro-bind' : '--bind'
  return [
    'bwrap',
    '--unshare-pid', '--unshare-uts', '--unshare-ipc', '--unshare-cgroup-try',
    '--die-with-parent', '--new-session',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/sbin', '/sbin',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/etc/resolv.conf', '/etc/resolv.conf',
    '--ro-bind', `${input.home}/.nuka`, `${input.home}/.nuka`,
    '--ro-bind', `${input.home}/.npm`, `${input.home}/.npm`,
    wsBind, input.workspace, input.workspace,
    '--chdir', input.workspace,
    '--setenv', 'HOME', input.home,
    '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
    '--setenv', 'NUKA_SANDBOX', '1',
    '--', input.command, ...input.args,
  ]
}
```

`spawn()` invokes `bwrap` with this argv. On stderr containing
`setting up uid map: Permission denied`, the launcher resolves
`{ fallback: 'userns-disabled', exitCode, stdout, stderr }` and the
caller falls back to NoopFallbackLauncher.

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

**LOC est.:** 200. **Acceptance:** argv tests for all 3 sandbox modes pass; userns-disabled fallback recognised.

---

## Task 24: M7 — WindowsJobLauncher + helper exe

**Files:**
- Create: `src/core/permission/windowsJobLauncher.ts`
- Create: `assets/sandbox/win-jobsandbox/README.md` (explains the prebuilt helper)
- Test: `test/core/permission/windowsJobLauncher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('WindowsJobLauncher', () => {
  it('available() returns false off Windows', async () => {
    if (process.platform !== 'win32') {
      expect(await new WindowsJobLauncher().available()).toBe(false)
    }
  })
  it('available() probes assets/sandbox/win-jobsandbox/win-jobsandbox.exe', async () => { /* … */ })
  it('spawn shells out to the helper with quoted command', async () => { /* mock spawn; verify argv */ })
})
```

- [ ] **Step 2: Implement** the launcher. Prebuilt binary path resolution: `path.join(__dirname, '../../../assets/sandbox/win-jobsandbox/win-jobsandbox.exe')`. If missing, `available()` returns false; CI's npm-pack path includes the binary as a platform-prebuild artifact.

(The helper exe itself is out of scope for this plan — we ship a stub readme + a smoke test that gracefully degrades when the binary is absent.)

- [ ] **Step 3: Run — passes (off Windows: skip)**

- [ ] **Step 4: Commit**

**LOC est.:** 100. **Acceptance:** non-Windows tests pass; Windows CI degrades to NoopFallbackLauncher when binary absent.

---

## Task 25: M7 — Wire SandboxLauncher into BashTool + plugin spawn-runtime

**Files:**
- Modify: `src/core/tools/bash.ts`
- Modify: `src/core/plugin/wire.ts` or wherever spawn-runtime tools resolve their spawn fn

- [ ] **Step 1: Write the failing test**

```ts
describe('BashTool with sandboxLauncher', () => {
  it('routes through launcher.spawn when profile is set', async () => {
    const launcher = mkMockLauncher()
    const tool = new BashTool({ /* …, sandboxLauncher: launcher */ })
    await tool.run({ command: 'echo hi' }, ctx)
    expect(launcher.spawn).toHaveBeenCalledOnce()
  })
  it('falls back to raw spawn when launcher.available() === false', async () => { /* … */ })
})
```

- [ ] **Step 2: Edit BashTool.run**

```ts
const launcher = ctx.sandboxLauncher
if (launcher && await launcher.available()) {
  const r = await launcher.spawn({
    command, args,
    cwd: ctx.worktreeResolver?.cwd(ctx.session) ?? process.cwd(),
    workspace: ctx.worktreeResolver?.cwd(ctx.session) ?? process.cwd(),
    profile: ctx.profile ?? defaultProfile,
    signal,
  })
  // wire r.stdout/stderr/exitCode into the existing tool result format
} else {
  // existing raw spawn path
}
```

- [ ] **Step 3: Mirror in plugin spawn-runtime**

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

**LOC est.:** 130. **Acceptance:** existing Bash tests stay green via `NoopFallbackLauncher`; mock-launcher test green.

---

## Task 26: M8 — auto_review reviewer subagent

**Files:**
- Create: `src/core/permission/autoReview.ts`
- Create: `assets/prompts/autoReviewSystem.md`
- Test: `test/core/permission/autoReview.test.ts`

- [ ] **Step 1: Drop the deny-by-default reviewer system prompt**

`assets/prompts/autoReviewSystem.md`:

```markdown
You are a deny-by-default permission reviewer. The user is escalating
permissions in a coding agent session. Your job: read the
PermissionCall and the last 3 assistant messages of context. If the
escalation is reasonable for the apparent intent, return JSON
`{"verdict":"allow","reason":"<one sentence>"}`. Otherwise return
`{"verdict":"deny","reason":"<one sentence why>"}`. Default deny when
in doubt. Output exactly one JSON object, nothing else.
```

- [ ] **Step 2: Write the failing test**

```ts
describe('autoReview', () => {
  it('spawns runForkedAgent with the system prompt', async () => {
    const runFork = vi.fn().mockResolvedValueOnce({ text: '{"verdict":"deny","reason":"writing /etc"}' })
    const r = await autoReview({
      call: { toolName:'Write', hint:'write', input:{path:'/etc/passwd'} },
      session: mkSession(),
      profile: mkProfile({ autoReview: true }),
      runFork,
    })
    expect(r.verdict).toBe('deny')
    expect(r.reason).toMatch(/etc/)
    expect(runFork).toHaveBeenCalledOnce()
  })

  it('caches verdicts for 5 minutes (same call shape)', async () => { /* … */ })

  it('returns allow when profile.autoReview === false (no spawn)', async () => {
    const runFork = vi.fn()
    const r = await autoReview({ profile: mkProfile({ autoReview: false }), /* … */ runFork })
    expect(runFork).not.toHaveBeenCalled()
    expect(r.verdict).toBe('allow')
  })
})
```

- [ ] **Step 3: Implement**

```ts
import { runForkedAgent } from '../agent/forkedAgent'

const cache = new Map<string, { v: 'allow' | 'deny'; r: string; t: number }>()

export async function autoReview(opts: {
  call: PermissionCall
  session: Session
  profile: PermissionProfile
  runFork: typeof runForkedAgent
}): Promise<{ verdict: 'allow' | 'deny'; reason: string }> {
  if (!opts.profile.autoReview) return { verdict: 'allow', reason: 'auto_review disabled' }
  const key = JSON.stringify({ t: opts.call.toolName, h: opts.call.hint, i: opts.call.input })
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < 5 * 60_000) return { verdict: hit.v, reason: hit.r }

  const sys = fs.readFileSync(path.join(__dirname, '../../../assets/prompts/autoReviewSystem.md'), 'utf8')
  const recent = opts.session.messages.slice(-6).filter(m => m.role === 'assistant')
  const prompt = JSON.stringify({ call: opts.call, recent }, null, 2)

  const result = await opts.runFork({ /* params from runForkedAgent contract */ prompt })
  const parsed = JSON.parse(result.text) as { verdict: 'allow' | 'deny'; reason: string }
  cache.set(key, { v: parsed.verdict, r: parsed.reason, t: Date.now() })
  return parsed
}
```

- [ ] **Step 4: Wire into PermissionChecker.check**

In step (4), when `policy === 'untrusted'` AND profile has `autoReview: true`, route through `autoReview` first. A `deny` short-circuits the check; `allow` falls through to user prompt (acts as a pre-filter).

- [ ] **Step 5: Run — passes**

- [ ] **Step 6: Commit**

**LOC est.:** 180. **Acceptance:** all 3 autoReview tests green; cache hit verified.

---

## Task 27: M8 — /doctor sandbox availability report

**Files:**
- Modify: `src/slash/doctor.ts`
- Test: `test/slash/doctor.test.ts` (extend)

- [ ] **Step 1: Add a "Sandbox" section to the doctor output**

Lines emitted:

```
## Sandbox
- Platform launcher: BwrapLauncher (Linux)
- bwrap executable: /usr/bin/bwrap (version 0.6.2)
- User namespaces: enabled (kernel.unprivileged_userns_clone=1)
- Plugin spawn-runtime tools using direct spawn: 0
- Active permission profile: strict
```

- [ ] **Step 2: Test**

```ts
it('reports sandbox availability', async () => {
  const out = await DoctorCommand.run('', ctx)
  expect(out.text).toMatch(/Sandbox/)
  expect(out.text).toMatch(/(SeatbeltLauncher|BwrapLauncher|WindowsJobLauncher|NoopFallbackLauncher)/)
})
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

**LOC est.:** 70. **Acceptance:** doctor output includes the Sandbox section on all platforms.

---

## Task 28: M8 — Bundle-size + retention sweep audit

**Files:**
- Modify: `scripts/check-bundle-size.js` (or whatever the existing bundle audit is called)
- Add: retention sweep includes `worktree-snapshots` and goal `.archive/`

- [ ] **Step 1: Run bundle audit**

```
npm run build
node scripts/check-bundle-size.js
```

Verify bundle size ≤ 340 KB (current 312 + 25 KB budget).

- [ ] **Step 2: Extend retention sweep**

`src/core/tasks/retention.ts` (created in phase14) — add the worktree-snapshot and goal-archive sweeps:

```ts
await sweepOldSnapshots(home, config.worktree?.snapshotRetentionDays ?? 14)
await sweepOldGoalArchives(home, 365)  // 1y for archived goals
```

- [ ] **Step 3: Test**

```ts
it('boot retention sweep deletes worktree-snapshots > N days', async () => {
  // touch an old file with mtime 30d ago; run sweep; verify deletion
})
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(spec-b/m8): bundle audit + retention sweep extends to worktree snapshots and goal archives"
```

**LOC est.:** 100. **Acceptance:** bundle size within budget; retention test green.

---

## Task 29: Integration — End-to-end goal trace across two sessions

**Files:**
- Create: `test/integration/spec-b-goal-trace.test.ts`

- [ ] **Step 1: Write the test**

```ts
describe('integration: goal trace across two sessions', () => {
  it('records 6 events across 2 sessions, monotonic seq, recoverable', async () => {
    const reg = new GoalRegistry({ home: tmp, bus })
    await reg.load()
    const g = await reg.create({ name: 'cross-session', description: 'x' })

    // Session A
    const sA = createSession({ providerId: 'p', model: 'm' }); sA.goalId = g.id
    await reg.addSession(g.id, sA.id)

    const detach = attachGoalTraceWriter({
      bus, registry: reg, goalFor: id => id === sA.id || id === sB.id ? g.id : undefined,
    })

    bus.emit('task', { type: 'task.created', task: { id:'t1', kind:'local_agent', sessionId: sA.id, /* … */ } })
    bus.emit('harness', { type: 'harness.stage.enter', stage: 'brainstorm', sessionId: sA.id })
    bus.emit('agent', { type: 'agent.message.assistant', sessionId: sA.id, text: 'hi from A' })

    // Session B (resume the goal)
    const sB = createSession({ providerId: 'p', model: 'm' }); sB.goalId = g.id
    await reg.addSession(g.id, sB.id)

    bus.emit('harness', { type: 'harness.stage.enter', stage: 'plan', sessionId: sB.id })
    bus.emit('agent', { type: 'agent.message.assistant', sessionId: sB.id, text: 'resumed' })
    await reg.note(g.id, sB.id, 'milestone reached')

    detach()

    const lines = fs.readFileSync(reg.rolloutTraceFile(g.id), 'utf8').trim().split('\n')
    expect(lines.length).toBe(6)
    const recs = lines.map(l => JSON.parse(l))
    expect(recs.map(r => r.seq)).toEqual([0, 1, 2, 3, 4, 5])
    expect(recs.map(r => r.kind)).toEqual([
      'task.created', 'harness.stage.enter', 'agent.message.assistant',
      'harness.stage.enter', 'agent.message.assistant', 'goal.note',
    ])
  })
})
```

- [ ] **Step 2: Run — passes**

- [ ] **Step 3: Commit**

**LOC est.:** 120. **Acceptance:** all 6 records captured with expected order + monotonic seqs.

---

## Task 30: Integration — Worktree handoff round-trip

**Files:**
- Create: `test/integration/spec-b-worktree-handoff.test.ts`

- [ ] **Step 1: Write the test** — exercises the full §4.3 4-row table inside a real tmpdir git repo.

- [ ] **Step 2: Run — passes**

- [ ] **Step 3: Commit**

**LOC est.:** 180. **Acceptance:** all 4+1 rows of the conflict table behave per spec.

---

## Task 31: e2e — Linux bwrap sandbox (gated)

**Files:**
- Create: `test/e2e/spec-b-bwrap.linux.test.ts`

- [ ] **Step 1: Test**

```ts
const skip = process.platform !== 'linux' || process.env.CI_BWRAP_AVAILABLE !== '1'
describe.skipIf(skip)('e2e: bwrap denies workspace escape', () => {
  it('attempting to write outside workspace fails', async () => {
    const launcher = new BwrapLauncher()
    const r = await launcher.spawn({
      command: '/bin/sh',
      args: ['-c', 'echo evil > /etc/nuka-evil'],
      cwd: '/tmp/wt', workspace: '/tmp/wt',
      profile: mkProfile({ sandboxMode: 'workspace-write' }),
    })
    expect(r.exitCode).not.toBe(0)
    expect(fs.existsSync('/etc/nuka-evil')).toBe(false)
  })
})
```

- [ ] **Step 2: Run on Linux CI with `CI_BWRAP_AVAILABLE=1`**

- [ ] **Step 3: Commit**

**LOC est.:** 60. **Acceptance:** Linux CI green; non-Linux skips.

---

## Task 32: e2e — macOS Seatbelt sandbox (gated)

**Files:**
- Create: `test/e2e/spec-b-seatbelt.darwin.test.ts`

- [ ] **Step 1: Test** (mirrors Task 31 with `sandbox-exec`)

- [ ] **Step 2: Run on macOS CI**

- [ ] **Step 3: Commit**

**LOC est.:** 60. **Acceptance:** macOS CI green; non-macOS skips.

---

## Task 33: Migration verification across the suite

**Files:**
- Create: `test/integration/spec-b-permission-migration.test.ts`

- [ ] **Step 1: Test**

```ts
describe('integration: permission migration', () => {
  it('legacy mode=bypass session JSON loads as {danger-full-access, never}', async () => {
    const file = path.join(tmp, '.nuka', 'sessions', 'legacy.json')
    fs.writeFileSync(file, JSON.stringify({
      id: '01J...LEGACY', providerId: 'p', model: 'm',
      mode: 'bypass', /* no sandboxMode/approvalPolicy */
    }))
    const mgr = new SessionManager({ store: new SessionStore({ dir: path.dirname(file) }) })
    const s = await mgr.resume('01J...LEGACY')
    expect(s.sandboxMode).toBe('danger-full-access')
    expect(s.approvalPolicy).toBe('never')
  })
  it('mode=plan still hard-blocks Write/Edit/Bash via plan-mode lockout', async () => {
    // checker.check with mode='plan' + Write → refused with PLAN_BLOCKED_REASON
  })
})
```

- [ ] **Step 2: Run — passes**

- [ ] **Step 3: Commit**

**LOC est.:** 90. **Acceptance:** all migration paths covered.

---

## Task 34: README + CHANGELOG entry

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md` (create if absent — but verify with user before; this plan does not auto-create docs)

- [ ] **Step 1: Append to the slash-command table** in `README.md`:

```
| `/worktree`   | Manage the per-session git worktree                                          |
| `/handoff`    | Swap a thread between in-place and worktree                                   |
| `/goal`       | Manage long-running objectives across sessions                                |
| `/permission` | Show / change the active permission profile                                   |
```

- [ ] **Step 2: Add a one-paragraph "Worktree, Goals, Sandbox" section under Quick start**

- [ ] **Step 3: Commit**

**LOC est.:** 40. **Acceptance:** README slash-table updated; section reads naturally.

---

## Closeout checklist

After M8 lands:

- [ ] `npm run typecheck` clean.
- [ ] `npm test` clean (≥ 1490 tests, +69 unit + 6 integration vs current 1421).
- [ ] `npm run build && node scripts/check-bundle-size.js` ≤ 340 KB.
- [ ] `nuka /doctor` reports sandbox launcher + worktree status + goal count.
- [ ] Manual smoke: `/worktree on` then `/handoff in-place --stash` round-trips on a real repo.
- [ ] Manual smoke: `/goal new test` then bind a session, run a turn, confirm NDJSON contains records, then `/goal complete` writes a summary.
- [ ] Manual smoke (Linux/macOS): a `Bash` tool call with `sandboxMode: workspace-write` blocks `echo > /etc/foo`.
- [ ] Sibling specs (A, C, D, E) reviewed: no field they reserved is now claimed by Spec B.

---

## Plan self-review checklist

- ✅ M0 (schemas + paths + config) is the single blocking milestone; M1+ proceed in 3 parallel tracks.
- ✅ Each task lists files (create/modify), test files, and a commit message stub.
- ✅ Each task is test-first (failing test first, implementation, run-passes).
- ✅ LOC estimates and acceptance criteria are explicit per task.
- ✅ Total LOC sum (Tasks 1–34) ≈ 4,720 LOC across src + tests; consistent with ~3,200 LOC src + 1,500 LOC tests.
- ✅ References the source spec section (`§ 5.x`, `§ 6.x`) on every new file.
- ✅ Phase 14 foundation primitives (`runForkedAgent`, `EventBus`, `ProgressTrackerSnapshot`) are referenced verbatim, never re-invented.
- ✅ No new EventBus topic introduced; goal trace is a subscriber.
- ✅ Migration is forward-only with one-release legacy compat.
- ✅ Each track's milestone count matches spec §8: worktree (M1–M3), goal (M4–M5), sandbox (M6–M8).
- ✅ Closeout checklist is concrete (typecheck / tests / bundle / doctor / smoke).
- ✅ No "TBD" / "TODO" tokens in normative task bodies.
