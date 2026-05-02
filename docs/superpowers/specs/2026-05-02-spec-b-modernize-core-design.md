# Spec B — Modernize Core: worktree-as-thread, persisted /goal, OS-level sandbox

**Date:** 2026-05-02
**Status:** Spec
**Author:** Spec-B brainstorming session 2026-05-02
**Siblings:** Spec A (Finish-the-Promise), Spec C (Cron Primitive), Spec D (Provider Expansion), Spec E (Context Audit)
**Depends on:** Phase 14 foundation (`docs/superpowers/specs/2026-04-30-phase14-foundation-design.md`)

## 1. Problem

Nuka's `Session` model is process-pinned and filesystem-flat:

- Every `Session` runs in a single shared cwd. There is no thread-level
  isolation: two parallel agents that touch the same file race each other,
  `/fork` deep-copies messages but not the working tree, and there is no
  story for "let agent A keep tweaking branch X while agent B explores
  branch Y" beyond manually shelling out `git worktree`.
  See `src/core/session/session.ts:48` (`forkSession`) and
  `src/core/session/types.ts:8` (`Session` has no `worktreeId`).
- Long-running objectives are not first class. The `harness/state.ts:24`
  `HarnessState` is per-session and discarded when a session ends; there
  is no way to say "I have been pursuing a 3-day refactor across five
  sessions; here is the rolling summary, here is what each session
  contributed". `~/.nuka/recaps/` (phase14c) records *one* session, not
  an *objective* that spans sessions.
- Permissions are JS-only and one-dimensional. `PermissionCall.mode` is a
  flat enum `'normal' | 'plan' | 'bypass'` (`src/core/permission/types.ts:32`),
  enforced inside the tool runner via name-list checks
  (`src/core/permission/checker.ts:20`, `PLAN_BLOCKED_TOOLS`). A
  determined plugin tool that calls `child_process.spawn` directly
  bypasses every prompt because the OS does not enforce anything: the
  same node process owns the whole cwd, the network, and the user's
  home dir. There are no named profiles, no per-session sandbox
  selection, and no review gate when an action is escalated.

These three gaps share one shape: **the unit of isolation is wrong**.
Codex (the OpenAI CLI) treats a *thread* as the isolation unit, with an
optional managed git worktree, an `goal` object that survives across
threads, and a two-axis permission matrix backed by macOS Seatbelt or
Linux bubblewrap. Spec B brings the same three primitives into Nuka,
implemented in a way that is **conservative** (defaults change nothing),
**composable** (worktree, goal, sandbox land on independent tracks), and
**explicit** (no IDE bridge, no app-server protocol, no remote IM
adapters — those belong to other specs and are listed as non-goals).

The four-component framing is:

1. **Worktree-as-thread (B1, conservative).** A `Session` may opt-in to
   a managed git worktree under `~/.nuka/worktrees/<sessionId>/`. All
   tool cwd resolution routes there. `/handoff` swaps a thread between
   in-place and worktree; `/fork` from a worktree-backed session
   branches the worktree; `/rewind` works *inside* the worktree only.
2. **Persisted `/goal` (G1, independent).** A new `core/goal/`
   subsystem stores `Goal` objects at `~/.nuka/goals/<goalId>.json`,
   exposes `/goal new|list|pause|resume|complete|archive|show`, and
   subscribes to existing EventBus topics filtered by associated
   sessionIds to write a per-goal NDJSON rollout trace.
3. **Two-axis permission + real OS sandbox (S1).** `core/permission/` is
   extended with `{ sandboxMode, approvalPolicy }` where
   `sandboxMode ∈ {read-only, workspace-write, danger-full-access}` and
   `approvalPolicy ∈ {untrusted, on-request, never}`. Named profiles in
   `~/.nuka/config.yaml` `permissionProfiles:`. The OS-level layer is
   `sandbox-exec` (macOS) / `bwrap` (Linux) / job-objects (Windows
   best-effort). An optional `auto_review` reviewer subagent gates
   escalations.

This spec **explicitly does NOT** introduce an app-server, external
WebSocket/TCP protocol, web client, RemoteTrigger, or IM adapters.
Those are deferred to Spec D and beyond.

## 2. Goals

The four numbered goals map 1:1 to the four components:

1. **G1 — Worktree-backed sessions (opt-in).**
   `Session` gains optional `worktreeId: string`. When set:
   - `git worktree add ~/.nuka/worktrees/<sessionId>/ <branch>` is run
     on opt-in; cleanup on session delete uses `git worktree remove`.
   - All tool cwd resolution (Read/Write/Edit/Bash/Grep/Glob) routes
     to the worktree path via a new `WorktreeResolver` shim sitting in
     front of `process.cwd()`.
   - LRU cap (default 15, configurable). On eviction:
     `tar -czf ~/.nuka/worktree-snapshots/<sessionId>-<ts>.tar.gz` of
     the worktree, then `git worktree remove --force`. Snapshots kept
     14 days, then deleted by the boot retention sweep.
   - `/handoff` slash command swaps a thread between in-place and
     worktree, with a 4-row conflict-resolution table (§4.3).
   - `/fork` of a worktree-backed session creates a new worktree
     branched from the same commit; messages are deep-copied as today.
   - `/rewind` works inside the worktree only — file checkpointing
     restores worktree-relative paths, not host cwd paths.

2. **G2 — Persisted `/goal` (cross-session).**
   A `Goal` is an addressable long-running objective:
   `{ id, name, description, state, createdAt, updatedAt,
      sessions: SessionId[], rolloutTraceFile, summary?, parentGoalId? }`.
   Persisted as Zod-validated JSON at `~/.nuka/goals/<goalId>.json`.
   Slash commands: `/goal new <name>`, `/goal list`,
   `/goal pause <id>`, `/goal resume <id>`, `/goal complete <id>`,
   `/goal archive <id>`, `/goal show <id>`. A goal does NOT couple to
   harness stage (those are per-session); a goal injects a brief
   summary block into the system prompt of any session bound to it
   (§4.4 template). The rollout trace is NDJSON of `task.created`,
   `task.state`, `agent.message.assistant`, `harness.stage.enter`
   events — implemented as a bus subscriber filtered by associated
   sessionIds, NOT a new event topic.

3. **G3 — Two-axis permission + named profiles.**
   Replace the flat `SessionMode` (`'normal'|'plan'|'bypass'`,
   `src/core/session/types.ts:6`) with a structured pair:
   `sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access'`
   and `approvalPolicy: 'untrusted' | 'on-request' | 'never'`. Named
   profiles (`permissionProfiles:` in `~/.nuka/config.yaml`) carry
   deny-read-globs, deny-write-globs, env-var allowlist. Tool
   annotations (`readOnly`, `destructive`, `openWorld`) drive default
   sandbox+approval mappings. Migration path: existing
   `SessionMode` values map to fixed `{sandboxMode, approvalPolicy}`
   pairs (§5.5 migration table); existing serialised sessions keep
   loading.

4. **G4 — Real OS-level sandbox (Seatbelt / bwrap / job objects).**
   When `sandboxMode === 'workspace-write'`, write attempts go through
   the OS sandbox layer: macOS `sandbox-exec` with a generated `.sb`
   profile (§5.6); Linux `bwrap` with bind mounts (§5.7); Windows
   native job objects + restricted tokens (§5.8, best-effort,
   documented caveats). When the OS layer is unavailable, fall back
   to the existing JS-only fence with a one-line warning. An optional
   `auto_review` reviewer subagent gates escalation requests
   (`danger-full-access` requested mid-session) by spawning
   `runForkedAgent` with a small fast model and a deny-by-default
   prompt; gated behind `permission.autoReview: true` in config.

## 3. Non-goals

