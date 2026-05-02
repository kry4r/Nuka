# Spec A — Finish the Promise (Phase 14 收尾)

**Date:** 2026-05-02
**Status:** Spec
**Depends on:** `2026-04-30-phase14-foundation-design.md` (TaskKind, EventBus, MessageEnvelope, MessageRouter, MessageBackend, ProgressTrackerSnapshot, runForkedAgent, on-disk layout `~/.nuka/{tasks,recaps,forks,events,sockets}/`), `2026-04-30-phase14a-swarm-design.md` (UDS backend skeleton), `2026-04-30-phase14b-monitor-design.md` (Tasks panel zoomed view), `2026-04-30-phase14c-recap-design.md` (idleWatcher, awaySummary, autoDream, RecapDoc), `2026-05-01-harness-three-axis-refactor-design.md` (HarnessStateMachine, triage, primitives), `2026-05-02-ink-ui-explorer-design.md` (autonomous UI explorer, M8 reference only)
**Sibling specs (parallel, do not duplicate):**
- `2026-05-02-spec-b-modernize-core-design.md` — worktree-as-thread + `/goal` + sandbox
- `2026-05-02-spec-c-cron-primitive-design.md` — cron engine + 2 tools
- `2026-05-02-spec-d-provider-expansion-design.md` — Gemini / Bedrock / Vertex / local
- `2026-05-02-spec-e-context-audit-design.md` — context bloat investigation

**Author:** Brainstorming session 2026-05-02 (post-five-bug-sweep, pre-spec-fan-out)

---

## 1. Problem statement

Phase 14 (foundation + a/b/c/d) shipped the data primitives: TaskKind union,
EventBus, MessageRouter, TeamRegistry, ProgressTracker, runForkedAgent,
HarnessStateMachine, recap reducers, idle/away surfaces. The phase
14d-superseded three-axis harness refactor (`docs/plans/2026-05-01-harness-three-axis-refactor-design.md`)
landed the new triage / coordination layer. But several code-paths the
README and the foundation specs *advertise* are still stubs, no-ops or
runtime errors. The product, as-shipped, lies about what it does in
five concrete places:

### 1.1 Three harness primitive callables are stubs

`src/cli.tsx:699-708` shows the wiring:

```ts
tools.register(makeSearchAndVerifyTool(harness, { runResearcher: async (q) => `(stub) results for: ${q}` }) as any)
tools.register(makeAskUserQuestionTool(harness, { askUser: async (q) => `(prompt user via TUI: ${q})` }) as any)
// …
const triageRunFork = async (_p: string): Promise<{ text: string }> => ({
  text: '(stub triage fork response)',
})
```

The harness primitives `search_and_verify` and `ask_user_question`
(defined in `src/core/harness/primitives.ts:20-54`) take `runResearcher`
and `askUser` callables, and the triage path
(`src/core/harness/state.ts:51-57`) takes `runFork`. All three are
hard-coded to literal-string placeholders at the cli boot site. The
result: when `/triage` runs, when the editor agent calls
`search_and_verify`, when any harness primitive needs a clarifying
answer — the user sees the placeholder text. None of the
mid-stage-primitive enforcement promised by the harness state machine
(state.ts:97-108 `canExit`) is actually exercised against real LLM
output, because the LLM is never reached.

### 1.2 `run-shell` is a hard `throw`

`src/core/tasks/run-shell.ts` is three lines:

```ts
export async function runShell(_task: Task, _signal: AbortSignal): Promise<void> {
  throw new Error('run-shell: not implemented (phase14a)')
}
```