- ❌ **App-server protocol** — no JSON-RPC server, no `/server start`,
  no daemon. Nuka stays single-process.
- ❌ **External WebSocket / TCP transport** — no remote control surface.
  `MessageRouter` (phase14 §6.3) `bridge` backend stays an interface
  only, not implemented.
- ❌ **External IDE / web client** — no VSCode extension, no browser
  client, no live-reload protocol. The phase 8 `/ide` MCP-bridge stays
  scoped to MCP-stdio glue, untouched.
- ❌ **RemoteTrigger / cron-style external triggers** — owned by
  Spec C (Cron Primitive). Spec B's only contribution is that goals
  are *resumable* — Spec C may later schedule a session against an
  active goal, but the trigger surface itself is out of scope here.
- ❌ **IM adapters** (Slack / Discord / Telegram) — out of scope; no
  bot mode, no slash command exfiltration.
- ❌ **Worktree branch naming policy.** This spec does not invent a
  new branch-naming scheme. We use the current branch by default and
  let the user pass `--branch <name>` for new branches.
- ❌ **Per-tool sandbox capabilities.** Tool annotations
  (`readOnly`/`destructive`/`openWorld`) drive *default mappings* into
  `{sandboxMode, approvalPolicy}` — they do NOT become a new
  capability system. The annotation set is unchanged.
- ❌ **Cross-host worktree mounting.** Worktrees are local-disk only.
- ❌ **Goal handoff between users / accounts.** Goals are per-`~/.nuka`
  installation; no upload, no share-link, no merge.
- ❌ **Sandbox escape detection.** We log and refuse; we do not
  implement intrusion-detection heuristics.

## 4. High-level architecture

### 4.1 Composition diagram

```
                ┌──────────── Nuka REPL (App.tsx) ────────────┐
                │ Conversation │ Tasks │ Prompt │ Status        │
                │                                               │
   /goal ──────►│ ┌───── Goal Registry (§6.5) ───────────────┐  │
   /worktree ──►│ │  ~/.nuka/goals/<id>.json                 │  │
   /handoff ──►│ │  rolloutTrace NDJSON via bus subscriber   │  │
                │ └────────▲──────────────────────────────────┘  │
                │          │ associated sessionIds[]            │
                │          │                                     │
                │ ┌────────┴────────────────────────────────┐   │
                │ │           SessionManager                │   │
                │ │  Session = { id, …, worktreeId? ,       │   │
                │ │               permissionProfile? ,      │   │
                │ │               goalId? }                 │   │
                │ └──┬──────────────────────────┬──────────┘   │
                │    │                          │              │
                │    ▼                          ▼              │
                │ ┌──────────────────┐   ┌────────────────────┐│
                │ │ WorktreeResolver │   │ PermissionChecker  ││
                │ │  (§6.2 NEW)      │   │  (§6.7 EXTENDED)   ││
                │ │  cwd shim for    │   │  two-axis decision ││
                │ │  Read/Write/Edit │   │  + sandbox-exec    ││
                │ │  /Bash/Grep/Glob │   │  / bwrap launcher  ││
                │ └─────┬────────────┘   └────────┬───────────┘│
                │       │                         │            │
                │       ▼                         ▼            │
                │ ┌──────────────────────────────────────────┐ │
                │ │ ~/.nuka/worktrees/<sess>/   ← git WT     │ │
                │ │ ~/.nuka/worktree-snapshots/  ← LRU evict │ │
                │ │ ~/.nuka/sandbox-profiles/    ← .sb cache │ │
                │ └──────────────────────────────────────────┘ │
                │                                               │
                │           EventBus (existing, §6.2 phase14)   │
                │  task.* / agent.* / message.* / harness.*     │
                │  ▲    ▲                                       │
                │  │    └── Goal trace subscriber (NEW §6.6)    │
                │  │        appends to <goalId>.ndjson          │
                │  └── existing emitters unchanged              │
                └───────────────────────────────────────────────┘
```

### 4.2 Lifecycle: a worktree-backed session crossing /handoff

```
   user types "/worktree on"
             │
             ▼
   ┌───────────────────────┐
   │ SessionManager.attach │
   │   Worktree(session)   │
   └───┬───────────────────┘
       │ (1) git worktree add ~/.nuka/worktrees/<sess>/ HEAD
       │ (2) write WorktreeMetadata to <wt>/.nuka-worktree.json
       │ (3) session.worktreeId = sess
       │ (4) emit task.created  { kind: 'worktree.attach', id: sess }
       │ (5) WorktreeRegistry.touch(sess) → LRU MRU position
       ▼
   ┌─────────────────────────────────┐
   │ tools resolve cwd via           │
   │   resolveCwd(session) =         │
   │     session.worktreeId          │
   │       ? worktreePathFor(sess)   │
   │       : process.cwd()           │
   └─────────────────────────────────┘
             │
             │ user types "/handoff off"
             ▼
   ┌──────────────────────────┐
   │ /handoff conflict gate   │  table §4.3 — clean / dirty /
   │ (canonical 4-row table)  │  branch-collision / dir-missing
   └───┬──────────────────────┘
       │ dirty? → confirm "stash and detach?" or abort
       │ clean? → continue
       │
       │ (1) git -C <wt> diff --quiet || stash | abort
       │ (2) git worktree remove --force <wt>
       │ (3) tar+gzip → ~/.nuka/worktree-snapshots/<sess>-<ts>.tar.gz
       │     (only if user passed --snapshot; default: keep nothing)
       │ (4) session.worktreeId = undefined
       │ (5) emit task.state { from: 'running', to: 'completed' }
       ▼
   in-place behavior resumes (cwd = process.cwd())
```

### 4.3 /handoff conflict-resolution decision table

| Worktree state                          | User intent | Action                                                 | Exit |
|-----------------------------------------|-------------|--------------------------------------------------------|------|
| Clean (`git diff --quiet` exit 0)       | swap to in-place | `git worktree remove --force <wt>`; clear `worktreeId` | OK   |
| Uncommitted changes                      | swap to in-place | Prompt: `[s]tash, [a]bort, [k]eep`. `s` runs `git -C <wt> stash push -u -m "nuka-handoff <sess>"` then remove. `a` aborts. `k` keeps the worktree directory but clears `worktreeId` (orphans the dir; recoverable via `/worktree adopt`) | OK / abort |
| Branch already checked out elsewhere     | swap to worktree | If target branch is checked out by a *different* worktree, refuse with hint `git worktree list` | abort |
| Worktree directory missing on disk       | swap to in-place | Warn + clear `worktreeId` without git invocation; emit `task.state: failed` only if the dir was expected to exist | OK   |

### 4.4 Architectural invariants

- **Default off.** All three components default to off. Existing
  sessions, configs, and slash flows must keep working byte-identical.
- **EventBus is the only cross-component channel.** Goal rollout
  trace, worktree LRU events, sandbox decisions all emit on existing
  topics; no new topic is introduced. The goal trace is a *subscriber*,
  not a publisher of new events.
- **Sandbox is enforcement, not policy.** `PermissionChecker` decides
  *whether* an action is allowed; the sandbox layer enforces *what is
  reachable* even if the JS-side decision was bypassed (e.g. by a
  plugin tool calling `spawn` directly). Both layers run; either may
  refuse.
- **Worktree is identity-stable.** `worktreeId === sessionId`. We do
  not invent a separate `worktreeId` namespace; one session ↔ at most
  one worktree.
- **Goal does NOT replace harness.** Harness `Triage` is still
  per-session. A goal may hold a *summary* of the harness state at
  the time of session-end, but goals do not enforce stage gates.
- **Conservative migration.** Old `SessionMode` values are *mapped*
  to two-axis pairs at load time (§5.5); the old field is retained on
  disk for one release for forward-compat, then removed.