The `LocalShellSpec` task kind (`src/core/tasks/types.ts`,
`{ kind: 'local_shell', pty: boolean, command, args, cwd, env }`)
exists in the discriminated union. The TaskManager dispatch switch
(`src/core/tasks/manager.ts`'s `pickRunner`) routes `local_shell` to
this throw. The README's "Tasks panel … five-column layout" implies
shell tasks render in the Backgrounds column with a zoomed PTY view
(phase14b §6.2 `SubagentDetail`). Today, any caller that constructs
a `LocalShellSpec` (no built-in does — but plugins and the editor agent
are documented to be allowed) crashes the task at `state = 'running'`.

### 1.3 `run-remote-agent` is a hard `throw`

Identical shape to §1.2:

```ts
// src/core/tasks/run-remote-agent.ts
export async function runRemoteAgent(_task: Task, _signal: AbortSignal): Promise<void> {
  throw new Error('run-remote-agent: not implemented (phase14a)')
}
```

The original phase14a-swarm spec (§3 non-goals) deferred this. Spec A
implements it, scoped to **local IPC only** — the
`docs/superpowers/specs/2026-04-23-nuka-rewrite-design.md` (and earlier
phase11-mcp-removal-tool-platform-design.md) explicitly dropped the
"app-server protocol" / external WS/TCP plan. Remote-agent tasks in
Spec A are a child Node process talking over a Unix domain socket
under `~/.nuka/sockets/`; nothing leaves the box.

### 1.4 `UdsBackend` is a no-op

`src/core/messaging/udsBackend.ts` is the skeleton phase14a §6.8 left:

```ts
export class UdsBackend implements MessageBackend {
  readonly kind = 'uds' as const
  send(_envelope: MessageEnvelope): Promise<boolean> { return Promise.resolve(false) }
  subscribe(_localAddress: string, _cb: (e: MessageEnvelope) => void): () => void { return () => {} }
  pending(_localAddress: string): number { return 0 }
  drain(_localAddress: string): MessageEnvelope[] { return [] }
}
```

Sending always returns `false` (drops the envelope on the floor);
subscribing leaks no-ops. Without a real UDS backend, the
`run-remote-agent` work in §1.3 has no transport for `MessageEnvelope`
delivery to the spawned child process. They are coupled deliverables.

### 1.5 Slash text-results render path is unreliable in the test harness

`src/tui/App.tsx:386-396` does call `appendMessage` for slash results
of `type: 'text'`. So the **runtime** path is wired. The brittle part
is the headless test harness in `src/tui/testing/harness.ts`:
test-plans `03-theme-switch.yaml`, `05-plan-mode-lockout.yaml` and
`06-slash-text-output.yaml` carry "DOWNGRADE NOTE" comments stating
that text-results "are not surfaced into the rendered frame" of the
harness. The cause is the assistant message being appended after the
`SlashRegistry` returns, while the test runner's `frames()` snapshot is
taken before the React reconciler flushes the new state. The fix is a
deterministic flush hook in the harness, plus a non-`<Static>` render
path for slash-emitted assistant messages so the harness `frames()`
sees them. (`src/tui/Messages/Messages.tsx:81-107` confirms `Messages`
no longer uses `<Static>`, but the harness has no equivalent of "wait
for next render" — it just polls `frames()`.) Closing this loop turns
test-plans 03/05/06 from "degraded" into "green".

### 1.6 Recap auto-surface on `--resume` is missing

`src/core/recap/idleWatcher.ts` and `src/core/recap/awaySummary.ts` are
fully implemented. `src/core/recap/builder.ts` produces a structured
`RecapDoc`. `src/core/recap/persist.ts` writes to `~/.nuka/recaps/`.
What's missing is the launch-time hook: when the user runs
`nuka --resume <id>` (handled by `ResumeCommand` /
`src/slash/resume.ts:9` for in-session resume, and by the cli boot for
flag-resume), the App reducer never asks awaySummary for a card. The
session is resumed silently. The README's "Recap & dream" headline
implies the user gets a "while you were away" card; today nothing
fires.

### 1.7 Two README slash commands are missing

The README §Slash commands table advertises:

| Command | Status | File |
|---------|--------|------|
| `/teams` | **missing** | no `src/slash/teams.ts` |
| `/sessions` | **missing as advertised** | only `src/slash/resume.ts` exists; opens session-picker |

`/teams` is genuine new work — the `TeamRegistry`
(`src/core/teams/registry.ts`) exists and is used by phase14a
`team_create` / `team_delete` tools, but no slash entry walks it.
`/sessions` is closer to "rename" — `ResumeCommand` already returns
`{ type: 'dialog', dialog: { kind: 'session-picker' } }` — but the
README treats them as distinct (resume = "current session restart",
sessions = "browse"). Spec A picks the simplest honest path: keep
`/resume` as today and add a thin `/sessions` slash that opens the same
session-picker but with browsing affordances (no auto-close on
selection — user can preview metadata first).

### 1.8 ink-ui-explorer skill is designed but not built

`docs/superpowers/specs/2026-05-02-ink-ui-explorer-design.md` is locked
(milestones M1..M6 in §7 of that spec). It is **not** re-specified
here. M8 of this spec is the implementation milestone for Nuka's
end of that integration: ship the `test/ui-auto/fixtures/` skeleton,
add `.ink-explorer/` to `.gitignore`, sweep the existing components,
and let the explorer's M2 reproduce the nine layout regressions
already in `git log` (commits `6107a64`, `0743b22`).

### 1.9 Test-plan degradation markers as exit criteria

The following test-plan files carry "DOWNGRADE NOTE" or
"degraded" comments and are the contract Spec A signs against:

- `test-plans/03-theme-switch.yaml` (lines 7-21): slash text-results
  not surfaced into rendered frame.
- `test-plans/05-plan-mode-lockout.yaml` (lines 8-19): plan-mode banner
  not asserted, slash text-results not surfaced.
- `test-plans/06-slash-text-output.yaml` (lines 1-19): the canonical
  text-output verification — currently asserts `contains: '/help'` and
  `contains: 'help'` but only because the text appears in
  `appendMessage`'s log; the harness `frames()` race makes it flaky.

The Spec A acceptance gate (§7) demands: each of these three test
plans turns deterministically green, with no skipped or downgraded
assertion, on three consecutive headless runs.

---

## 2. Goals

Each goal maps 1:1 to a milestone in §8.

1. **G1 → M1.** Wire `triageRunFork` to a real cache-safe fork that
   uses the small fast model when available, falling back to the user's
   default model. The callable signature stays `(prompt: string) => Promise<{ text: string }>`
   so the harness state machine and `/triage` slash don't change.
2. **G2 → M2.** Wire `runResearcher` for `search_and_verify`. Real
   implementation = forked agent with read-only tool whitelist (Read,
   Grep, Glob, WebFetch when configured), plus a verify pass that
   re-reads any file the searcher quoted. Caps: 200-token output,
   3 tool calls, 30s wall budget.
3. **G3 → M3.** Wire `askUser` for `ask_user_question` to a real TUI
   round-trip via the existing `PermissionChecker` bridge in
   `src/cli.tsx`'s `permBridge`. Question is rendered as a submenu;
   user's typed answer is the resolved Promise value. 5-min default
   timeout → reject with `"(user did not respond)"` (matches phase14d
   §9 risk row).
4. **G4 → M4.** Implement `run-shell` as a `node-pty`-backed
   long-running interactive shell Task. Emits `task.progress`
   snapshots (cumulative output bytes, last 200 chars summary).
   Surfaces in the Tasks-panel Backgrounds column via the existing
   phase14b zoomed view. Honors the foundation shutdown protocol
   (`requestShutdown` → SIGTERM → 30s grace → SIGKILL).
5. **G5 → M5.** Implement `UdsBackend` as a real Unix domain socket
   transport. One socket per teammate at
   `~/.nuka/sockets/<sessionId>/<agentName>.sock`. Length-prefixed
   newline-delimited JSON envelopes. Connect/reconnect with backoff;
   subscribe is `accept()` loop on the listener side.
6. **G6 → M6.** Implement `run-remote-agent` as a child-Node-process
   agent runner. The child runs a minimal AgentLoop (no TUI) and
   speaks via `UdsBackend`. The parent registers the child's local
   address with `MessageRouter` and spawns it under a sandbox profile
   (deferred to Spec B for sandbox details — Spec A uses the existing
   `process.spawn` with `{ cwd, env, detached: false }`).
7. **G7 → M7.** Test-plan harness flush hook + slash text reliability.
   Add `harness.waitForFrameContaining(text, opts)` that flushes
   pending React state on each poll. Replace the 03/05/06 test-plans'
   ad-hoc `wait: { ms: 50 }` waits with the new step. Remove the
   "DOWNGRADE NOTE" comments.
8. **G8 → M7 (same milestone).** Recap auto-surface on `--resume`.
   Boot-time path in `cli.tsx`: detect `--resume <id>`, after session
   is loaded, fork `awaySummary.generateAwaySummary` against the last
   30 messages, push the result into the App's reducer as the first
   system frame. Card uses `<AwaySummaryCard>` (already specced in
   phase14c §6.3, render path `src/tui/Recap/AwaySummaryCard.tsx`).
9. **G9 → M7.** Add `/teams` slash command listing teams from
   `TeamRegistry`, with Enter→roster submenu (members + currently
   running task ids).
10. **G10 → M7.** Add `/sessions` slash command opening the existing
    `session-picker` submenu in browse mode (preview without immediate
    resume).
11. **G11 → M8.** Ink-ui-explorer integration: bring up the per-project
    footprint (fixtures dir + `.ink-explorer/` + `.gitignore` rule),
    author 8 fixtures (one per shipped TUI component), run sweep, file
    found regressions as auto-promoted fixtures.

---

## 3. Non-goals

Explicitly **not** in Spec A:

- ❌ **No app-server protocol.** The `nuka-rewrite-design.md` (2026-04-23)
  dropped the daemon/app-server. `run-remote-agent` is local IPC only.
- ❌ **No external WS / TCP / HTTP transports.** UDS only. Cross-machine
  bridging is deferred indefinitely (phase14a §10 open question).
- ❌ **No IM adapters** (no Slack, no Discord, no Telegram bot). Sibling
  spec B owns user-facing channels via worktree-as-thread.
- ❌ **No new providers.** Sibling spec D adds Gemini / Bedrock /
  Vertex / local. Spec A only uses the providers already wired.
- ❌ **No worktree-as-thread.** Sibling spec B owns it. Spec A's
  `/sessions` does not list worktree threads.
- ❌ **No `/goal`-style intent slash.** Sibling spec B owns it.
- ❌ **No cron primitive.** Sibling spec C owns the scheduling engine.
- ❌ **No context-bloat fix.** Sibling spec E owns audit + remediation.
- ❌ **No new TUI panels or columns.** All wiring lands in
  pre-existing surfaces (Backgrounds column, AwaySummaryCard,
  session-picker submenu).
- ❌ **No new providers, models, or model defaults.** Existing
  `getSmallFastModel()` resolution is reused as-is.
- ❌ **No restructuring of the harness state machine.** The
  three-axis refactor (`docs/plans/2026-05-01-harness-three-axis-refactor-design.md`)
  is the source of truth; Spec A only fills in callables that
  refactor declared.
- ❌ **No persistence of UDS sockets across processes.** Sockets are
  ephemeral, tied to PID; cleanup at exit + at next boot's retention
  sweep.
- ❌ **No sandbox isolation primitives.** Sibling spec B owns sandbox
  policy (seccomp/AppArmor/firejail). Spec A's child processes
  inherit the parent's UID/GID and cwd.
- ❌ **Re-spec of ink-ui-explorer.** That design is locked in
  `2026-05-02-ink-ui-explorer-design.md`. M8 here is the *Nuka-side*
  implementation milestone only.

---

## 4. High-level architecture

```
                    ┌────────────── Nuka REPL (cli.tsx) ──────────────┐
                    │                                                  │
   user input ───►  │   App.tsx ── slash dispatch ──┐                  │
                    │                               │                  │
                    │   /teams ──► TeamRegistry.list()                │
                    │   /sessions ─► SessionManager.listPersisted()    │
                    │   /triage ──► HarnessStateMachine.start()        │
                    │       │                       │                  │
                    │       ▼                       ▼                  │
                    │   ┌─────────────────────────────────────────┐    │
                    │   │  CallableHub (NEW — §6.0)               │    │
                    │   │  runFork(prompt) → { text }             │    │
                    │   │  runResearcher(query) → string          │    │
                    │   │  askUser(q) → string                    │    │
                    │   │  All three reuse the parent session's   │    │
                    │   │  prompt cache via runForkedAgent.       │    │
                    │   └─────────────┬───────────────────────────┘    │
                    │                 │ inject into harness deps       │
                    │                 ▼                                │
                    │   HarnessStateMachine (existing, unchanged)      │
                    │   primitives.ts (existing, unchanged)            │
                    │                                                  │
                    │   ┌─────────────────────────────────────────┐    │
                    │   │ Idle → AwaySummaryCard                  │    │
                    │   │  (fired on --resume boot AND on idle    │    │
                    │   │  return mid-session — phase14c)         │    │
                    │   └─────────────────────────────────────────┘    │
                    └──────────────────────────────────────────────────┘

   Tasks layer (unchanged shape, runners filled in):

                    ┌──────────── TaskManager.enqueue ────────────────┐
                    │  pickRunner(spec) ─► switch(spec.kind):         │
                    │    local_bash         → runBash       (existing)│
                    │    local_agent        → runAgent      (existing)│
                    │    in_process_teammate→ runTeammate   (phase14a)│
                    │    local_shell        → runShell      (NEW §6.4)│
                    │    remote_agent       → runRemoteAgent(NEW §6.6)│
                    │    dream              → runDream      (phase14c)│
                    └──────────────┬──────────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────────────────┐
                    │  Messaging                                       │
                    │  MessageRouter (existing) + backends:           │
                    │    InProcessBackend (existing)                  │
                    │    UdsBackend       (NEW §6.5 — was no-op)      │
                    │  ~/.nuka/sockets/<sessionId>/<agent>.sock       │
                    └────────────────┬────────────────────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────────────────────┐
                    │  Remote agent child process (Node)              │
                    │    bin/nuka-remote-runner.js (NEW §6.6)         │
                    │    speaks UDS line-delimited JSON envelopes     │
                    │    runs minimal AgentLoop without Ink           │
                    └─────────────────────────────────────────────────┘

   Test-plan harness:

                    ┌─────────────────────────────────────────────────┐
                    │  src/tui/testing/harness.ts                     │
                    │    + waitForFrameContaining(text, opts)         │
                    │    + flushPendingState()                         │
                    │    test-plans 03/05/06 use it; degraded notes  │
                    │    deleted.                                     │
                    └─────────────────────────────────────────────────┘
```

**Architectural invariants:**

- All three new callables (`runFork`, `runResearcher`, `askUser`) live
  in **one** module (`src/core/agent/callableHub.ts`) so cli.tsx
  imports a single value, not three. Eliminates the "three drift"
  failure mode where one gets refactored and the others don't.
- All cross-process traffic between Nuka and `run-remote-agent`
  children flows through `MessageRouter` — never `process.send` and
  never raw socket reads outside `UdsBackend`. Foundation invariant
  preserved.
- Shell tasks emit `task.progress` snapshots through
  `TaskManager.setProgress` — same path as `in_process_teammate`. No
  new event topic needed.
- `/sessions` opens the **same** `session-picker` submenu as `/resume`;
  the difference is a `mode: 'browse' | 'resume'` flag on the
  descriptor. Adding two slashes that share a submenu is deliberate —
  cheaper than a second submenu.
- AwaySummaryCard on `--resume` is rendered through the existing
  reducer slot (`appState.awayCard`) — no new state field, no new
  reducer action.

---

## 5. Data schemas

Spec A is mostly *behavioral* — schemas are deltas to existing types.

### 5.1 `LocalShellSpec` extension (additive)

The existing arm in `src/core/tasks/types.ts`:

```ts
export type LocalShellSpec = {
  kind: 'local_shell'
  description: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  pty: boolean
}
```

Spec A adds two **optional** fields, no rename:

```ts
export type LocalShellSpec = {
  kind: 'local_shell'
  description: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  pty: boolean

  // NEW — Spec A §6.4
  /** Initial PTY size; defaults to {cols:80,rows:24}. */
  pty_size?: { cols: number; rows: number }
  /** Cap on captured output bytes for the zoomed view. Default 1 MiB; older bytes dropped. */
  outputCapBytes?: number
}
```

### 5.2 `RemoteAgentSpec` transport extension (additive)

The existing arm:

```ts
export type RemoteAgentSpec = {
  kind: 'remote_agent'
  description: string
  transport: { kind: string; addr: string }
  initialMessage: string
}
```

Spec A pins the `transport.kind` accepted values and adds an
`agentDef` ref so the child runner knows which agent definition to
load:

```ts
export type RemoteAgentSpec = {
  kind: 'remote_agent'
  description: string
  transport:
    | { kind: 'uds'; addr: string }       // ~/.nuka/sockets/<sess>/<name>.sock
    | { kind: 'inherit' }                 // bind to parent stdout/stderr (debug only)
  initialMessage: string

  // NEW — Spec A §6.6
  agentDefRef: string                     // e.g. "core:researcher" or "plugin:reviewer"
  /** Inherited from parent: provider id + model + thinking config. */
  providerHint: { providerId: string; model: string }
  /** Optional override; defaults to a 10-minute wall budget. */
  walltimeBudgetMs?: number
}
```

The previous `transport: { kind: string; addr: string }` signature
remains assignment-compatible (`'uds'` is a string literal). Existing
callers — none ship — are unaffected.

### 5.3 UDS socket-path scheme

```
~/.nuka/sockets/<sessionId>/<agentName>.sock
```

- `<sessionId>` is the Nuka session id (already a path-safe ULID slice).
- `<agentName>` is the qualified teammate name; for `core:editor`-spawned
  remote agents, it's `core_editor` (`:` replaced with `_`).
- Permissions: `0700` on the directory, `0600` on the socket file.
- Cleanup: removed on listener shutdown; orphans (older than 24h with
  no listener) are unlinked by the foundation retention sweep
  (foundation §5.7) — added to its filter list this phase.

### 5.4 Wire format (UDS)

Length-prefixed line-delimited JSON. Each frame:

```
<32-bit big-endian length><JSON bytes><'\n'>
```

JSON body is the `MessageEnvelope` schema from foundation §5.3
(unchanged). Length prefix lets the reader allocate before the JSON
body lands; the trailing `\n` is purely a sanity sentinel (reader
errors if missing).

**Why not just `\n`-delimited JSON?** A `MessageEnvelope.message`
of type `string` may legally contain `\n`. The 4-byte length
prefix avoids escape rules.

### 5.5 Slash command descriptor for `/teams` and `/sessions`

```ts
// /teams — new
export const TeamsCommand: SlashCommand = {
  name: 'teams',
  description: 'List teams from TeamRegistry; Enter to inspect roster.',
  source: 'builtin',
  usage: '/teams [<team-name>]',
  examples: ['/teams', '/teams my-feature'],
  run: async (args, ctx) => { /* §6.7 */ },
}

// /sessions — new
export const SessionsCommand: SlashCommand = {
  name: 'sessions',
  description: 'Browse and resume prior sessions.',
  source: 'builtin',
  usage: '/sessions',
  examples: ['/sessions'],
  run: async () => ({ type: 'dialog', dialog: { kind: 'session-picker', mode: 'browse' } }),
}
```

`SubmenuDescriptor` `'session-picker'` gains an optional
`mode?: 'browse' | 'resume'` field. Default (when `/resume` opens it)
remains `'resume'`. `'browse'` mode adds: don't auto-close on
selection; show a preview pane with metadata (cwd, last message,
turn count); explicit `[Resume]` button to confirm.

### 5.6 AwaySummaryCard launch-mode field

The existing card type (phase14c §5.3) stays:

```ts
type AwaySummaryCard = {
  generatedAt: number
  text: string
  inputTokensUsed: number
  modelUsed: string

  // NEW — Spec A §6.8: distinguishes "you stepped away mid-session"
  // from "you resumed an old session". UI may render the icon/title
  // differently; the body text generation is the same fork prompt.
  trigger: 'mid-session-idle' | 'launch-resume'
}
```

---

## 6. Component contracts

### 6.0 `CallableHub` — `src/core/agent/callableHub.ts` (NEW)

Single-source-of-truth wrapper for the three primitive callables.
All three reuse the parent session's prompt cache via `runForkedAgent`
(foundation §6.6) — that's the whole point of bundling them.

```ts
import type { Session } from '../session/types'
import type { ProviderResolver } from '../provider/resolver'
import { runForkedAgent, createCacheSafeParams } from './forkedAgent'
import { resolveSmallFastModel } from '../provider/smallFastModel'
import type { ToolRegistry } from '../tools/registry'

export type CallableHub = {
  /** runFork: prompt-in / text-out. Used by /triage and any small-fast call. */
  runFork: (prompt: string, opts?: { signal?: AbortSignal; modelHint?: 'small-fast' | 'default' }) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; modelUsed: string }>
  /** runResearcher: read-only multi-search + verify. Used by search_and_verify. */
  runResearcher: (query: string, opts?: { signal?: AbortSignal; toolBudget?: number; tokenBudget?: number }) => Promise<string>
  /** askUser: TUI round-trip via PermissionChecker bridge. Used by ask_user_question. */
  askUser: (question: string, opts?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<string>
}

export function createCallableHub(deps: {
  session: () => Session
  providers: ProviderResolver
  tools: ToolRegistry
  permBridge: { ask(question: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<string> }
}): CallableHub
```

**Error semantics:**

- `runFork` propagates provider errors as `Error` with `.code` set to
  `'fork.provider'`. Network timeouts at 30s.
- `runResearcher` swallows individual tool failures (a Grep that
  errors becomes "0 hits") but rethrows session-level errors. Tool
  budget exhaustion returns the partial result with a trailing
  `\n\n[truncated: tool budget exhausted]`.
- `askUser` rejects with `Error('user did not respond within Nm')`
  on timeout (default 5 min, configurable). Aborted signals reject
  with `AbortError`.

**Cache reuse:** Each call calls `createCacheSafeParams({ parentSession: deps.session(), registry: deps.tools })`
once and reuses for the duration of the call (multiple tool
roundtrips inside `runResearcher` reuse the same `CacheSafeParams`).
Foundation §6.6 cache-key parity holds.

### 6.1 cli.tsx wiring delta — `src/cli.tsx:685-720`

Replace the three stub blocks with a single hub construction:

```ts
import { createCallableHub } from './core/agent/callableHub'
import { resolveSmallFastModel } from './core/provider/smallFastModel'

const callables = createCallableHub({
  session: () => sessions.active() ?? sessions.ensureDefault(),
  providers,
  tools,
  permBridge,
})

// Harness primitives now hit real callables, not literal strings.
if (harnessMode !== 'off') {
  tools.register(makeSequentialThinkingTool(harness) as any)
  tools.register(makeSearchAndVerifyTool(harness, { runResearcher: callables.runResearcher }) as any)
  tools.register(makeAskUserQuestionTool(harness, { askUser: callables.askUser }) as any)
}

// Slash dependencies use the same hub.
const triageDeps = { runFork: (p: string) => callables.runFork(p, { modelHint: 'small-fast' }) }
slash.register(makeHarnessCommand(harness, triageDeps))
slash.register(makeTriageCommand({ harness, ...triageDeps }))
```

The literal-string stubs (cli.tsx:699-708) are deleted.

### 6.2 `triageRunFork` real implementation (G1)

Lives inside `CallableHub.runFork`. Behaviour:

1. Resolve provider via `providers.resolveFor(session)`.
2. If `opts.modelHint === 'small-fast'`, override model via
   `resolveSmallFastModel(provider, session.model)`. Falls back to
   `session.model` if no fast variant declared.
3. Build `CacheSafeParams`, run `runForkedAgent`, return `{ text, usage, modelUsed }`.
4. On error, wrap with `Error('fork.provider: <inner.message>', { cause: inner })`.

**Why a `modelHint`?** `runResearcher` and `askUser` use the
default model (researcher needs full reasoning; askUser doesn't fork
at all). Only `runFork` from `/triage` should hit the small fast
model. The hint is also reused by spec C / D as a contract surface.

### 6.3 `runResearcher` real implementation (G2)

Inside `CallableHub.runResearcher`:

1. Build `CacheSafeParams` with `tools` filtered to `ResearcherToolset`:
   `Read | Grep | Glob | WebFetch (if configured) | WebSearch (if configured)`.
2. Construct prompt from `query`:
   ```
   System: You are a read-only research worker. Use Grep / Glob / Read to find evidence; cite file paths and line numbers. Stop when the question is answered or you have hit your tool budget.

   User: <query>
   ```
3. Run `runForkedAgent({ ...params, prompt, canUseTool: (n) => RESEARCHER_TOOLS.has(n) })`.
4. Cap iteration at `opts.toolBudget ?? 3` tool calls (enforced via
   `canUseTool` decrement counter inside `runForkedAgent` — added to
   foundation §6.6 callback semantics this phase).
5. Cap output at `opts.tokenBudget ?? 200` tokens.
6. Wall-clock budget 30s (passed via `opts.signal` from a `setTimeout`).
7. Return text. Empty result returns `"No evidence found for: <query>"`.

**Why "verify" pass?** The "search_and_verify" name promises that any
file path mentioned in the result is re-Read once before output is
returned. Implementation: scan `text` for `<path>:<line>` patterns,
issue a 50-line Read for each, append `[verified: <path>:<line>]` if
the line exists, `[stale: <path>:<line>]` if not. Adds at most 5
extra Read calls; only fires when the searcher quoted explicit paths.

### 6.4 `askUser` real implementation (G3)

Inside `CallableHub.askUser`:

1. Use the existing `permBridge.ask(question, { timeoutMs: opts.timeoutMs ?? 300_000, signal: opts.signal })`.
   `permBridge` is the PermissionChecker bridge that the App's
   permission-prompt submenu already speaks to (see cli.tsx ~line 670
   for `permBridge` construction).
2. The submenu rendered for `askUser` is a thin variant of the
   existing permission prompt: header `"Editor wants to ask:"`,
   the question, a single text input, and `[Submit] / [Skip]` buttons.
   Submit resolves with the typed answer; Skip resolves with `""`.
3. On timeout, reject with `Error('user did not respond within 5m')`.
   Caller (the `ask_user_question` tool) catches and returns
   `{ output: '...', isError: true }` — matches existing primitive
   error shape (`src/core/harness/primitives.ts:43-53`).

### 6.5 `run-shell` (PTY) — `src/core/tasks/run-shell.ts` (REWRITE) (G4)

```ts
import { spawn as ptySpawn } from 'node-pty'
import type { Task, LocalShellSpec } from './types'
import type { EventBus } from '../events/bus'
import type { ProgressTrackerSnapshot } from './progressTracker'

export type RunShellDeps = {
  bus: EventBus
  setProgress: (id: string, snapshot: ProgressTrackerSnapshot) => void
  outputAppend: (id: string, chunk: string) => void  // writes ~/.nuka/tasks/<id>.log
}

export async function runShell(task: Task, signal: AbortSignal, deps: RunShellDeps): Promise<void> {
  const spec = task.spec as LocalShellSpec
  if (!spec.pty) {
    // Non-PTY mode: defer to runBash (already exists). PTY mode is
    // the new functionality.
    return runBashFallback(task, signal, deps)
  }
  const term = ptySpawn(spec.command, spec.args ?? [], {
    name: 'xterm-256color',
    cols: spec.pty_size?.cols ?? 80,
    rows: spec.pty_size?.rows ?? 24,
    cwd: spec.cwd ?? process.cwd(),
    env: { ...process.env, ...(spec.env ?? {}) },
  })
  const cap = spec.outputCapBytes ?? 1_048_576
  let bufBytes = 0
  let lastSummary = ''

  term.onData((chunk: string) => {
    bufBytes += Buffer.byteLength(chunk, 'utf8')
    deps.outputAppend(task.id, chunk)
    if (bufBytes > cap) bufBytes = cap   // log writer handles eviction
    lastSummary = chunk.length > 200 ? chunk.slice(-200) : (lastSummary + chunk).slice(-200)
    deps.setProgress(task.id, {
      toolUseCount: 0,
      latestInputTokens: 0,
      cumulativeOutputTokens: bufBytes,
      recentActivities: [],
      summary: lastSummary.replace(/\s+/g, ' ').trim().slice(0, 60),
    })
  })

  // Shutdown protocol — foundation §6.1 requestShutdown flow.
  signal.addEventListener('abort', () => {
    term.kill('SIGTERM')
    setTimeout(() => term.kill('SIGKILL'), 30_000).unref()
  })

  return new Promise<void>((resolve, reject) => {
    term.onExit(({ exitCode, signal: sig }) => {
      task.exitCode = exitCode
      if (exitCode === 0) resolve()
      else reject(new Error(`shell exited ${exitCode}${sig ? ' signal=' + sig : ''}`))
    })
  })
}
```

**Invariants:**

- `node-pty` is added as a dependency (already a transitive dep of
  some plugin samples; promote to direct).
- Output is appended to `~/.nuka/tasks/<id>.log` via the existing
  `outputAppend` helper (no new file format).
- The Backgrounds-column zoomed view (phase14b §6.1) reads from
  `task.outputFile` — no new render surface.
- Shutdown: on `signal.aborted`, send SIGTERM, schedule SIGKILL at
  +30s. Matches foundation §6.1 `requestShutdown`.

**Error messages:**

- `node-pty` not installed → `Error('run-shell: node-pty not installed; npm install node-pty')`.
- spawn failure → `Error('run-shell: cannot spawn <command>: <inner>')`.
- output cap exceeded → no error, oldest bytes are dropped from the
  `~/.nuka/tasks/<id>.log` (rotated by `taskOutputPath`).

### 6.6 `run-remote-agent` — `src/core/tasks/run-remote-agent.ts` (REWRITE) (G6)

```ts
import { spawn } from 'node:child_process'
import * as path from 'node:path'
import type { Task, RemoteAgentSpec } from './types'
import type { MessageRouter } from '../messaging/router'
import type { UdsBackend } from '../messaging/udsBackend'

export type RunRemoteAgentDeps = {
  router: MessageRouter
  udsBackend: UdsBackend
  binPath: string                  // path to bin/nuka-remote-runner.js
  homeDir: string
}

export async function runRemoteAgent(task: Task, signal: AbortSignal, deps: RunRemoteAgentDeps): Promise<void> {
  const spec = task.spec as RemoteAgentSpec
  if (spec.transport.kind !== 'uds') {
    throw new Error(`run-remote-agent: unsupported transport ${spec.transport.kind}`)
  }
  const sockPath = spec.transport.addr  // already filled by caller
  await deps.udsBackend.bindListener(sockPath)

  const child = spawn('node', [
    deps.binPath,
    '--socket', sockPath,
    '--agent-def', spec.agentDefRef,
    '--provider', spec.providerHint.providerId,
    '--model', spec.providerHint.model,
  ], {
    cwd: deps.homeDir,
    env: { ...process.env, NUKA_REMOTE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  child.stdout?.on('data', d => process.stderr.write('[remote-out] ' + d))
  child.stderr?.on('data', d => process.stderr.write('[remote-err] ' + d))

  const wallBudget = spec.walltimeBudgetMs ?? 600_000
  const wallTimer = setTimeout(() => child.kill('SIGTERM'), wallBudget).unref()
  signal.addEventListener('abort', () => child.kill('SIGTERM'))

  // Hand off the initial message: send via router after the child has
  // accepted the socket connection (UdsBackend's accept loop calls back).
  await new Promise<void>((resolve, reject) => {
    const off = deps.udsBackend.subscribe(sockPath, async _e => {
      // First inbound = "ready" ping from child runner.
      await deps.router.send({
        id: 'init-' + task.id,
        from: 'parent',
        to: sockPath,
        summary: 'initial message',
        message: spec.initialMessage,
        sentAt: Date.now(),
      })
      off()
      resolve()
    })
    setTimeout(() => reject(new Error('remote child did not connect within 10s')), 10_000)
  })

  return new Promise<void>((resolve, reject) => {
    child.on('exit', (code, sig) => {
      clearTimeout(wallTimer)
      if (code === 0) resolve()
      else reject(new Error(`remote-agent exit code=${code} sig=${sig}`))
    })
  })
}
```

**`bin/nuka-remote-runner.js` (NEW)** — a small Node entrypoint that:
1. Connects to the UDS socket given by `--socket`.
2. Loads the agent definition by ref via the existing `AgentRegistry`.
3. Speaks length-prefixed JSON `MessageEnvelope`s.
4. Runs a minimal `AgentLoop` (no Ink) until: (a) shutdown_request
   envelope, (b) parent disconnects, (c) wall budget elapses.

**Error messages:**

- bin not found → `Error('run-remote-agent: bin/nuka-remote-runner.js not found at ' + binPath)`.
- child connect timeout → `Error('remote child did not connect within 10s')`.
- child crash → `Error('remote-agent exit code=<n> sig=<s>')`.

### 6.7 `UdsBackend` real implementation — `src/core/messaging/udsBackend.ts` (REWRITE) (G5)

```ts
import * as net from 'node:net'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { MessageBackend } from './inProcessBackend'
import type { MessageEnvelope } from './types'

export class UdsBackend implements MessageBackend {
  readonly kind = 'uds' as const

  // localAddress (sockPath) → live server, accept-loop subscribers, and
  // outbound client cache.
  private readonly servers = new Map<string, net.Server>()
  private readonly clients = new Map<string, net.Socket>()
  private readonly subs = new Map<string, Set<(e: MessageEnvelope) => void>>()
  private readonly queue = new Map<string, MessageEnvelope[]>()

  /** Create + listen on the socket. Used by run-remote-agent before spawning child. */
  async bindListener(sockPath: string): Promise<void> {
    fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 })
    if (fs.existsSync(sockPath)) fs.unlinkSync(sockPath)
    const server = net.createServer(s => this.handleConn(sockPath, s))
    await new Promise<void>((res, rej) => server.listen(sockPath, res).on('error', rej))
    fs.chmodSync(sockPath, 0o600)
    this.servers.set(sockPath, server)
  }

  async send(env: MessageEnvelope): Promise<boolean> {
    const sockPath = env.to
    if (!sockPath.startsWith('/') && !sockPath.startsWith('~')) return false
    let s = this.clients.get(sockPath)
    if (!s || s.destroyed) {
      s = await this.dial(sockPath)
      if (!s) return false
      this.clients.set(sockPath, s)
    }
    return this.writeFrame(s, env)
  }

  subscribe(localAddress: string, cb: (e: MessageEnvelope) => void): () => void {
    let set = this.subs.get(localAddress)
    if (!set) { set = new Set(); this.subs.set(localAddress, set) }
    set.add(cb)
    // Flush queued envelopes.
    const q = this.queue.get(localAddress)
    if (q) { for (const e of q) try { cb(e) } catch {} ; this.queue.delete(localAddress) }
    return () => {
      set!.delete(cb)
      if (set!.size === 0) this.subs.delete(localAddress)
    }
  }

  pending(localAddress: string): number { return this.queue.get(localAddress)?.length ?? 0 }
  drain(localAddress: string): MessageEnvelope[] {
    const q = this.queue.get(localAddress) ?? []
    this.queue.delete(localAddress)
    return q
  }

  /** Tear down on shutdown — unlinks every socket file we own. */
  closeAll(): void {
    for (const [p, srv] of this.servers) { srv.close(); try { fs.unlinkSync(p) } catch {} }
    for (const s of this.clients.values()) s.destroy()
    this.servers.clear(); this.clients.clear()
  }

  private handleConn(sockPath: string, socket: net.Socket): void {
    let buf = Buffer.alloc(0)
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0)
        if (buf.length < 4 + len + 1) break
        const json = buf.subarray(4, 4 + len).toString('utf8')
        buf = buf.subarray(4 + len + 1)
        let env: MessageEnvelope
        try { env = JSON.parse(json) } catch { continue }
        const handlers = this.subs.get(sockPath)
        if (handlers && handlers.size > 0) for (const h of handlers) try { h(env) } catch {}
        else { let q = this.queue.get(sockPath); if (!q) { q = []; this.queue.set(sockPath, q) } ; q.push(env) }
      }
    })
  }

  private async dial(sockPath: string, attempts = 3): Promise<net.Socket | null> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await new Promise<net.Socket>((res, rej) => {
          const s = net.createConnection(sockPath, () => res(s)).on('error', rej)
        })
      } catch {
        await new Promise(r => setTimeout(r, 100 * (i + 1)))
      }
    }
    return null
  }

  private writeFrame(s: net.Socket, env: MessageEnvelope): boolean {
    const json = Buffer.from(JSON.stringify(env), 'utf8')
    const len = Buffer.alloc(4); len.writeUInt32BE(json.length, 0)
    return s.write(Buffer.concat([len, json, Buffer.from('\n')]))
  }
}
```

**Error semantics:**

- `bindListener` fails → propagates `EADDRINUSE` / `EACCES` as-is.
- `send` to unknown path → returns `false`, MessageRouter falls through
  to next backend.
- Subscriber callback throws → swallowed (matches `InProcessBackend`).
- Child holds the socket open after parent's `closeAll` → child's
  next write fails; child interprets as "parent shut down" and exits.

### 6.8 Slash text-output reliability — `src/tui/testing/harness.ts` (EXTEND) (G7)

The current harness exposes `frames(): string[]` and various
`assert.contains(text)` helpers. The race is: slash dispatch's
`appendMessage` triggers a React state update; the next `frames()` call
runs synchronously before React's reconciler flushes. Spec A adds:

```ts
export type WaitForFrameOpts = {
  timeoutMs?: number          // default 1000
  pollIntervalMs?: number     // default 16  (one Ink redraw tick)
}

export async function waitForFrameContaining(
  text: string,
  opts?: WaitForFrameOpts,
): Promise<{ frame: string; iterations: number }>

export async function flushPendingState(): Promise<void>
```

`waitForFrameContaining` polls `frames()` until either the most recent
frame contains `text` (resolve) or the timeout elapses (reject with
`Error('waitForFrameContaining timeout: <text>')`). `flushPendingState`
awaits two `setImmediate` and one `Promise.resolve()` (matches Ink's
internal microtask flush order).

**YAML test-plan step**:

```yaml
- waitFor: { contains: 'help', timeoutMs: 1000 }
```

The runner translates `waitFor` to `waitForFrameContaining`. Existing
`wait: { ms: 50 }` step continues to work for time-based waits.

`test-plans/06-slash-text-output.yaml` is rewritten to:

```yaml
steps:
  - render: app
  - keystroke: '/help'
  - waitFor: { contains: '/help', timeoutMs: 500 }
  - keystroke: "\r"
  - waitFor: { contains: 'help', timeoutMs: 1500 }
  - assert: { contains: '/help' }
  - assert: { contains: 'help' }
```

Test-plans 03 and 05 lose their "DOWNGRADE NOTE" comments and gain
equivalent `waitFor` steps for the slash-text path.

### 6.9 Recap auto-surface on `--resume` — `src/cli.tsx` boot patch (G8)

Cli boot path detects `--resume <id>` (existing flag handling). After
session load + before `render(<App ... />)`, fire:

```ts
import { generateAwaySummary } from './core/recap/awaySummary'

if (resumeArg && session.messages.length > 0) {
  try {
    const card = await generateAwaySummary({
      messages: session.messages,
      signal: AbortSignal.timeout(15_000),
      runFork: callables.runFork,
    })
    appState.awayCard = {
      generatedAt: Date.now(),
      text: card.text,
      inputTokensUsed: card.tokensUsed,
      modelUsed: card.modelUsed,
      trigger: 'launch-resume',          // §5.6
    }
  } catch {
    /* swallow — failing to generate a card is never fatal */
  }
}
```

App.tsx renders `appState.awayCard` as the **first** entry in the
conversation zone (above the Welcome hero, below the borderline). Card
component is `src/tui/Recap/AwaySummaryCard.tsx` (already specced
phase14c §6.3); only its props gain the `trigger` field for icon
selection.

**Error semantics:** Any error in card generation is swallowed silently.
The card is a hint, not a contract — failing to render it leaves the
session usable.

### 6.10 `/teams` slash — `src/slash/teams.ts` (NEW) (G9)

```ts
import type { SlashCommand, SlashContext, SlashResult } from './types'
import type { TeamRegistry } from '../core/teams/registry'

export type TeamsSlashDeps = { teams: TeamRegistry }

export function makeTeamsCommand(deps: TeamsSlashDeps): SlashCommand {
  return {
    name: 'teams',
    description: 'List teams; pass a name to inspect roster.',
    source: 'builtin',
    usage: '/teams [<team-name>]',
    examples: ['/teams', '/teams my-feature'],
    run: async (args: string, _ctx: SlashContext): Promise<SlashResult> => {
      const name = args.trim()
      if (!name) {
        const all = deps.teams.list()
        if (all.length === 0) return { type: 'text', text: '(no teams configured — see /teams help)' }
        const lines = all.map(t => `- ${t.name}: ${t.members.length} member(s) · ${t.description}`)
        return { type: 'text', text: `Teams (${all.length}):\n${lines.join('\n')}` }
      }
      const t = deps.teams.find(name)
      if (!t) return { type: 'text', text: `team not found: ${name}` }
      const lines = t.members.map(m => `- ${m.agentName} (def=${m.agentDefRef}, taskId=${m.taskId ?? '—'}, since=${new Date(m.spawnedAt).toISOString()})`)
      return { type: 'text', text: `Team: ${t.name}\nDescription: ${t.description}\nTaskList: ${t.taskListId}\nMembers (${t.members.length}):\n${lines.join('\n') || '  (empty)'}` }
    },
  }
}
```

Registered at cli boot:

```ts
slash.register(makeTeamsCommand({ teams: teamRegistry }))
```

`teamRegistry` is the existing `TeamRegistry` instance (foundation
§6.4). No new state.

### 6.11 `/sessions` slash — `src/slash/sessions.ts` (NEW) (G10)

```ts
import type { SlashCommand } from './types'

export const SessionsCommand: SlashCommand = {
  name: 'sessions',
  description: 'Browse and resume prior sessions.',
  source: 'builtin',
  usage: '/sessions',
  examples: ['/sessions'],
  run: async () => ({ type: 'dialog', dialog: { kind: 'session-picker', mode: 'browse' } }),
}
```

App.tsx's session-picker submenu honors `mode: 'browse'`:
- Don't auto-resume on Enter; instead, expand a metadata pane with
  cwd, last 3 messages, turn count, last-modified time.
- Add a `[Resume]` button that triggers the resume effect.
- `Esc` closes without action (existing behaviour).

Existing `/resume` keeps `mode: 'resume'` (default), which keeps its
current "Enter resumes immediately" behaviour.

### 6.12 ink-ui-explorer Nuka integration — M8 (G11)

This subsection only catalogues Nuka's deliverables; the explorer
itself is specced in `2026-05-02-ink-ui-explorer-design.md`.

**Files added by Nuka:**

```
test/ui-auto/
  fixtures/
    Welcome.fixtures.tsx
    PromptInput.fixtures.tsx
    StatusPanel.fixtures.tsx
    SlashCard.fixtures.tsx
    Settings.fixtures.tsx
    Messages.fixtures.tsx
    Tasks.fixtures.tsx
    HarnessSubmenu.fixtures.tsx
    regression/                 (auto-populated by L4 repair)
.gitignore                      (append `/.ink-explorer/`)
```

**Nuka does not vendor the explorer runner** — it lives at
`~/.claude/skills/ink-ui-explorer/` per that spec's §3.2. Nuka's CI
adds one job that runs `ink-ui-explorer sweep` against `test/ui-auto/`
on each PR, falling back to "skipped" if the skill is not installed
(no hard dependency).

---

## 7. Testing strategy

Each goal G1..G11 has a unit + integration entry below. The
verification milestone (§8 M9) re-runs all named test plans.

### 7.1 G1 — runFork (unit + integration)

| Test | File | Coverage |
|------|------|----------|
| unit | `test/core/agent/callableHub.runFork.test.ts` | small-fast hint resolves to fast model when configured; falls back to default when not; provider error wraps with `code: 'fork.provider'`; AbortSignal propagates |
| integration | `test/integration/triage-runfork.test.ts` | `/triage` slash run end-to-end with msw provider mock; harness state machine receives parsed JSON triage |

### 7.2 G2 — runResearcher (unit + integration)

| Test | File | Coverage |
|------|------|----------|
| unit | `test/core/agent/callableHub.runResearcher.test.ts` | tool budget exhaustion appends `[truncated]`; tool denial via `canUseTool`; verify pass marks `[verified]` / `[stale]` |
| integration | `test/integration/search-and-verify.test.ts` | `search_and_verify` tool returns real Grep/Read evidence; harness records `searchAndVerify` primitive |

### 7.3 G3 — askUser (unit + integration)

| Test | File | Coverage |
|------|------|----------|
| unit | `test/core/agent/callableHub.askUser.test.ts` | resolves with typed answer; rejects on timeout; AbortSignal cancels |
| integration | `test/integration/ask-user-question.test.ts` (ink-testing-library) | submenu renders; Submit button fires; harness records `askUser` primitive |

### 7.4 G4 — run-shell PTY (unit + integration)

| Test | File | Coverage |
|------|------|----------|
| unit | `test/core/tasks/run-shell.test.ts` | spawn echo command captures output; SIGTERM on signal abort; SIGKILL on +30s; output cap rotates log |
| integration | `test/integration/run-shell-zoom.test.ts` | LocalShellSpec → Backgrounds column row; Enter opens zoomed view showing latest output; task.progress events fire |

Skip-on-CI gate: tests use `process.platform !== 'win32'` guard
(node-pty windows builds are flaky in CI).

### 7.5 G5 — UdsBackend (unit + integration)

| Test | File | Coverage |
|------|------|----------|
| unit | `test/core/messaging/udsBackend.test.ts` | bindListener creates `0700` dir + `0600` socket; send/subscribe round-trip; queue when no subscriber; closeAll unlinks |
| unit | `test/core/messaging/udsBackend.framing.test.ts` | length-prefix framing parses split TCP chunks correctly; malformed JSON dropped without crash |
| integration | `test/integration/uds-router.test.ts` | UdsBackend registered into MessageRouter; `to: '/tmp/...sock'` routes through UDS; in-process traffic still hits InProcessBackend |

### 7.6 G6 — run-remote-agent (integration)

| Test | File | Coverage |
|------|------|----------|
| integration | `test/integration/run-remote-agent.test.ts` | spawn `nuka-remote-runner.js` against an msw-stubbed provider; receive initialMessage envelope; child responds; parent observes `task.state → completed`; wall budget kills child |

CI-only: marked `slow` (10s timeout).

### 7.7 G7 — slash-text reliability (test-plan resurrection)

Pass/fail criterion: each of the three test plans (03, 05, 06) runs
deterministically across **3 consecutive headless invocations** without
skipped or downgraded assertions.

| Plan | Updated step | Asserts |
|------|--------------|---------|
| `06-slash-text-output.yaml` | `waitFor: { contains: 'help', timeoutMs: 1500 }` | `contains: '/help'`, `contains: 'help'` |
| `03-theme-switch.yaml` | `waitFor: { contains: 'Theme', timeoutMs: 1500 }` | `contains: 'Theme'`, `contains: 'switched'` |
| `05-plan-mode-lockout.yaml` | `waitFor: { contains: 'Plan mode', timeoutMs: 1500 }` | `contains: 'Plan mode ON'` |

DOWNGRADE NOTE comments in those YAMLs are deleted.

### 7.8 G8 — recap auto-surface (integration)

| Test | File | Coverage |
|------|------|----------|
| integration | `test/integration/recap-resume-card.test.ts` | spawn nuka with `--resume <id>` against fixture session; assert AwaySummaryCard rendered with `trigger='launch-resume'` |
| unit | `test/core/recap/launchCard.test.ts` | empty session → no card; <30 messages → still fires; provider error swallowed |

### 7.9 G9 / G10 — `/teams` and `/sessions` slashes

| Test | File | Coverage |
|------|------|----------|
| unit | `test/slash/teams.test.ts` | empty registry → `(no teams configured)`; with team → list lines; bare `/teams <name>` → roster |
| unit | `test/slash/sessions.test.ts` | returns dialog with `mode: 'browse'` |
| integration | `test/integration/sessions-browse.test.ts` (ink-testing-library) | session-picker browse mode shows preview pane; Resume button triggers effect |

### 7.10 G11 — ink-ui-explorer integration

| Test | File | Coverage |
|------|------|----------|
| smoke | `test/ui-auto/fixtures/Welcome.fixtures.tsx` (and 7 siblings) | renders without throwing in a vitest "smoke" suite (compile gate only) |
| CI script | `.github/workflows/ink-ui-explorer.yml` | runs `ink-ui-explorer sweep test/ui-auto/fixtures/**`; fails build on new failure dump unless skill is absent (skipped in that case) |

### 7.11 Test-plan re-run matrix (M9)

```
test-plans/01-offline-boot.yaml          existing — must stay green
test-plans/02-onboarding.yaml            existing — must stay green
test-plans/03-theme-switch.yaml          updated — must turn green (was degraded)
test-plans/04-stats-view.yaml            existing — must stay green
test-plans/05-plan-mode-lockout.yaml     updated — must turn green (was degraded)
test-plans/06-slash-text-output.yaml     updated — must turn green (was flaky)
test-plans/08-example-plugin.yaml        existing — must stay green
```

Verification command:

```bash
for f in test-plans/*.yaml; do
  for i in 1 2 3; do
    nuka --test-plan "$f" --reporter=tap || exit 1
  done
done
```

CI gate at M9: `npm run typecheck && npm test && npm run test:plans` — all
green on three consecutive runs.

---

## 8. Milestones

Each milestone is one PR. M1..M3 are independent and may land in any
order. M4 depends on M5 (UdsBackend interface) only at the
runtime-link level (the rewrite touches both files but they ship
together). M6 depends on M5. M7 depends on M1..M3 (callable hub +
`/teams`+`/sessions` routes through it). M8 depends on M7 (uses the
flush hook).

| M | Subject | Deliverable | Depends on | Acceptance |
|---|---------|-------------|------------|------------|
| **M1** | CallableHub `runFork` (G1) | `src/core/agent/callableHub.ts`, `src/core/provider/smallFastModel.ts` resolver, cli.tsx wiring delta | foundation §6.6 | unit + integration tests green; `/triage` no longer prints `(stub triage fork response)` |
| **M2** | CallableHub `runResearcher` (G2) | extend hub, `RESEARCHER_TOOLS` constant, verify-pass logic | M1 (shared hub file) | unit + integration tests green; `search_and_verify` returns real evidence |
| **M3** | CallableHub `askUser` (G3) | extend hub, `permBridge.ask` extension if needed, ask-user submenu component | M1 | unit + integration tests green; `ask_user_question` round-trips through TUI |
| **M4** | run-shell PTY (G4) | `src/core/tasks/run-shell.ts` rewrite, `node-pty` direct dep, Backgrounds zoomed-view smoke test | foundation §6.1 + phase14b §6.1 | shell tasks run; SIGTERM on abort; output cap |
| **M5** | UdsBackend (G5) | `src/core/messaging/udsBackend.ts` rewrite, `bindListener` API, length-prefix framing | foundation §6.3 | unit framing tests + integration round-trip green |
| **M6** | run-remote-agent (G6) | `src/core/tasks/run-remote-agent.ts` rewrite, `bin/nuka-remote-runner.js` new entrypoint, RemoteAgentSpec field additions | M5 | child spawns, receives initialMessage, walltime kill works |
| **M7** | Slash text reliability + Recap on resume + `/teams` + `/sessions` (G7-G10) | `src/tui/testing/harness.ts` extension, `src/cli.tsx` resume hook, `src/slash/teams.ts`, `src/slash/sessions.ts`, AwaySummaryCard `trigger` field, test-plans 03/05/06 rewrite | M1 | three flaky test plans turn deterministically green ×3 runs |
| **M8** | ink-ui-explorer integration (G11) | `test/ui-auto/fixtures/*.fixtures.tsx` (8 files), `.gitignore` append, optional CI workflow | `2026-05-02-ink-ui-explorer-design.md` M1..M2 | sweep against fixtures runs; produces zero new dumps OR all dumps repaired+promoted |
| **M9** | Verification + bundle audit | run all 7 test plans ×3, `npm run typecheck`, `npm test`, bundle size measurement | M1..M8 | bundle ≤ 540 KB (README current ~376 KB; allowance for `node-pty` native footprint, `bin/nuka-remote-runner.js`, plus 12 new unit/integration test fixtures); zero TS errors; all tests green |

**Dependency DAG:**

```
              foundation §6 + phase14a-d (already shipped)
                        │
                ┌───────┴───────┐
                │               │
               M1              M5
              (hub.runFork)   (UdsBackend)
                │               │
        ┌───────┼─────┐        M6
        │       │     │       (run-remote-agent)
       M2      M3    M4
   (researcher)(ask)(shell)
                │
               M7 (slash + resume + teams + sessions)
                │
               M8 (ink-ui-explorer fixtures)
                │
               M9 (verify)
```

---

## 9. Risks & rollbacks

| Risk | Likelihood | Mitigation | Rollback |
|------|------------|------------|----------|
| `node-pty` native build fails on user's machine | Medium | Lazy import inside `runShell`; if import fails, return a typed error and fall back to `runBash` (non-PTY). README adds a "PTY tasks require `npm rebuild node-pty`" note. | Revert M4; remove from `package.json`; `LocalShellSpec` users get the existing throw |
| UDS path length exceeds OS cap (104 chars on macOS, 108 on Linux) | High in long sessionIds | Truncate `<sessionId>` to first 8 chars (matches Task id slice) and `<agentName>` to 32 chars; total path ≤ 80 + home dir | Switch to `/tmp/nuka-<short-hash>.sock` (less inspectable, but fits) |
| Child remote-agent process leaks on parent crash | High | `detached: false` ties child lifecycle to parent group; foundation retention sweep unlinks orphan sockets older than 24h; explicit `closeAll()` in cli's `onExit` handler | Manual `pkill -f nuka-remote-runner`; sockets cleaned next boot |
| `runResearcher` tool budget too tight for real codebases | Medium | Default 3 calls + 200 tokens matches "fast pass"; harness state machine triggers a second pass via `search_and_verify` re-call when first comes back empty | Per-call override via `opts.toolBudget` / `opts.tokenBudget`; revisit budget in v2 |
| `askUser` 5-min timeout too short for AFK users | Medium | Configurable per-call; default 5m matches phase14d §9 risk row; `(user did not respond)` is a recoverable answer (editor just continues) | Bump to 30m via config; or set timeout to `Infinity` for non-interactive runs |
| Test-plan `waitForFrameContaining` becomes a flake source itself (timeout pop) | Medium | Default 1000ms is generous (one Ink redraw is 16ms); CI runs each plan ×3 to catch flakes | Increase per-plan via `timeoutMs` field; revert to `wait: { ms: 50 }` for the offending step |
| AwaySummaryCard on resume costs tokens user didn't ask for | Low | One-time fork capped at 200 output tokens; opt-out via `~/.nuka/config.yaml` `recap.awayCard: false` (already specced phase14c) | Disable feature flag |
| `/teams` description mismatches future SaaS team meaning | Low | `/teams` is purely local TeamRegistry list; no networked team concept. Rename to `/local-teams` if SaaS arrives — sibling spec B's worktree-as-thread is the closest analog and keeps `/teams` free | n/a — local concept stable |
| `/sessions` browse mode confuses users expecting `/resume` behaviour | Low | Both slashes work; `/sessions` adds preview, `/resume` is unchanged; help text distinguishes them | Remove `/sessions` slash; keep only `/resume` |
| ink-ui-explorer surface bugs in current Nuka code that block M8 | High | Each surfaced bug becomes either an auto-promoted regression fixture (clean L4 path) or a manual fix; M8 acceptance is "explorer runs", not "zero failures" | Skip M8 — not load-bearing for M9 verification |
| Bundle size jumps past 540 KB due to `node-pty` (1MB native binary) | Medium | `node-pty` ships as native module (not bundled); bundler ignores it; runtime download via `npm install` | Drop PTY mode; revert to `runBash` for shell tasks |
| Spec drift between the four sibling specs (b/c/d/e) | Medium | Each sibling explicitly declares non-goals overlap with this spec; cross-link in §3 | Amend spec inline; bump revision header |

---

## 10. Out of scope / deferred to other specs

The following items are intentionally **not** addressed in Spec A. Each
maps to exactly one sibling spec.

### 10.1 Worktree-as-thread, `/goal`, sandbox isolation

Owned by `2026-05-02-spec-b-modernize-core-design.md`. Spec B builds
on Spec A's `run-remote-agent` (each worktree thread is a remote-agent
child) but adds:

- Worktree spawning + lifecycle.
- `/goal` slash for high-level intent capture.
- Sandbox profiles (seccomp/AppArmor/firejail) for child processes.
- Filesystem isolation (cwd + bindmount whitelist).

Spec A explicitly leaves `run-remote-agent` running with the parent's
UID/GID and inherited cwd — Spec B tightens that.

### 10.2 Cron primitive + scheduling

Owned by `2026-05-02-spec-c-cron-primitive-design.md`. Adds:

- `CronEngine` core type.
- Two new tools (`cron_create`, `cron_list`).
- `/cron` slash.
- Persistence at `~/.nuka/cron/<id>.yaml`.

Spec A's `LocalShellSpec` may be the *target* of a cron job (cron
schedules a shell task), but the scheduler engine itself is not
part of this spec.