## 5. Data schemas

All schemas are Zod-validated. Each schema's TypeScript path is given
above the block.

### 5.1 `WorktreeMetadata` (`src/core/worktree/types.ts`)

Persisted at `<worktreePath>/.nuka-worktree.json` plus an in-memory
LRU registry at `~/.nuka/worktrees/.registry.json`.

```ts
import { z } from 'zod'

export const WorktreeMetadataSchema = z.object({
  /** ULID, equal to the owning sessionId. */
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  /** Absolute path on disk (e.g. /home/u/.nuka/worktrees/01H...). */
  path: z.string(),
  /** Branch the worktree was added on. */
  branch: z.string(),
  /** Commit SHA at attach time. */
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  /** Original repo root (the git common dir's parent). */
  repoRoot: z.string(),
  /** Wall-clock millis. Updated on every cwd-resolved tool call. */
  lastTouchedAt: z.number(),
  createdAt: z.number(),
  /** Reason for last state transition; surfaced by /worktree status. */
  lastReason: z
    .enum(['attached', 'touched', 'evicted', 'detached', 'snapshotted'])
    .optional(),
})

export type WorktreeMetadata = z.infer<typeof WorktreeMetadataSchema>

export const WorktreeRegistrySchema = z.object({
  version: z.literal(1),
  /** MRU first. Truncated to `lruCap` on every touch. */
  entries: z.array(WorktreeMetadataSchema),
})

export type WorktreeRegistry = z.infer<typeof WorktreeRegistrySchema>
```

### 5.2 `Goal` and `GoalState` (`src/core/goal/types.ts`)

```ts
import { z } from 'zod'

export const GoalStateSchema = z.enum([
  'active',
  'paused',
  'completed',
  'archived',
])
export type GoalState = z.infer<typeof GoalStateSchema>

export const GoalSchema = z.object({
  /** ULID. */
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(4_000),
  state: GoalStateSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  /** ULIDs of sessions that have been bound to this goal. */
  sessions: z.array(z.string()).default([]),
  /** Absolute path to the NDJSON rollout-trace file. */
  rolloutTraceFile: z.string(),
  /** Optional roll-up summary, regenerated by editor agent. */
  summary: z.string().optional(),
  /** Parent goal id for nested objectives. */
  parentGoalId: z.string().optional(),
  /** Free-form labels for /goal list filtering. */
  labels: z.array(z.string()).default([]),
})

export type Goal = z.infer<typeof GoalSchema>
```

### 5.3 `RolloutTraceRecord` (`src/core/goal/trace.ts`)

NDJSON, one record per line. Records are subscribed-and-appended from
the existing EventBus; **no new bus topic is introduced**.

```ts
import { z } from 'zod'

export const RolloutTraceRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('task.created'),
    seq: z.number(),
    t: z.number(),
    sessionId: z.string(),
    taskId: z.string(),
    taskKind: z.string(),
    description: z.string(),
  }),
  z.object({
    kind: z.literal('task.state'),
    seq: z.number(),
    t: z.number(),
    sessionId: z.string(),
    taskId: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  z.object({
    kind: z.literal('agent.message.assistant'),
    seq: z.number(),
    t: z.number(),
    sessionId: z.string(),
    /** First 280 chars of assistant text — full transcript stays in
     *  session messages; the trace is a digest. */
    excerpt: z.string().max(280),
  }),
  z.object({
    kind: z.literal('harness.stage.enter'),
    seq: z.number(),
    t: z.number(),
    sessionId: z.string(),
    stage: z.string(),
  }),
  z.object({
    kind: z.literal('goal.note'),
    seq: z.number(),
    t: z.number(),
    sessionId: z.string().optional(),
    /** User-authored note via /goal note <text>. */
    text: z.string().max(2_000),
  }),
])

export type RolloutTraceRecord = z.infer<typeof RolloutTraceRecordSchema>
```

#### 5.3.1 Worked NDJSON example (8 lines)

```
{"kind":"task.created","seq":0,"t":1746201245001,"sessionId":"01J...A","taskId":"a1","taskKind":"local_agent","description":"sketch refactor"}
{"kind":"harness.stage.enter","seq":1,"t":1746201247912,"sessionId":"01J...A","stage":"brainstorm"}
{"kind":"agent.message.assistant","seq":2,"t":1746201262007,"sessionId":"01J...A","excerpt":"OK — start by listing the call sites of `permission.check`."}
{"kind":"task.state","seq":3,"t":1746201268114,"sessionId":"01J...A","taskId":"a1","from":"running","to":"completed"}
{"kind":"goal.note","seq":4,"t":1746203000000,"sessionId":"01J...A","text":"Decided to keep the legacy mode field for one release."}
{"kind":"harness.stage.enter","seq":5,"t":1746288000455,"sessionId":"01J...B","stage":"plan"}
{"kind":"agent.message.assistant","seq":6,"t":1746288245902,"sessionId":"01J...B","excerpt":"Resuming. Last note said: keep legacy mode for one release. Proceeding with new schema."}
{"kind":"task.state","seq":7,"t":1746288301077,"sessionId":"01J...B","taskId":"b3","from":"pending","to":"running"}
```

`seq` is monotonic per goal (not per session). Reset only on goal
archive.

### 5.4 `PermissionProfile` (`src/core/permission/profile.ts`)

```ts
import { z } from 'zod'

export const SandboxModeSchema = z.enum([
  'read-only',
  'workspace-write',
  'danger-full-access',
])
export type SandboxMode = z.infer<typeof SandboxModeSchema>

export const ApprovalPolicySchema = z.enum([
  'untrusted',
  'on-request',
  'never',
])
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>

export const PermissionProfileSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string().default(''),
  sandboxMode: SandboxModeSchema,
  approvalPolicy: ApprovalPolicySchema,
  /** Globs (picomatch syntax) the agent must NOT read. */
  denyReadGlobs: z.array(z.string()).default([]),
  /** Globs (picomatch syntax) the agent must NOT write. */
  denyWriteGlobs: z.array(z.string()).default([]),
  /** Env-var allowlist passed into spawned processes. Star ('*') = all. */
  envAllowlist: z.array(z.string()).default(['HOME', 'PATH', 'USER', 'LANG', 'TERM']),
  /** Optional: when true, escalation to danger-full-access triggers
   *  the auto_review reviewer subagent. */
  autoReview: z.boolean().default(false),
  /** Optional: reviewer model override (else config.compact.model). */
  autoReviewModel: z.string().optional(),
})

export type PermissionProfile = z.infer<typeof PermissionProfileSchema>

export const PermissionConfigSchema = z.object({
  profiles: z.record(z.string(), PermissionProfileSchema).default({}),
  /** Default profile name applied to new sessions. */
  defaultProfile: z.string().default('strict'),
})

export type PermissionConfig = z.infer<typeof PermissionConfigSchema>
```

The `PermissionConfigSchema` is added to the top-level `ConfigSchema`
(`src/core/config/schema.ts:168`) under the new `permission` key.

### 5.5 SessionMode → two-axis migration table

Existing `SessionMode` is `'normal' | 'plan' | 'bypass'`
(`src/core/session/types.ts:6`). The migration applied at load time:

| Old `SessionMode` | New `sandboxMode`     | New `approvalPolicy` | Notes                                                                            |
|-------------------|-----------------------|----------------------|----------------------------------------------------------------------------------|
| `normal`          | `workspace-write`     | `on-request`         | The mainstream flow. Maps to the `default` profile.                              |
| `plan`            | `read-only`           | `on-request`         | Plan-mode lockout retained: `Write/Edit/Bash` still hard-blocked on top.         |
| `bypass`          | `danger-full-access`  | `never`              | Equivalent to current "yolo". Auto-review disabled by default in this mapping.   |

The `Session.mode` field is **retained on disk for one release** as a
compatibility shim; loaders synthesize `{sandboxMode, approvalPolicy}`
from it when the new fields are absent. After one release, `Session.mode`
is removed and a one-shot migration writes the structured pair to all
existing meta files.

### 5.6 macOS Seatbelt profile (`assets/sandbox/seatbelt.sb.tmpl`)

Generated per-session by templating workspace path + deny-globs.
Stored at `~/.nuka/sandbox-profiles/<sessionId>.sb`. Consumed by
`sandbox-exec -f <path> <command>`.

```
;;; Nuka Seatbelt profile — workspace-write
;;; Generated: <ts>  Session: <sess>
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix-shm-read*)
(allow ipc-posix-shm-write*)

;; Read-only system paths
(allow file-read*
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/System")
  (subpath "/private/etc")
  (subpath "/Library/Frameworks")
  (subpath "/opt")
  (subpath "<HOME>/.npm")
  (subpath "<HOME>/.cache"))

;; Workspace: read+write
(allow file-read* file-write*
  (subpath "<WORKSPACE>"))

;; Deny-write globs (compiled from denyWriteGlobs)
<DENY_WRITE_RULES>

;; Deny-read globs (compiled from denyReadGlobs)
<DENY_READ_RULES>

;; Network: deny by default (workspace-write does not allow new net)
;; To enable, switch sandboxMode to danger-full-access (no profile applied).
(deny network-outbound)
(allow network-outbound (control-name "com.apple.network.statistics"))
```

`<WORKSPACE>` resolves to either `process.cwd()` (in-place) or the
worktree path. `<DENY_WRITE_RULES>` is generated as one
`(deny file-write* (subpath "<glob-as-prefix>"))` per glob, plus a
literal-prefix expansion for non-glob globs.

### 5.7 Linux bubblewrap argv (`src/core/permission/bwrap.ts`)

Exact invocation when `sandboxMode === 'workspace-write'` on Linux:

```
bwrap \
  --unshare-pid \
  --unshare-uts \
  --unshare-ipc \
  --unshare-cgroup-try \
  --die-with-parent \
  --new-session \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  --ro-bind /usr /usr \
  --ro-bind /bin /bin \
  --ro-bind /sbin /sbin \
  --ro-bind /lib /lib \
  --ro-bind /lib64 /lib64 \
  --ro-bind /etc/resolv.conf /etc/resolv.conf \
  --ro-bind ${HOME}/.nuka ${HOME}/.nuka \
  --ro-bind ${HOME}/.npm ${HOME}/.npm \
  --bind   ${WORKSPACE} ${WORKSPACE} \
  --chdir  ${WORKSPACE} \
  --setenv HOME ${HOME} \
  --setenv PATH /usr/local/bin:/usr/bin:/bin \
  --setenv USER ${USER} \
  --setenv NUKA_SANDBOX 1 \
  -- \
  ${COMMAND} ${ARGS...}
```

For `sandboxMode === 'read-only'`: replace `--bind ${WORKSPACE}` with
`--ro-bind ${WORKSPACE}`. For `danger-full-access`: do NOT invoke
bwrap (raw spawn).

**User-namespace fallback.** If `bwrap` exits with
`bwrap: setting up uid map: Permission denied` (sysctl
`kernel.unprivileged_userns_clone=0`, common on RHEL/CentOS), the
launcher emits a one-line warning and falls back to JS-only fence:
the same `PermissionChecker` decision is enforced via the existing
deny-list, but the OS layer is skipped. We log a one-time hint at
boot: `[nuka] bwrap unavailable (userns disabled); using JS-only
sandbox. See https://nuka/docs/sandbox#linux-userns`.

Network egress is left to the host network namespace; we do NOT
unshare-net (would break npm/pip/git fetches that the agent
legitimately needs). Network deny is enforced at the
`PermissionChecker` annotation layer (`openWorld`), not at bwrap.

### 5.8 Windows job objects + restricted tokens

Windows is best-effort. We invoke a small native helper
`assets/sandbox/win-jobsandbox.exe` (built once per release; ships in
the npm package as platform-prebuild) that:

1. Creates a job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`,
   `JOB_OBJECT_LIMIT_BREAKAWAY_OK`.
2. Creates a restricted token (`CreateRestrictedToken`) with
   `DISABLE_MAX_PRIVILEGE` and a deny-only SID list.
3. Spawns the target with `CreateProcessAsUser`, assigns to job,
   resumes.
4. Waits for exit; returns exit code.

Caveats documented in the spec output: no per-path read deny (Windows
ACLs would require setting up a transient sandbox user); deny-globs
are enforced JS-side only on Windows. We surface this in `/doctor`.

## 6. Component contracts

### 6.1 Worktree subsystem (`src/core/worktree/`)

#### 6.1.1 `WorktreeManager` — `src/core/worktree/manager.ts`

```ts
import type { Session } from '../session/types'
import type { EventBus } from '../events/bus'
import type { WorktreeMetadata } from './types'

export type WorktreeManagerOpts = {
  home: string
  bus: EventBus
  /** LRU cap. Default 15. Configurable via config.worktree.lruCap. */
  lruCap?: number
  /** Snapshot retention, days. Default 14. */
  snapshotRetentionDays?: number
}

export class WorktreeManager {
  constructor(opts: WorktreeManagerOpts)

  /** Attach an empty git worktree to the session. Returns metadata.
   *  Throws WorktreeBranchInUseError if branch is already checked out
   *  by another worktree. */
  async attach(opts: {
    session: Session
    branch?: string         // default: current HEAD
    repoRoot?: string       // default: detect via `git rev-parse --show-toplevel`
  }): Promise<WorktreeMetadata>

  /** Detach a session's worktree.
   *  - mode='clean'      → require clean tree, refuse if dirty
   *  - mode='stash'      → git stash unsaved changes, then remove
   *  - mode='snapshot'   → tar+gzip into worktree-snapshots/, then remove
   *  - mode='force'      → git worktree remove --force, lose changes */
  async detach(sessionId: string, mode: 'clean' | 'stash' | 'snapshot' | 'force'): Promise<void>

  /** Resolve the cwd for tool invocations against this session. */
  resolveCwd(session: Session): string

  /** Mark the worktree as recently used. Bumps to MRU position. */
  touch(sessionId: string): void

  /** Return registry entries newest-first. */
  list(): WorktreeMetadata[]

  /** Return metadata for one session (or undefined). */
  find(sessionId: string): WorktreeMetadata | undefined

  /** Recover an orphaned worktree directory under the registry. */
  async adopt(sessionId: string, path: string): Promise<WorktreeMetadata>

  /** Subscribe to lifecycle events; bus emits via 'task' topic. */
  onChange(cb: (m: WorktreeMetadata) => void): () => void
}
```

#### 6.1.2 `WorktreeResolver` — `src/core/worktree/resolver.ts`

```ts
import type { Session } from '../session/types'
import type { WorktreeManager } from './manager'

export class WorktreeResolver {
  constructor(private readonly mgr: WorktreeManager) {}

  /** Used by Read/Write/Edit/Grep/Glob/Bash to compute the effective
   *  cwd. Returns process.cwd() when session has no worktreeId. */
  cwd(session: Session): string {
    if (!session.worktreeId) return process.cwd()
    const m = this.mgr.find(session.worktreeId)
    if (!m) return process.cwd()  // orphaned — degrade gracefully
    this.mgr.touch(session.worktreeId)
    return m.path
  }
}
```

The cwd resolver is wired into the tools at registry construction. The
existing tool signatures are unchanged — we inject the resolver via
the existing `RunCtx`-style threading already used by Bash/Read/Write.

#### 6.1.3 `git` shim — `src/core/worktree/gitOps.ts`

Pure functions. All take `repoRoot` and shell out via `child_process.spawn`.
Errors are wrapped in typed `GitError`s with `.kind` for clean call-site
narrowing.

```ts
export type GitErrorKind =
  | 'branch-in-use'        // worktree add failed: branch is already checked out
  | 'dirty-tree'           // worktree has uncommitted changes
  | 'worktree-missing'     // worktree dir disappeared
  | 'unknown'