### 10.3 Provider expansion (Gemini, Bedrock, Vertex, local)

Owned by `2026-05-02-spec-d-provider-expansion-design.md`. Adds:

- Three new provider adapters under `src/core/provider/`.
- Provider-specific `getSmallFastModel()` resolution.
- Bedrock IAM auth flow.

Spec A's `CallableHub.runFork` will pick up new providers
**transparently** when Spec D ships — no callable-hub changes required.

### 10.4 Context bloat audit + remediation

Owned by `2026-05-02-spec-e-context-audit-design.md`. Investigates and
fixes:

- Per-turn input-token growth in long sessions.
- Tool-result transcript inflation.
- Skill/system prompt accumulation.

Spec A does not change context handling. The `runResearcher` 200-token
output cap is a small mitigation; the structural fix is Spec E.

### 10.5 ink-ui-explorer skill internals

Owned by `2026-05-02-ink-ui-explorer-design.md`. Spec A's M8 is the
*Nuka-side integration* of that skill — fixtures, gitignore, optional
CI job. The skill's L0..L4 implementation, judge prompts, repair
subagent, and per-fixture invariants are entirely owned by that spec.

---

## Spec self-review checklist (run inline before commit)

- [x] No "TBD" / "TODO" / placeholder text in normative sections (§§ 1–8).
- [x] Architecture diagram (§4) shows only the wiring delta — no rework
      of foundation primitives.