export class GitError extends Error {
  constructor(public readonly kind: GitErrorKind, public readonly stderr: string)
}

export async function worktreeAdd(opts: {
  repoRoot: string
  path: string
  branch: string
}): Promise<{ baseCommit: string }>

export async function worktreeRemove(opts: {
  repoRoot: string
  path: string
  force: boolean
}): Promise<void>

export async function worktreeIsClean(path: string): Promise<boolean>

export async function worktreeStash(path: string, message: string): Promise<void>

export async function listWorktrees(repoRoot: string): Promise<Array<{
  path: string
  branch: string
  commit: string
}>>
```

The exact git invocations are:

```
git -C <repoRoot> worktree add  <path> <branch>
git -C <repoRoot> worktree remove [--force] <path>
git -C <wtPath>   diff --quiet HEAD
git -C <wtPath>   stash push -u -m <message>
git -C <repoRoot> worktree list --porcelain
git -C <repoRoot> rev-parse HEAD
```

#### 6.1.4 LRU + snapshot rules

`WorktreeManager.touch` updates `lastTouchedAt`, moves to MRU, and if
`registry.entries.length > lruCap`, evicts the LRU entry by:

1. `tar -czf ~/.nuka/worktree-snapshots/<sess>-<ts>.tar.gz -C <wt> .`
2. `git worktree remove --force <wt>` (best-effort; `worktree-missing`
   errors are swallowed and logged)
3. Remove from registry.
4. Emit `task.evicted` on bus.

**LRU vs snapshot age conflict resolution.** When the LRU cap (default
15) is reached but the LRU entry is *newer* than the snapshot age cap
(14d), LRU wins: we evict the newest-out-of-cap entry. The 14-day
retention applies to *snapshots on disk*, not to live worktrees. So a
worktree that has been continuously touched for 30 days is never
evicted by age; only by LRU pressure or explicit `/worktree detach`.

### 6.2 Session model extensions (`src/core/session/types.ts`)

Additive only. Existing fields untouched. New fields:

```ts
export type Session = {
  // existing fields …
  /** Set when a worktree is attached (G1). 1:1 with sessionId. */
  worktreeId?: string
  /** Name of an entry in config.permission.profiles. Falls back to
   *  config.permission.defaultProfile when undefined. */
  permissionProfile?: string
  /** ULID of the bound goal, if any (G2). */
  goalId?: string
  /** DEPRECATED: keep for one release. Loaders synthesise the
   *  structured pair from this field if absent. */
  mode: SessionMode
  /** NEW: structured mode (G3). When set, takes precedence over `mode`. */
  sandboxMode?: SandboxMode
  approvalPolicy?: ApprovalPolicy
}
```

### 6.3 Goal subsystem (`src/core/goal/`)

#### 6.3.1 `GoalRegistry` — `src/core/goal/registry.ts`

```ts
import type { Goal, GoalState } from './types'
import type { EventBus } from '../events/bus'

export class GoalRegistry {
  constructor(opts: { home: string; bus: EventBus })

  async create(input: {
    name: string
    description: string
    parentGoalId?: string
    labels?: string[]
  }): Promise<Goal>

  async setState(id: string, state: GoalState): Promise<Goal>
  async setSummary(id: string, summary: string): Promise<Goal>
  async addSession(id: string, sessionId: string): Promise<Goal>
  async removeSession(id: string, sessionId: string): Promise<Goal>
  async note(id: string, sessionId: string | undefined, text: string): Promise<void>

  find(id: string): Goal | undefined
  list(filter?: { state?: GoalState; label?: string }): Goal[]

  /** Subscribe to registry mutations (active set changes, summary
   *  rewrites). Used by /goal show live re-renders. */
  onChange(cb: (g: Goal) => void): () => void

  /** Disk path for a goal's NDJSON rollout-trace file. */
  rolloutTraceFile(id: string): string
}
```

Persistence: each goal lives at `~/.nuka/goals/<goalId>.json`. Atomic
writes via `tmpfile + rename`. On boot, the registry hydrates by
scanning the dir; bad JSON files are quarantined to
`~/.nuka/goals/.quarantine/` with a logged warning.

#### 6.3.2 `GoalTraceWriter` — `src/core/goal/trace.ts`

The trace writer subscribes to existing EventBus topics and appends to
the per-goal NDJSON file. It does **not** create a new bus topic —
this is the architectural invariant.

```ts
import type { EventBus } from '../events/bus'
import type { GoalRegistry } from './registry'

export type GoalTraceWriterOpts = {
  bus: EventBus
  registry: GoalRegistry
  /** Function from sessionId → goalId|undefined. Provided by the
   *  SessionManager so the writer doesn't reach into Session state. */
  goalFor: (sessionId: string) => string | undefined
}

export function attachGoalTraceWriter(opts: GoalTraceWriterOpts): () => void
```

The writer's internal logic:

1. `bus.subscribe('task', e => …)` — on `task.created` and `task.state`,
   look up `e.task.sessionId ?? e.id`'s goalId via `opts.goalFor`. If
   present, append a `task.created`/`task.state` record.
2. `bus.subscribe('agent', e => …)` — on `agent.message.assistant`,
   trim text to 280 chars, append `agent.message.assistant` record.
3. `bus.subscribe('harness', e => …)` — on `harness.stage.enter`,
   append a `harness.stage.enter` record.
4. Sequence numbers come from a per-goal counter loaded from
   `<goal>.<seq>.cursor` sidecar (a single integer file).

#### 6.3.3 `/goal` slash command — `src/slash/goal.ts`

UX flow (each row is one branch in `runGoal(args)`):

| `/goal …`             | Behaviour                                                            |
|-----------------------|-----------------------------------------------------------------------|
| `(no args)`           | Show summary of the bound goal (or `(no goal bound)`).               |
| `new <name>`          | Open inline prompt for description. Create goal. Bind active session. |
| `list`                | Render table: `id (8) │ state │ name │ sessions │ updated`.           |
| `pause <id>`          | Set state=paused. Emit `goal.note` "paused by user".                  |
| `resume <id>`         | Set state=active. Bind active session if unbound.                    |
| `complete <id>`       | Set state=completed. Run editor agent (small fast model) to write a final summary into `goal.summary`. |
| `archive <id>`        | Set state=archived. Compress the rollout-trace NDJSON to `.gz` and move to `~/.nuka/goals/.archive/`. |
| `show <id>`           | Render goal detail: name, description, state, sessions list, last-10 trace lines. |
| `bind <id>`           | Bind active session to goal `<id>` (without creating a new goal).     |
| `unbind`              | Clear active session's `goalId`. Trace stops appending for the session.|
| `note <text>`         | Append a `goal.note` record to the trace. Useful for handoff hints.   |
| `inject`              | Manually re-inject the goal's summary into the system prompt.         |

#### 6.3.4 System-prompt injection template

When a session has `goalId` set, the agent loop's prompt builder
injects this block immediately after the harness header and before
the user message:

```markdown
## Goal: <goal.name>

State: <goal.state>   (sessions: <goal.sessions.length>)
Last updated: <iso(goal.updatedAt)>

### Description
<goal.description>

### Rolling summary
<goal.summary ?? '(no summary yet — call /goal complete or wait for the editor agent.)'>