- [x] Each non-goal in §3 is explicitly NOT covered by any milestone in §8.
- [x] Each goal G1..G11 in §2 maps 1:1 to a §6 contract subsection.
- [x] Each schema delta in §5 is referenced by at least one §6 contract.
- [x] §1 cites file paths + line numbers for every claim about current
      state (cli.tsx:699-708, run-shell.ts, run-remote-agent.ts,
      udsBackend.ts, App.tsx:386-396, idleWatcher.ts, awaySummary.ts,
      slash/registry.ts, test-plans/03/05/06 line refs).
- [x] Risks (§9) cover the highest-risk items (node-pty, UDS path
      length, child leaks, askUser timeouts, ink-ui-explorer M8 risk).
- [x] Sub-spec boundaries (§10) cite the exact filenames of siblings
      b/c/d/e and the ink-ui-explorer spec.
- [x] All terminology matches Phase 14 foundation: TaskKind,
      MessageEnvelope, EventBus, ProgressTrackerSnapshot,
      MessageBackend, runForkedAgent, CacheSafeParams,
      HarnessStateMachine, harness.stage.* events.
- [x] No mention of the dropped phase14d 7-class profile model — the
      three-axis refactor is the source of truth.
- [x] Bundle budget cited as `≤ 540 KB` per advisor reconcile against
      README (376 KB current).
- [x] Test-plan acceptance gate (§7.11) has a deterministic command
      and ×3 run requirement.
- [x] Cross-references to phase14 specs use exact section numbers
      (foundation §6.1, §6.6, phase14a §6.8, phase14b §6.1, phase14c
      §6.3).

---

*End of Spec A.*