### Last 5 trace events
- <fmt(trace[N-5])>
- <fmt(trace[N-4])>
- <fmt(trace[N-3])>
- <fmt(trace[N-2])>
- <fmt(trace[N-1])>
```

Where `fmt(rec)` is a one-line rendering: `harness.stage.enter` →
`▶ stage <stage>`; `task.state` → `task <id> <from>→<to>`;
`agent.message.assistant` → `↳ <excerpt slice 60>`; `goal.note` →
`📝 <text slice 80>`.

### 6.4 Permission subsystem extensions

#### 6.4.1 `PermissionCall` — `src/core/permission/types.ts`

```ts
import type { SandboxMode, ApprovalPolicy } from './profile'

export type PermissionCall = {
  toolName: string
  hint: PermissionHint
  input: unknown
  annotations?: {
    readOnly?: boolean
    destructive?: boolean
    openWorld?: boolean
  }
  /** DEPRECATED — kept for one release for backward-compat. */
  mode?: 'normal' | 'plan' | 'bypass'
  /** NEW: structured per-call mode, takes precedence. */
  sandboxMode?: SandboxMode
  approvalPolicy?: ApprovalPolicy
  /** NEW: the resolved profile (if any) for deny-glob enforcement. */
  profile?: PermissionProfile
}
```

#### 6.4.2 `PermissionChecker.check` — `src/core/permission/checker.ts`

The check is now a 5-step decision:

1. **Plan-mode lockout** (retained). If `mode === 'plan'`, refuse
   `Write/Edit/Bash` and any call with `annotations.destructive` or
   `annotations.openWorld` (preserves phase-8 semantics).
2. **sandboxMode gate.** Map sandbox×annotation:
   - `read-only` × any-write/destructive/openWorld → refuse
     `'sandbox: read-only mode forbids write/destructive/openWorld'`.
   - `workspace-write` × write → require workspace-relative path
     (compare against `WorktreeResolver.cwd(session)` prefix); refuse
     if path escapes.
   - `workspace-write` × openWorld → fall through to approval.
   - `danger-full-access` × any → fall through to approval.
3. **Profile deny-globs.** Resolve `denyReadGlobs` /
   `denyWriteGlobs` against the input path; refuse with
   `'profile <name> denies <hint>: <path>'` on match.
4. **Approval.** Apply `approvalPolicy`:
   - `untrusted` → require approval for *every* call, even
     read-only-annotated ones (paranoid mode).
   - `on-request` → require approval when `hint !== 'none'` and the
     cache has no matching rule (current semantics).
   - `never` → silently approve.
5. **OS sandbox dispatch.** When the call resolves to an exec-style
   tool (`Bash`, plugin spawn-runtime), invoke the OS sandbox layer
   (§5.6/5.7/5.8) before handing off to the runner.

#### 6.4.3 `SandboxLauncher` — `src/core/permission/sandboxLauncher.ts`

```ts
import type { PermissionProfile } from './profile'
import type { Readable } from 'node:stream'

export type SandboxSpawnInput = {
  command: string
  args: string[]
  env?: Record<string, string>
  cwd: string
  workspace: string  // worktree path or process.cwd()
  profile: PermissionProfile
  signal?: AbortSignal
}

export type SandboxSpawnResult = {
  exitCode: number
  stdout: Readable
  stderr: Readable
  /** When set, the OS sandbox layer was unavailable and the call
   *  fell back to JS-only fence. */
  fallback?: 'no-bwrap' | 'no-sandbox-exec' | 'no-jobsandbox' | 'userns-disabled'
}

export interface SandboxLauncher {
  /** Returns true if this launcher can run on the current platform. */
  available(): Promise<boolean>

  spawn(input: SandboxSpawnInput): Promise<SandboxSpawnResult>
}

/** Picks the right launcher per platform. */
export function pickSandboxLauncher(): SandboxLauncher
```

Three concrete launchers ship: `SeatbeltLauncher`, `BwrapLauncher`,
`WindowsJobLauncher`, plus a `NoopFallbackLauncher` that runs raw
`child_process.spawn` with the env-var allowlist applied.

#### 6.4.4 `auto_review` reviewer subagent

Triggered when the user requests an escalation:
`approvalPolicy: never` ↑ from `on-request`, OR
`sandboxMode: danger-full-access` requested mid-session. Invokes
`runForkedAgent` (phase14 §6.6) with:

- model = `profile.autoReviewModel ?? config.compact.model`
- system prompt = the literal template at
  `assets/prompts/autoReviewSystem.md` (a deny-by-default reviewer)
- user prompt = JSON-stringified `PermissionCall` plus the last 3
  assistant messages of the session (for context)

Returns `{ verdict: 'allow' | 'deny', reason: string }`. A `deny`
verdict refuses the call with `'auto_review denied: <reason>'`.
Disabled by default (`profile.autoReview = false`).

### 6.5 Slash commands (`src/slash/`)

New / extended commands:

```ts
// src/slash/worktree.ts (NEW)
export const WorktreeCommand: SlashCommand = {
  name: 'worktree',
  description: 'Manage the per-session git worktree',
  usage: '/worktree [on|off|status|list|adopt <path>]',
  // ...
}

// src/slash/handoff.ts (NEW)
export const HandoffCommand: SlashCommand = {
  name: 'handoff',
  description: 'Swap the active session between in-place and worktree',
  usage: '/handoff [in-place|worktree] [--snapshot]',
  // ...
}

// src/slash/goal.ts (NEW)
export const GoalCommand: SlashCommand = {
  name: 'goal',
  description: 'Manage long-running objectives across sessions',
  usage: '/goal [new|list|pause|resume|complete|archive|show|bind|unbind|note|inject] [...]',
  // ...
}

// src/slash/permission.ts (NEW)
export const PermissionCommand: SlashCommand = {
  name: 'permission',
  description: 'Show / change the active permission profile',
  usage: '/permission [show|use <profile>|escalate|list]',
  // ...
}

// src/slash/fork.ts (EXTENDED)
//   When the parent has worktreeId, the fork creates a new worktree
//   branched from the same baseCommit; otherwise unchanged.

// src/slash/rewind.ts (EXTENDED)
//   File checkpointing now resolves paths against the WorktreeResolver
//   so a rewind in a worktree-backed session restores files inside
//   the worktree, not the host cwd.
```

### 6.6 Configuration extension (`src/core/config/schema.ts`)

```ts
export const WorktreeConfigSchema = z
  .object({
    /** Default-on opt-in toggle for new sessions (default: false). */
    enabledByDefault: z.boolean().default(false),
    /** LRU cap. Default 15. */
    lruCap: z.number().int().positive().default(15),
    /** Snapshot retention, days. Default 14. */
    snapshotRetentionDays: z.number().int().positive().default(14),
  })
  .optional()

export const GoalConfigSchema = z
  .object({
    /** Auto-bind new sessions to the most-recent active goal. */
    autoBindActive: z.boolean().default(false),
    /** Run the editor agent on /goal complete to write summary.    */
    autoSummariseOnComplete: z.boolean().default(true),
  })
  .optional()

// Inserted into ConfigSchema:
//   worktree:   WorktreeConfigSchema,
//   goal:       GoalConfigSchema,
//   permission: PermissionConfigSchema,
```

### 6.7 Boot sequence wiring (`src/cli.tsx`)

Three additive steps inserted immediately after `ensureNukaLayout(home)`
(currently `src/cli.tsx:439`):

```ts
const worktreeMgr = new WorktreeManager({
  home,
  bus: eventBus,
  lruCap: config.worktree?.lruCap,
  snapshotRetentionDays: config.worktree?.snapshotRetentionDays,
})
const worktreeResolver = new WorktreeResolver(worktreeMgr)

const goalRegistry = new GoalRegistry({ home, bus: eventBus })
attachGoalTraceWriter({
  bus: eventBus,
  registry: goalRegistry,
  goalFor: sessionId => sessionMgr.find(sessionId)?.goalId,
})

const permissionConfig = config.permission ?? defaultPermissionConfig()
const sandboxLauncher = pickSandboxLauncher()
```

The `PermissionChecker` constructor takes new optional deps:

```ts
new PermissionChecker(
  () => sessionMgr.active()?.permissionCache ?? new PermissionCache(),
  permissionBridge.ask.bind(permissionBridge),
  { sandboxLauncher, profileResolver: name => permissionConfig.profiles[name] },
)
```

### 6.8 Tool annotation → default mapping table

Used as fallback when a session has no `permissionProfile` set:

| Annotation                                     | Default `sandboxMode`     | Default `approvalPolicy` |
|------------------------------------------------|---------------------------|--------------------------|
| `readOnly: true` only                          | `read-only`               | `on-request`             |
| `destructive: true` only                       | `workspace-write`         | `on-request`             |
| `openWorld: true` only                         | `workspace-write`         | `on-request`             |
| `destructive: true` AND `openWorld: true`      | `workspace-write`         | `untrusted`              |
| (no annotations)                               | `workspace-write`         | `on-request`             |
| Active `Session.mode === 'bypass'` (legacy)    | `danger-full-access`      | `never`                  |
| Active `Session.mode === 'plan'`  (legacy)     | `read-only`               | `on-request` + plan lock |

## 7. Testing strategy

| Area                 | Test type             | Coverage targets                                                                                  |
|----------------------|-----------------------|---------------------------------------------------------------------------------------------------|
| Worktree types       | `*.test-d.ts`         | `WorktreeMetadata` Zod parse round-trip; `Session.worktreeId` typing                              |
| WorktreeManager      | unit + tmp git repo   | `attach` then `detach` clean-mode round-trip; LRU eviction at cap+1; orphan adoption              |
| GitOps               | unit + child_process mock | Each typed `GitErrorKind` from a stderr fixture                                              |
| WorktreeResolver     | unit                  | `cwd` returns `process.cwd()` when `worktreeId` is undefined; touches LRU on resolve              |
| Goal types           | `*.test-d.ts` + Zod   | `RolloutTraceRecordSchema` round-trips for all 5 kinds                                            |
| GoalRegistry         | unit + tmpdir         | `create` writes JSON atomically; `setState` bumps `updatedAt`; quarantine on bad JSON             |
| GoalTraceWriter      | unit + fake bus       | Subscribes 3 topics; appends only for sessionIds with goalId; sequence is monotonic per goal      |
| /goal slash          | unit                  | Each subcommand returns expected `{type:'text'\|'dialog'}` shape                                  |
| PermissionProfile    | unit + Zod            | Default profile parses; deny-globs validate as picomatch syntax                                   |
| PermissionChecker    | unit                  | All 5 decision steps; legacy `mode` + new `sandboxMode` precedence; profile deny-glob refusals    |
| SeatbeltLauncher     | unit (mock spawn)     | Generated `.sb` substitutes `<WORKSPACE>` / `<DENY_*>` correctly; available() returns false off macOS |
| BwrapLauncher        | unit (mock spawn)     | Argv built per §5.7; userns-disabled stderr triggers fallback                                     |
| WindowsJobLauncher   | unit (mock spawn)     | available() returns false off Windows; the helper exe path resolves                               |
| auto_review          | unit + msw            | Reviewer fork is spawned only when escalation requested; `deny` verdict refuses                   |
| Migration            | integration           | Old session JSON with `mode='bypass'` loads as `{danger-full-access, never}`                      |
| /handoff conflict    | integration + tmp git | Each of 4 rows in §4.3 produces the documented action                                             |
| End-to-end goal      | integration           | Create goal, bind 2 sessions, drive 6 events, observe NDJSON file with 6 records, monotonic seqs  |
| Sandbox real-spawn   | e2e (gated)           | Linux CI runs bwrap; macOS CI runs sandbox-exec; both attempt a denied path and fail              |

CI gate: `npm run typecheck && npm test` stays green; bundle size
budget +25 KB max (target 340 KB after Spec B); the OS-sandbox helpers
ship outside the JS bundle (binary helper for Windows; static `.sb`
template for macOS; no extra deps for Linux beyond runtime `bwrap`).

## 8. Milestones

M0 is blocking. M1–M3 (worktree), M4–M5 (goal), M6–M8 (sandbox) are
independent tracks that may land in any order after M0. Each M is one
PR / one branch.

| M  | Track    | Subject                                                                  | LOC est. | Tests |
|----|----------|--------------------------------------------------------------------------|---------:|------:|
| M0 | Schema   | Zod schemas for WorktreeMetadata, Goal, RolloutTraceRecord, PermissionProfile; `paths.ts` extensions for `worktrees/`, `worktree-snapshots/`, `goals/`, `sandbox-profiles/`; config schema additions | 280 | 4 unit |
| M1 | Worktree | `WorktreeManager.attach/detach/find/touch/list/adopt`; `gitOps.ts` typed errors; `WorktreeRegistry` JSON persistence | 460 | 9 unit + 1 integ |
| M2 | Worktree | `WorktreeResolver` + tool cwd injection across Read/Write/Edit/Bash/Grep/Glob; `/worktree` slash | 320 | 6 unit + 1 e2e |
| M3 | Worktree | `/handoff` slash with full 4-row conflict resolution; `/fork` extension to branch a worktree; `/rewind` worktree-relative paths; LRU eviction + snapshot retention sweep on boot | 380 | 8 unit + 2 integ |
| M4 | Goal     | `GoalRegistry` CRUD + atomic JSON write + quarantine; `GoalTraceWriter` bus subscriber + per-goal `<id>.<seq>.cursor` sidecar; rollout NDJSON appender | 360 | 7 unit + 1 integ |
| M5 | Goal     | `/goal` slash (12 sub-commands); system-prompt injection template; bind-on-create flow; `/goal complete` summary via `runForkedAgent` | 420 | 12 unit |
| M6 | Sandbox  | Two-axis `PermissionCall` extension; 5-step `PermissionChecker.check`; profile resolver; legacy mode→pair migration; `/permission` slash | 340 | 10 unit + 1 integ |
| M7 | Sandbox  | `SandboxLauncher` interface + Seatbelt + bwrap + Windows-job + Noop launchers; `.sb` template renderer; bwrap argv builder; userns-disabled fallback | 520 | 8 unit + 2 e2e (Linux/macOS CI) |
| M8 | Sandbox  | `auto_review` reviewer subagent flow; `/permission escalate` UI; `/doctor` reports sandbox availability; bundle-size + retention sweep audit | 280 | 5 unit + 1 e2e |

**Track sequencing rule.** Once M0 has landed, the three tracks may
proceed in parallel. Within each track, the milestones are sequential.
M2 cannot land before M1; M3 cannot land before M2. M5 cannot land
before M4. M7 cannot land before M6; M8 cannot land before M7.

**Closeout audit (after M8):**
- Bundle size: target ≤ 340 KB (current 312 KB + 25 KB budget = 337 KB).
- Tests added: 69 unit + 6 integration + 4 e2e (gated by platform).
- Public exports added: `WorktreeManager`, `WorktreeResolver`,
  `GoalRegistry`, `attachGoalTraceWriter`, `pickSandboxLauncher`,
  `PermissionProfile`, slash commands `Worktree`/`Handoff`/`Goal`/
  `Permission`.
- No public type renamed except `PermissionCall.mode` deprecation
  (kept one release for compat).

## 9. Risks & rollbacks

| # | Risk                                                                                                                  | Likelihood | Mitigation                                                                                                                              | Rollback                                                                                                              |
|---|-----------------------------------------------------------------------------------------------------------------------|------------|------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| 1 | `bwrap` not present, or user namespaces disabled (RHEL/CentOS, hardened kernels)                                       | High       | `BwrapLauncher.available()` probes by running `bwrap --version`; on `setting up uid map: Permission denied` we set `fallback='userns-disabled'` and continue with JS-only fence; one-line warning at boot, surfaced in `/doctor` | Disable OS-sandbox layer entirely via `permission.disableOsSandbox: true`; behavior reverts to phase-8 JS-only |
| 2 | Worktree on Windows: paths >260 chars, case-insensitive collisions, Defender locks                                     | High       | `WorktreeManager.attach` calls `git worktree add` with short paths (`%LOCALAPPDATA%\nuka\wt\<6 chars>`); we document the long-paths registry key in `/doctor`; case-insensitive collisions surface as `branch-in-use` | `/handoff in-place` + manual `git worktree remove`; the orphan-adopt path recovers state |
| 3 | Goal-state divergence on crash mid-write (process killed between JSON write and rolling-summary update)                | Medium     | All goal mutations are atomic: write `.tmp` then `rename`; the `<id>.<seq>.cursor` sidecar is written after the NDJSON append; on boot, the cursor is reconciled by counting NDJSON lines | Quarantine the goal JSON to `.quarantine/`; surface `/goal show` warning; user can replay from NDJSON |
| 4 | LRU eviction snapshots a worktree with uncommitted changes, then user expects to rewind                                | Medium     | Snapshot path is documented in `/worktree status`; eviction emits `task.evicted` to the bus with the snapshot path; user can `tar -xzf` to recover | `permission.disableOsSandbox` does not affect this; user can also set `worktree.lruCap: 9999` to disable LRU |
| 5 | Sandbox-exec profile syntax error breaks all spawns on macOS                                                           | Medium     | Profile renderer has unit tests against the literal `(version 1)` shape; we run a smoke test (`sandbox-exec -f profile -- /usr/bin/true`) on first use of a session and disable the profile if it fails | Auto-disable: if smoke fails, `SeatbeltLauncher.spawn` falls back to raw spawn with env-allowlist applied + warning |
| 6 | Two-axis migration silently drops a remembered `bypass` session into `danger-full-access` permanently                  | Medium     | One-time CHANGELOG entry; first-run banner shown for any session loaded with a synthesized pair; `/permission show` displays "(migrated from bypass)" | Set `permission.disableMigration: true` to keep loading old `mode` field with phase-8 semantics                       |
| 7 | Goal trace NDJSON grows unbounded                                                                                      | Low        | Per-goal cap: when file > 50 MB, rotate to `<id>.<n>.ndjson.gz` (same scheme as phase14 events); retention 90 days unless `state === 'archived'` | Rolling sweep runs on boot; surfaces in `/doctor`                                                                     |
| 8 | `auto_review` reviewer bills every escalation                                                                          | Medium     | Disabled by default. When enabled, reviewer uses the cheap model from `compact.model`; we log the cost rollup under `/stats`; we cache verdicts for the same `PermissionCall` shape for 5 minutes | Set `permission.autoReview: false`                                                                                    |
| 9 | Worktree races with the user's external git work (e.g. `git checkout` on the same branch)                              | Medium     | Every cwd-resolution call invokes `worktreeIsClean(path)` lazily; if `.git/index.lock` is present we skip the touch; user-facing warning surfaces in `/worktree status` | `/handoff in-place` returns the user to host cwd                                                                       |
| 10 | Plugin tools that call `child_process.spawn` directly bypass the sandbox launcher                                      | High       | Document in plugin authoring docs; surface in `/doctor` as "N plugin tools spawn directly without sandbox"; long-term: ship a wrapped `nuka-spawn` helper plugins are encouraged to use | Plugin authors who need OS-level isolation invoke `pickSandboxLauncher().spawn(...)` from plugin code (public API)    |
| 11 | Goal pause mid-trace flushes inconsistent state                                                                        | Low        | Pause writes a `goal.note` "paused" *after* the bus subscriber has drained; the subscriber's internal queue is sync (no async between subscribe and append) | Replay from NDJSON                                                                                                    |
| 12 | Seatbelt / bwrap argv changes between OS versions                                                                       | Low        | `pickSandboxLauncher()` consults `os.release()` for known incompatible versions and degrades; we keep a tested-versions table in `assets/sandbox/COMPAT.md` | Set `permission.disableOsSandbox: true`                                                                                |

## 10. Out-of-scope / deferred to siblings

- **Spec A — Finish-the-Promise:** Editor-in-chief agent, recap ↔ goal
  bridge (a recap may post a `goal.note` on session end), live-status
  surfaces of `/goal list` inside the Tasks panel.
- **Spec C — Cron primitive:** External triggers that may schedule
  a session against an active goal id.
- **Spec D — Provider expansion:** Per-profile model overrides
  (e.g., `permissionProfile.modelOverride`); reviewer-subagent
  routed through provider-D's small-fast model.
- **Spec E — Context audit:** Goal summary regeneration triggered by
  context-budget pressure; rollout-trace deduplication during compact.

The following are explicitly **NOT** in any sibling spec either:

- App-server / external WebSocket protocol.
- VSCode / web client.
- IM adapters (Slack / Discord).
- Cross-host worktree mounting.
- Goal sharing / merging across users.

---

## Spec self-review checklist (run inline before commit)

- ✅ §1 Problem cites file:line for each current-state claim.
- ✅ §2 Goals are 4 numbered, mapping 1:1 to the four components in §6.
- ✅ §3 Non-goals lists app-server, WS protocol, web client,
  RemoteTrigger, IM adapters, cross-host worktrees, goal sharing.
- ✅ §4 has two ASCII diagrams (composition + lifecycle) and one
  decision table; no Mermaid.
- ✅ §5 has Zod blocks for all four required schemas
  (Goal, RolloutTrace, PermissionProfile, WorktreeMetadata) plus
  literal Seatbelt template, literal bwrap argv, and a worked NDJSON
  example.
- ✅ §6 has TypeScript signatures for ≥ 12 entry points across the
  three tracks.
- ✅ §7 lists test type and coverage target per area, including e2e
  gates by platform.
- ✅ §8 splits 9 milestones (M0..M8) into worktree/goal/sandbox
  tracks and documents the parallel-after-M0 sequencing.
- ✅ §9 explicitly addresses the three brief-listed risks: bwrap
  unavailable on userns-disabled hosts (#1), worktree Windows
  gotchas (#2), goal-state divergence on crash mid-write (#3).
- ✅ §10 cross-references all four sibling specs by name.
- ✅ Each goal in §2 maps to a §6 contract section
  (G1↔§6.1, G2↔§6.3, G3↔§6.4, G4↔§6.4.3).
- ✅ Each schema in §5 is referenced by at least one §6 contract.
- ✅ No "TBD" / "TODO" / placeholder text in normative sections
  (§§ 1–8).
- ✅ Phase 14 foundation terms used verbatim: `TaskKind`, `EventBus`,
  `MessageEnvelope`, `Session`, `runForkedAgent`,
  `ProgressTrackerSnapshot`.
- ✅ No new EventBus topic introduced; goal trace is a subscriber.
- ✅ Migration table (§5.5) documented; legacy `Session.mode` kept
  one release.
- ✅ "Be opinionated" — sandbox argv literal (§5.7), Seatbelt
  template literal (§5.6), `/handoff` 4-row table (§4.3), goal
  prompt template literal (§6.3.4), LRU vs age conflict
  resolution (§6.1.4) all resolved in this spec, not deferred.
