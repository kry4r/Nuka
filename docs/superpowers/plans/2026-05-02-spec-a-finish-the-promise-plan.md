# Spec A — Finish the Promise — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking. TDD ordering applies
> per Nuka harness profile (`feature` profile, `medium` difficulty,
> `tdd` strategy — fits the matrix in
> `docs/plans/2026-05-01-harness-three-axis-refactor-design.md` §7).

**Goal:** Eliminate the five stub/no-op sites identified in
`docs/superpowers/specs/2026-05-02-spec-a-finish-the-promise-design.md`
§1 and turn three "degraded" test-plans deterministically green.
Ship `/teams`, `/sessions`, and the recap-on-resume card. Stand up
`test/ui-auto/fixtures/` for the ink-ui-explorer skill.

**Architecture:** Nine milestones (M1..M9). M1..M3 land the
`CallableHub` (the single point that fixes the harness primitive
stubs at cli.tsx:699-708). M4 lands PTY shell tasks. M5..M6 land the
UDS transport + remote-agent runner. M7 closes the slash + recap
loose ends and rewrites the three flaky test-plans. M8 stands up
ink-ui-explorer fixtures. M9 verifies everything runs ×3.

**Tech stack:** TypeScript 5.6, Node ≥ 18, vitest 2.1, zod 4.3,
Ink 6.8 (untouched), `node-pty` (NEW direct dep), `node:net` (no new
dep — UDS), `node:child_process` (no new dep — remote-agent runner),
ink-testing-library (existing).

**Source-of-truth spec:**
`docs/superpowers/specs/2026-05-02-spec-a-finish-the-promise-design.md`

**Sibling specs (parallel, do not modify):**
- `2026-05-02-spec-b-modernize-core-design.md`
- `2026-05-02-spec-c-cron-primitive-design.md`
- `2026-05-02-spec-d-provider-expansion-design.md`
- `2026-05-02-spec-e-context-audit-design.md`

---

## File structure

**New files (creation):**

```
src/core/agent/
  callableHub.ts                      § 6.0 — runFork / runResearcher / askUser
  callableHub.researcherTools.ts      § 6.3 — RESEARCHER_TOOLS allowlist constant
src/core/provider/
  smallFastModel.ts                   § 6.2 — resolveSmallFastModel(provider, fallbackModel)
src/slash/
  teams.ts                            § 6.10 — /teams command
  sessions.ts                         § 6.11 — /sessions command
src/tui/Recap/
  AwaySummaryCard.tsx                 § 6.9 — already specced in phase14c §6.3; impl this milestone
src/tui/testing/
  waitForFrame.ts                     § 6.8 — waitForFrameContaining + flushPendingState
bin/
  nuka-remote-runner.js               § 6.6 — child Node entrypoint for run-remote-agent

test/core/agent/
  callableHub.runFork.test.ts
  callableHub.runResearcher.test.ts
  callableHub.askUser.test.ts
test/core/messaging/
  udsBackend.test.ts
  udsBackend.framing.test.ts
test/core/tasks/
  run-shell.test.ts
test/core/recap/
  launchCard.test.ts
test/slash/
  teams.test.ts
  sessions.test.ts
test/integration/
  triage-runfork.test.ts
  search-and-verify.test.ts
  ask-user-question.test.ts
  run-shell-zoom.test.ts
  uds-router.test.ts
  run-remote-agent.test.ts
  recap-resume-card.test.ts
  sessions-browse.test.ts

test/ui-auto/fixtures/
  Welcome.fixtures.tsx
  PromptInput.fixtures.tsx
  StatusPanel.fixtures.tsx
  SlashCard.fixtures.tsx
  Settings.fixtures.tsx
  Messages.fixtures.tsx
  Tasks.fixtures.tsx
  HarnessSubmenu.fixtures.tsx
```

**Modified files:**

```
src/cli.tsx                           § 6.1 — replace stub block with createCallableHub
src/core/tasks/types.ts               § 5.1 + § 5.2 — additive fields on LocalShellSpec, RemoteAgentSpec
src/core/tasks/run-shell.ts           § 6.5 — rewrite; was throw
src/core/tasks/run-remote-agent.ts    § 6.6 — rewrite; was throw
src/core/messaging/udsBackend.ts      § 6.7 — rewrite; was no-op
src/core/messaging/router.ts          register UdsBackend in default backend list
src/core/recap/awaySummary.ts         § 5.6 — pass `trigger` field through
src/core/recap/types.ts               § 5.6 — add `trigger` field
src/tui/App.tsx                       render appState.awayCard (props.appState extension)
src/tui/Submenu/types.ts              session-picker mode field
src/slash/registry.ts                 (no change; new commands register via existing API)
src/slash/help.ts                     add /teams, /sessions to help table
.gitignore                            append `/.ink-explorer/`
package.json                          add node-pty as a dep; add `bin/nuka-remote-runner.js` to files

test-plans/03-theme-switch.yaml       drop DOWNGRADE NOTE; add waitFor steps
test-plans/05-plan-mode-lockout.yaml  drop DOWNGRADE NOTE; add waitFor steps
test-plans/06-slash-text-output.yaml  add waitFor steps; tighten asserts
```

**Naming reconciliation:** `CallableHub` is a fresh module name with no
prior occurrence in the codebase. The `runFork` / `runResearcher` /
`askUser` field names match the existing call sites in
`src/core/harness/state.ts:46-50` and
`src/core/harness/primitives.ts:20,38` exactly — no rename required at
the consumer end.

---

## Task 1: M1 — runFork (G1)

Land the `CallableHub` skeleton plus the `runFork` callable backed by
real `runForkedAgent`. ≈ 220 LOC across 4 files.

**Files:**
- Create: `src/core/agent/callableHub.ts`
- Create: `src/core/provider/smallFastModel.ts`
- Create: `test/core/agent/callableHub.runFork.test.ts`
- Create: `test/integration/triage-runfork.test.ts`
- Modify: `src/cli.tsx` (replace stub block)

### 1.1 Write the failing unit test for runFork

- [ ] **Step 1: Create `test/core/agent/callableHub.runFork.test.ts`** ≈ 60 LOC

Cover:
- `runFork('hello', { modelHint: 'small-fast' })` resolves with `{ text, usage, modelUsed }`.
- `runFork('hello', { modelHint: 'small-fast' })` calls `resolveSmallFastModel` once.
- Provider error wraps with `code: 'fork.provider'`.
- `AbortSignal.abort()` propagates as `AbortError`.

Use msw to stub the provider (existing pattern in
`test/core/agent/forkedAgent.test.ts`).

- [ ] **Step 2: Run vitest, expect failure**
```bash
npx vitest run test/core/agent/callableHub.runFork.test.ts
```
Expected: `Cannot find module '../../../src/core/agent/callableHub'`.

### 1.2 Implement `resolveSmallFastModel`

- [ ] **Step 3: Create `src/core/provider/smallFastModel.ts`** ≈ 35 LOC

```ts
import type { Provider } from './types'

/**
 * Resolve a small-fast model variant for the given provider, falling
 * back to the user's session model when no fast variant is declared.
 *
 * Decision order:
 *   1. Provider-declared `smallFastModel` field on the resolved Provider.
 *   2. Convention map for known providers (anthropic → claude-haiku-4-5).
 *   3. fallbackModel.
 */
export function resolveSmallFastModel(provider: Provider, fallbackModel: string): string {
  if ((provider as any).smallFastModel) return (provider as any).smallFastModel
  switch (provider.type) {
    case 'anthropic': return 'claude-haiku-4-5'
    case 'openai':    return 'gpt-4o-mini'
    default:          return fallbackModel
  }
}
```

- [ ] **Step 4: Run typecheck**
```bash
npm run typecheck
```
Expected: 0 errors.

### 1.3 Implement `CallableHub` (runFork only)

- [ ] **Step 5: Create `src/core/agent/callableHub.ts`** ≈ 80 LOC

Skeleton with `runFork` only. Stubs for `runResearcher` and `askUser`
that throw `Error('not implemented in M1')`. Function signature:

```ts
export function createCallableHub(deps: {
  session: () => Session
  providers: ProviderResolver
  tools: ToolRegistry
  permBridge: { ask(question: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<string> }
}): CallableHub
```

`runFork` body:

```ts
runFork: async (prompt, opts) => {
  const session = deps.session()
  const provider = deps.providers.resolveFor(session)
  const model = opts?.modelHint === 'small-fast'
    ? resolveSmallFastModel(provider, session.model)
    : session.model
  try {
    const params = createCacheSafeParams({ parentSession: session, registry: deps.tools })
    params.modelParams.model = model
    const r = await runForkedAgent({ params, prompt, signal: opts?.signal ?? AbortSignal.timeout(30_000), providerResolver: deps.providers })
    return { text: r.text, usage: r.usage, modelUsed: model }
  } catch (e) {
    const err = new Error(`fork.provider: ${(e as Error).message}`, { cause: e })
    ;(err as any).code = 'fork.provider'
    throw err
  }
},
```

- [ ] **Step 6: Re-run unit test**
```bash
npx vitest run test/core/agent/callableHub.runFork.test.ts
```
Expected: all pass.

### 1.4 Wire into cli.tsx

- [ ] **Step 7: Patch `src/cli.tsx`**

Locate lines 689-720 (the harness wiring + triageRunFork stub). Replace:

```diff
-  const triageRunFork = async (_p: string): Promise<{ text: string }> => ({
-    text: '(stub triage fork response)',
-  })
-  const triageDeps = { runFork: triageRunFork }
+  const callables = createCallableHub({
+    session: () => sessions.active() ?? sessions.ensureDefault(),
+    providers,
+    tools,
+    permBridge,
+  })
+  const triageDeps = { runFork: (p: string) => callables.runFork(p, { modelHint: 'small-fast' }).then(r => ({ text: r.text })) }
```

Add the `import { createCallableHub } from './core/agent/callableHub'`
at the top of cli.tsx.

- [ ] **Step 8: Run typecheck + smoke**
```bash
npm run typecheck && npm run build
```
Expected: 0 errors. Bundle increases by ~3 KB.

### 1.5 Integration test for `/triage`

- [ ] **Step 9: Create `test/integration/triage-runfork.test.ts`** ≈ 70 LOC

Drive the harness state machine through `triage.start` with an msw
provider mock returning a JSON triage payload. Assert:

- `harness.snapshot().triage.profile === 'feature'` (or the JSON value).
- No occurrence of the literal `(stub triage fork response)` in the log.

- [ ] **Step 10: Run tests**
```bash
npx vitest run test/integration/triage-runfork.test.ts
```
Expected: pass.

### 1.6 Acceptance criteria for M1

- [ ] `npx vitest run test/core/agent/callableHub.runFork.test.ts` passes.
- [ ] `npx vitest run test/integration/triage-runfork.test.ts` passes.
- [ ] `npm run typecheck` clean.
- [ ] cli.tsx no longer contains the literal `(stub triage fork response)`.
- [ ] `git grep "stub triage"` returns 0 hits in `src/`.

- [ ] **Step 11: Commit**
```bash
git add src/core/agent/callableHub.ts src/core/provider/smallFastModel.ts \
        src/cli.tsx test/core/agent/callableHub.runFork.test.ts \
        test/integration/triage-runfork.test.ts
git commit -m "feat(spec-a/m1): callableHub.runFork wires triage to real fork"
```

---

## Task 2: M2 — runResearcher (G2)

Extend `CallableHub` with the read-only research callable (multi-search
+ verify pass). ≈ 200 LOC.

**Files:**
- Modify: `src/core/agent/callableHub.ts`
- Create: `src/core/agent/callableHub.researcherTools.ts`
- Create: `test/core/agent/callableHub.runResearcher.test.ts`
- Create: `test/integration/search-and-verify.test.ts`
- Modify: `src/cli.tsx` (swap researcher stub)

### 2.1 RESEARCHER_TOOLS allowlist

- [ ] **Step 1: Create `src/core/agent/callableHub.researcherTools.ts`** ≈ 15 LOC

```ts
/**
 * Tool whitelist for runResearcher's CacheSafeParams `canUseTool` hook.
 * Read-only: never includes Edit, Write, Bash.
 * WebFetch/WebSearch only included when configured (callable hub checks at call time).
 */
export const RESEARCHER_BASE_TOOLS = new Set<string>(['Read', 'Grep', 'Glob'])
export const RESEARCHER_WEB_TOOLS = new Set<string>(['WebFetch', 'WebSearch'])

export function buildResearcherToolset(opts: { web: boolean }): Set<string> {
  const s = new Set(RESEARCHER_BASE_TOOLS)
  if (opts.web) for (const t of RESEARCHER_WEB_TOOLS) s.add(t)
  return s
}
```

### 2.2 Failing unit test

- [ ] **Step 2: Create `test/core/agent/callableHub.runResearcher.test.ts`** ≈ 100 LOC

Cover:
- Tool budget exhaustion (4th tool call denied) → trailing
  `[truncated: tool budget exhausted]`.
- `canUseTool` denies non-allowlisted tools.
- Verify pass: when result text contains `src/foo.ts:42`, an additional
  Read fires for that file; output gets `[verified: src/foo.ts:42]` if
  exists, `[stale: ...]` otherwise.
- Empty result → `"No evidence found for: <query>"`.

### 2.3 Implement runResearcher

- [ ] **Step 3: Replace `runResearcher` stub in `callableHub.ts`** ≈ 80 LOC

```ts
runResearcher: async (query, opts) => {
  const session = deps.session()
  const params = createCacheSafeParams({ parentSession: session, registry: deps.tools })
  const allowed = buildResearcherToolset({ web: !!session.config?.webSearch?.enabled })
  let toolBudget = opts?.toolBudget ?? 3
  const canUseTool = (n: string): boolean => {
    if (!allowed.has(n)) return false
    if (toolBudget <= 0) return false
    toolBudget--
    return true
  }
  const sysPrompt = 'You are a read-only research worker. Use Grep / Glob / Read to find evidence; cite file paths and line numbers. Stop when the question is answered or you have hit your tool budget.'
  params.systemPrompt = sysPrompt
  params.modelParams.maxTokens = opts?.tokenBudget ?? 200
  const signal = opts?.signal ?? AbortSignal.timeout(30_000)
  const r = await runForkedAgent({ params, prompt: query, signal, canUseTool, providerResolver: deps.providers })
  let text = r.text
  if (toolBudget < 0) text += '\n\n[truncated: tool budget exhausted]'
  if (!text.trim()) return `No evidence found for: ${query}`
  return await verifyCitations(text, deps)
}
```

`verifyCitations` is a small helper (≈ 40 LOC) that scans text for
`<path>:<line>` patterns, reads the file, marks each as
`[verified]` / `[stale]`. Lives in `callableHub.ts`.

- [ ] **Step 4: Run unit test**
```bash
npx vitest run test/core/agent/callableHub.runResearcher.test.ts
```
Expected: pass.

### 2.4 Wire into cli.tsx

- [ ] **Step 5: Replace researcher stub at cli.tsx:699**

```diff
-    tools.register(makeSearchAndVerifyTool(harness, { runResearcher: async (q) => `(stub) results for: ${q}` }) as any)
+    tools.register(makeSearchAndVerifyTool(harness, { runResearcher: callables.runResearcher }) as any)
```

### 2.5 Integration test

- [ ] **Step 6: Create `test/integration/search-and-verify.test.ts`** ≈ 70 LOC

Drive `search_and_verify` against a fake provider that emits a Grep
tool call returning a real codebase path. Assert:

- Result text contains real Grep evidence (not `(stub) results for: ...`).
- `harness.canExit(...)` no longer rejects with "missing primitive: search_and_verify".

- [ ] **Step 7: Run + commit**
```bash
npx vitest run test/integration/search-and-verify.test.ts
git add src/core/agent/callableHub.ts src/core/agent/callableHub.researcherTools.ts \
        src/cli.tsx test/core/agent/callableHub.runResearcher.test.ts \
        test/integration/search-and-verify.test.ts
git commit -m "feat(spec-a/m2): callableHub.runResearcher with verify pass"
```

### 2.6 Acceptance criteria for M2

- [ ] `git grep "(stub) results for"` returns 0 hits in `src/`.
- [ ] `search_and_verify` end-to-end test passes.
- [ ] Tool budget caps enforced (verified by unit test).

---

## Task 3: M3 — askUser (G3)

≈ 180 LOC.

**Files:**
- Modify: `src/core/agent/callableHub.ts`
- Create: `src/tui/Submenu/AskUserSubmenu.tsx`
- Modify: `src/tui/Submenu/types.ts` (add `'ask-user'` kind)
- Modify: `src/tui/App.tsx` (route `ask-user` submenu)
- Modify: cli.tsx
- Create: `test/core/agent/callableHub.askUser.test.ts`
- Create: `test/integration/ask-user-question.test.ts`

### 3.1 SubmenuDescriptor extension

- [ ] **Step 1: Patch `src/tui/Submenu/types.ts`** ≈ 5 LOC

```ts
export type SubmenuDescriptor =
  | …existing…
  | { kind: 'ask-user'; question: string; resolveId: string }
```

- [ ] **Step 2: Create `src/tui/Submenu/AskUserSubmenu.tsx`** ≈ 70 LOC

Renders the question, a single-line text input, `[Submit]` and `[Skip]`
buttons. On Submit, calls `props.onResolve(text)`. On Skip / Esc,
calls `props.onResolve('')`.

### 3.2 PermBridge extension

- [ ] **Step 3: Patch `permBridge.ask` (cli.tsx)** ≈ 30 LOC

The existing `permBridge` has a `requestPermission` method for
permission prompts. Add `ask(question, opts)`:

```ts
const askPending = new Map<string, { resolve: (s: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
permBridge.ask = (question: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<string> => {
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`user did not respond within ${opts.timeoutMs}ms`)), opts.timeoutMs)
    askPending.set(id, { resolve, reject, timer })
    opts.signal?.addEventListener('abort', () => { clearTimeout(timer); askPending.delete(id); reject(new DOMException('aborted', 'AbortError')) })
    dispatchUI({ type: 'open-submenu', submenu: { kind: 'ask-user', question, resolveId: id } })
  })
}
permBridge.resolveAsk = (id: string, answer: string): void => {
  const p = askPending.get(id); if (!p) return
  clearTimeout(p.timer); askPending.delete(id); p.resolve(answer)
}
```

App.tsx wires `AskUserSubmenu`'s `onResolve` to `permBridge.resolveAsk`.

### 3.3 askUser implementation

- [ ] **Step 4: Replace askUser stub in `callableHub.ts`** ≈ 15 LOC

```ts
askUser: (question, opts) => {
  return deps.permBridge.ask(question, { timeoutMs: opts?.timeoutMs ?? 300_000, signal: opts?.signal })
},
```

### 3.4 Tests

- [ ] **Step 5: `test/core/agent/callableHub.askUser.test.ts`** ≈ 60 LOC

Mock `permBridge.ask` directly. Cover: resolve, timeout, abort.

- [ ] **Step 6: `test/integration/ask-user-question.test.ts`** ≈ 90 LOC

Use ink-testing-library to render App with a fake harness primitive
calling `ask_user_question`. Drive stdin to type "yes\r". Assert the
tool's return contains `"yes"` and `harness.recordPrimitive('askUser')`
was invoked (snapshot via `harness.snapshot().history`).

### 3.5 Wire into cli.tsx

- [ ] **Step 7: Replace askUser stub at cli.tsx:700**

```diff
-    tools.register(makeAskUserQuestionTool(harness, { askUser: async (q) => `(prompt user via TUI: ${q})` }) as any)
+    tools.register(makeAskUserQuestionTool(harness, { askUser: callables.askUser }) as any)
```

### 3.6 Acceptance criteria for M3

- [ ] `git grep "prompt user via TUI"` returns 0 hits in `src/`.
- [ ] Both unit + integration tests pass.
- [ ] Submenu renders + submits answer end-to-end.

- [ ] **Step 8: Commit**
```bash
git commit -am "feat(spec-a/m3): callableHub.askUser via permBridge"
```

---

## Task 4: M4 — run-shell PTY (G4)

≈ 250 LOC.

**Files:**
- Modify: `package.json` (add `node-pty`)
- Modify: `src/core/tasks/types.ts` (add `pty_size`, `outputCapBytes`)
- Modify: `src/core/tasks/run-shell.ts` (rewrite from throw)
- Create: `test/core/tasks/run-shell.test.ts`
- Create: `test/integration/run-shell-zoom.test.ts`

### 4.1 Add node-pty dependency

- [ ] **Step 1: Patch `package.json`**
```json
"dependencies": {
  ...
  "node-pty": "^1.0.0",
  ...
}
```
- [ ] **Step 2: `npm install`**

### 4.2 Extend LocalShellSpec

- [ ] **Step 3: Patch `src/core/tasks/types.ts`** (additive)

```ts
export type LocalShellSpec = {
  kind: 'local_shell'
  description: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  pty: boolean
  pty_size?: { cols: number; rows: number }
  outputCapBytes?: number
}
```

### 4.3 Failing unit test

- [ ] **Step 4: `test/core/tasks/run-shell.test.ts`** ≈ 130 LOC, gated `process.platform !== 'win32'`

Cover:
- Spawn `echo hello`, verify `task.exitCode === 0` and output contains `hello`.
- Spawn `sleep 5`, abort signal at t=100ms, verify SIGTERM kills child.
- Output cap at 1024 bytes; produce 2048 bytes of output; verify log
  rotation truncates the older bytes.
- Lazy import: when `node-pty` import fails (mock), expect typed error.

### 4.4 Implement runShell

- [ ] **Step 5: Rewrite `src/core/tasks/run-shell.ts`** ≈ 80 LOC

(Body matches spec §6.5 — see spec for full code.) Key pieces:

- Lazy `await import('node-pty')` — fail with typed error if missing.
- `term.onData` accumulates bytes, calls `deps.setProgress` and `deps.outputAppend`.
- `signal.addEventListener('abort', …)` schedules SIGTERM + SIGKILL.
- `term.onExit` resolves/rejects.

The runner signature changes from `(task, signal)` to
`(task, signal, deps)`. Update `pickRunner` in
`src/core/tasks/manager.ts` to inject `deps` (bus + setProgress +
outputAppend already available on the manager).

### 4.5 Integration test

- [ ] **Step 6: `test/integration/run-shell-zoom.test.ts`** ≈ 90 LOC

- Spawn a `LocalShellSpec` for `node -e "setInterval(()=>process.stdout.write('tick '),50);setTimeout(()=>process.exit(0),300)"`.
- After 200ms, snapshot Backgrounds column rows.
- Assert one row with `summary` containing "tick".
- Press Enter on the row; assert zoomed view shows last 200 chars of output.

### 4.6 Acceptance criteria for M4

- [ ] `npx vitest run test/core/tasks/run-shell.test.ts` passes (Linux/macOS).
- [ ] Integration test passes.
- [ ] `LocalShellSpec` no longer throws.

- [ ] **Step 7: Commit**
```bash
git commit -am "feat(spec-a/m4): run-shell PTY backed by node-pty"
```

---

## Task 5: M5 — UdsBackend (G5)

≈ 280 LOC.

**Files:**
- Modify: `src/core/messaging/udsBackend.ts` (rewrite from no-op)
- Modify: `src/core/messaging/router.ts` (register UdsBackend in defaults)
- Create: `test/core/messaging/udsBackend.test.ts`
- Create: `test/core/messaging/udsBackend.framing.test.ts`
- Create: `test/integration/uds-router.test.ts`

### 5.1 Failing framing unit test

- [ ] **Step 1: `test/core/messaging/udsBackend.framing.test.ts`** ≈ 60 LOC

Cover length-prefix parsing:
- Single complete frame parses cleanly.
- Frame split across two `data` events reassembles.
- Two frames in one `data` event split correctly.
- Malformed JSON dropped without crashing the parser loop.

These tests can use a dummy buffer-driver against a private static
helper `UdsBackend['parseFrames']` (or refactor to a free function).

### 5.2 Failing roundtrip unit test

- [ ] **Step 2: `test/core/messaging/udsBackend.test.ts`** ≈ 90 LOC

Use a tmpdir (`fs.mkdtempSync`) for the socket path.

- `bindListener(sockPath)` creates `0700` dir + `0600` socket.
- `send({ to: sockPath, ... })` from a separate `UdsBackend` instance
  delivers to the bound subscriber.
- No subscriber → `pending(sockPath)` increments; `drain` returns the queued envelope.
- `closeAll()` unlinks the socket and kills the listener.

### 5.3 Implement UdsBackend

- [ ] **Step 3: Rewrite `src/core/messaging/udsBackend.ts`** ≈ 140 LOC

(Body matches spec §6.7 — net.createServer + net.createConnection +
length-prefix framing + subscribe-then-flush.)

- [ ] **Step 4: Run unit tests**

```bash
npx vitest run test/core/messaging/udsBackend.test.ts test/core/messaging/udsBackend.framing.test.ts
```

### 5.4 Register in router defaults

- [ ] **Step 5: Patch `src/core/messaging/router.ts`** or its caller in cli.tsx

The existing router takes `backends` in its constructor opts. cli.tsx
constructs the router with `[new InProcessBackend()]`; change to
`[new InProcessBackend(), new UdsBackend()]`. Ordering: in-process
matches first for `team:*` addresses; UDS picks up addresses starting
with `/`.

### 5.5 Integration test

- [ ] **Step 6: `test/integration/uds-router.test.ts`** ≈ 70 LOC

- Create router with both backends.
- `bindListener('/tmp/test-XXXX/agent.sock')`.
- Subscribe.
- Send envelope via router with `to: '/tmp/test-XXXX/agent.sock'`.
- Assert subscriber received it; `message.delivered` event fired.
- Send envelope with `to: 'team:my-feature/alice'` → routed to
  InProcessBackend (UDS returns false; falls through).

### 5.6 Acceptance criteria for M5

- [ ] All three test files pass.
- [ ] No socket leaks after tests (tmpdir cleanly removed).

- [ ] **Step 7: Commit**
```bash
git commit -am "feat(spec-a/m5): real UdsBackend with length-prefixed framing"
```

---

## Task 6: M6 — run-remote-agent (G6)

≈ 320 LOC.

**Files:**
- Create: `bin/nuka-remote-runner.js`
- Modify: `src/core/tasks/types.ts` (RemoteAgentSpec extension §5.2)
- Modify: `src/core/tasks/run-remote-agent.ts` (rewrite from throw)
- Modify: `package.json` (`"bin": { "nuka-remote-runner": "bin/nuka-remote-runner.js" }` + `"files"` adds `bin/`)
- Create: `test/integration/run-remote-agent.test.ts`

Depends on **M5 (UdsBackend)**.

### 6.1 Extend RemoteAgentSpec

- [ ] **Step 1: Patch `src/core/tasks/types.ts`**

Replace the existing arm with the spec-§5.2 shape, additive only
(`agentDefRef`, `providerHint`, `walltimeBudgetMs` optional).

### 6.2 Write the child runner

- [ ] **Step 2: Create `bin/nuka-remote-runner.js`** ≈ 120 LOC

Plain Node script (no TypeScript transpilation in `bin/`):

```js
#!/usr/bin/env node
const net = require('net')
const path = require('path')

const args = process.argv.slice(2)
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const sockPath = get('--socket')
const agentDefRef = get('--agent-def')
const providerId = get('--provider')
const model = get('--model')

// Connect to parent
const sock = net.createConnection(sockPath)

// Length-prefixed framing helpers
function writeFrame(env) {
  const json = Buffer.from(JSON.stringify(env), 'utf8')
  const len = Buffer.alloc(4); len.writeUInt32BE(json.length, 0)
  sock.write(Buffer.concat([len, json, Buffer.from('\n')]))
}

let buf = Buffer.alloc(0)
sock.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  while (buf.length >= 4) {
    const n = buf.readUInt32BE(0)
    if (buf.length < 4 + n + 1) break
    const env = JSON.parse(buf.subarray(4, 4 + n).toString('utf8'))
    buf = buf.subarray(4 + n + 1)
    handleEnvelope(env)
  }
})

sock.on('connect', () => {
  // Ping parent so it knows we're alive
  writeFrame({ id: 'ping-' + process.pid, from: sockPath, to: 'parent', summary: 'ready', message: '', sentAt: Date.now() })
})

async function handleEnvelope(env) {
  if (typeof env.message === 'object' && env.message?.type === 'shutdown_request') {
    sock.end()
    process.exit(0)
  }
  // Real implementation: run the AgentLoop with the prompt = env.message.
  // For M6, this is a minimal echo so the parent test can assert delivery.
  if (typeof env.message === 'string') {
    writeFrame({ id: 'echo-' + Date.now(), from: sockPath, to: env.from, summary: 'echo', message: 'received: ' + env.message, sentAt: Date.now() })
  }
}

process.on('SIGTERM', () => { sock.end(); process.exit(143) })
```

(The "minimal echo" body is the M6 deliverable; full AgentLoop port is
deferred — Spec A's goal is the transport, not yet a full child agent.
Sibling spec B's worktree-as-thread will replace this body with a real
loop.)

- [ ] **Step 3: chmod +x bin/nuka-remote-runner.js**

### 6.3 Implement runRemoteAgent

- [ ] **Step 4: Rewrite `src/core/tasks/run-remote-agent.ts`** ≈ 130 LOC

(Body matches spec §6.6.) Key:

- `await deps.udsBackend.bindListener(spec.transport.addr)`.
- `spawn('node', [binPath, ...])`.
- Wait for child's "ready" envelope (10s timeout).
- Send `initialMessage` envelope.
- Wall budget timer + abort signal both kill the child.
- Resolve on child exit code 0.

The runner signature gains `deps: RunRemoteAgentDeps`. Manager dispatch
must inject `{ router, udsBackend, binPath, homeDir }`.

### 6.4 Integration test

- [ ] **Step 5: `test/integration/run-remote-agent.test.ts`** ≈ 100 LOC

- Spin up TaskManager + UdsBackend + MessageRouter.
- Build a `RemoteAgentSpec` with `transport: { kind: 'uds', addr: <tmpsock> }` and `agentDefRef: 'core:researcher'`, `initialMessage: 'hello'`.
- Enqueue.
- Assert: subscriber receives "echo: hello" envelope within 5s.
- Abort the task → child SIGTERM'd.

CI tag `slow` (timeout 15s).

### 6.5 Acceptance criteria for M6

- [ ] Integration test passes ×3 consecutive runs.
- [ ] No leaked child processes after `npm test`.
- [ ] Sockets in tmpdir are unlinked on test teardown.

- [ ] **Step 6: Commit**
```bash
git commit -am "feat(spec-a/m6): run-remote-agent with bin/nuka-remote-runner.js"
```

---

## Task 7: M7 — Slash text reliability + recap-on-resume + /teams + /sessions (G7-G10)

The single biggest milestone: four user-visible deliverables, sharing
one commit window because they all touch `cli.tsx` boot wiring or
`App.tsx` reducer plumbing. ≈ 600 LOC.

**Files:**
- Create: `src/tui/testing/waitForFrame.ts`
- Modify: `src/tui/testing/harness.ts` (re-export, plus YAML dispatch)
- Create: `src/slash/teams.ts`
- Create: `src/slash/sessions.ts`
- Create: `src/tui/Recap/AwaySummaryCard.tsx`
- Modify: `src/cli.tsx` (recap-on-resume hook + register teams/sessions)
- Modify: `src/core/recap/types.ts` (`trigger` field)
- Modify: `src/core/recap/awaySummary.ts` (pass trigger through)
- Modify: `src/tui/Submenu/types.ts` (session-picker `mode` field)
- Modify: `src/tui/App.tsx` (render awayCard; honor browse mode)
- Modify: `test-plans/03-theme-switch.yaml`
- Modify: `test-plans/05-plan-mode-lockout.yaml`
- Modify: `test-plans/06-slash-text-output.yaml`
- Modify: `src/slash/help.ts` (add /teams + /sessions to help table)
- Create: `test/slash/teams.test.ts`
- Create: `test/slash/sessions.test.ts`
- Create: `test/integration/recap-resume-card.test.ts`
- Create: `test/core/recap/launchCard.test.ts`
- Create: `test/integration/sessions-browse.test.ts`

### 7.1 Test-plan harness extension (G7)

- [ ] **Step 1: Create `src/tui/testing/waitForFrame.ts`** ≈ 60 LOC

```ts
import type { TuiHarnessHandle } from './harness'

export type WaitForFrameOpts = { timeoutMs?: number; pollIntervalMs?: number }

export async function waitForFrameContaining(
  harness: TuiHarnessHandle,
  text: string,
  opts: WaitForFrameOpts = {},
): Promise<{ frame: string; iterations: number }> {
  const timeout = opts.timeoutMs ?? 1000
  const poll = opts.pollIntervalMs ?? 16
  const start = Date.now()
  let iterations = 0
  while (Date.now() - start < timeout) {
    iterations++
    const frames = harness.frames()
    const last = frames[frames.length - 1] ?? ''
    if (last.includes(text)) return { frame: last, iterations }
    await flushPendingState()
    await new Promise(r => setTimeout(r, poll))
  }
  throw new Error(`waitForFrameContaining timeout: ${JSON.stringify(text)}`)
}

export async function flushPendingState(): Promise<void> {
  await new Promise<void>(r => setImmediate(r))
  await Promise.resolve()
  await new Promise<void>(r => setImmediate(r))
}
```

- [ ] **Step 2: Patch the YAML dispatcher in `src/tui/testing/harness.ts`**

Add a `waitFor` step kind alongside the existing `wait`:

```ts
case 'waitFor':
  await waitForFrameContaining(harness, step.contains, { timeoutMs: step.timeoutMs })
  break
```

### 7.2 `/teams` slash (G9)

- [ ] **Step 3: Create `src/slash/teams.ts`** (matches spec §6.10) ≈ 50 LOC
- [ ] **Step 4: Create `test/slash/teams.test.ts`** ≈ 60 LOC

Cover empty list, single team, named lookup hit/miss.

- [ ] **Step 5: Register in cli.tsx** ≈ 3 LOC

```ts
slash.register(makeTeamsCommand({ teams: teamRegistry }))
```

### 7.3 `/sessions` slash (G10)

- [ ] **Step 6: Create `src/slash/sessions.ts`** ≈ 15 LOC (matches spec §6.11)
- [ ] **Step 7: Patch `src/tui/Submenu/types.ts`** add `mode?: 'browse' | 'resume'` to `session-picker`.
- [ ] **Step 8: Patch App.tsx session-picker render** ≈ 60 LOC:

When `mode === 'browse'`:
- Render preview pane to right of list.
- Enter does NOT auto-resume; toggles preview.
- `[Resume]` button (Tab to focus) fires the resume effect.

- [ ] **Step 9: Register in cli.tsx** ≈ 1 LOC `slash.register(SessionsCommand)`.
- [ ] **Step 10: Create `test/slash/sessions.test.ts`** ≈ 25 LOC.
- [ ] **Step 11: Create `test/integration/sessions-browse.test.ts`** ≈ 80 LOC.

### 7.4 Recap on `--resume` (G8)

- [ ] **Step 12: Patch `src/core/recap/types.ts`** add `trigger: 'mid-session-idle' | 'launch-resume'`.
- [ ] **Step 13: Patch `src/core/recap/awaySummary.ts`** thread `trigger` through to the `AwaySummaryCard` payload.
- [ ] **Step 14: Create `src/tui/Recap/AwaySummaryCard.tsx`** ≈ 60 LOC

Renders the existing card design (phase14c §5.3) with a small icon
chip selected by `trigger`:
- `mid-session-idle` → "Welcome back"
- `launch-resume` → "Resumed from <date>"

- [ ] **Step 15: Patch `src/tui/App.tsx`**

```ts
{appState.awayCard && <AwaySummaryCard card={appState.awayCard} onDismiss={() => dispatchUI({ type: 'dismiss-away-card' })} />}
```

Render position: above the Welcome hero, below the top border. The
component uses `<Box>` (not `<Static>`) so the test harness `frames()`
sees it.

- [ ] **Step 16: Patch cli.tsx with the `--resume` hook** (matches spec §6.9) ≈ 30 LOC

```ts
if (resumeArg && session.messages.length > 0) {
  try {
    const card = await generateAwaySummary({
      messages: session.messages,
      signal: AbortSignal.timeout(15_000),
      runFork: callables.runFork,
    })
    initialAppState.awayCard = {
      generatedAt: Date.now(),
      text: card.text,
      inputTokensUsed: card.tokensUsed,
      modelUsed: card.modelUsed,
      trigger: 'launch-resume',
    }
  } catch { /* swallow */ }
}
```

- [ ] **Step 17: `test/core/recap/launchCard.test.ts`** ≈ 40 LOC.
- [ ] **Step 18: `test/integration/recap-resume-card.test.ts`** ≈ 80 LOC.

### 7.5 Update three test plans

- [ ] **Step 19: Rewrite `test-plans/06-slash-text-output.yaml`**

```yaml
name: 06-slash-text-output
description: |
  Slash command text output is rendered in-frame. After Spec A/M7 the
  test harness flushes pending state via `waitFor` so this is no longer
  flaky.

setup:
  slash:
    - StatusBarCommand
    - HelpCommand

steps:
  - render: app
  - keystroke: '/help'
  - waitFor: { contains: '/help', timeoutMs: 500 }
  - keystroke: "\r"
  - waitFor: { contains: 'help', timeoutMs: 1500 }
  - assert: { contains: '/help' }
  - assert: { contains: 'help' }
```

- [ ] **Step 20: Rewrite `test-plans/03-theme-switch.yaml`**

Drop the DOWNGRADE NOTE comment block. Add a `waitFor` step after
each `Enter`. Replace asserts that previously referred to the prompt
clearing with asserts on the rendered frame containing
`'Theme switched to'`.

- [ ] **Step 21: Rewrite `test-plans/05-plan-mode-lockout.yaml`**

Same pattern. Assert `'Plan mode ON'` in frame.

### 7.6 Help table

- [ ] **Step 22: Patch `src/slash/help.ts`** add lines for `/teams` and
  `/sessions` matching the README table.

### 7.7 Acceptance criteria for M7

- [ ] All three test plans (03, 05, 06) run green ×3 consecutive runs.
- [ ] `/teams` lists teams or `(no teams configured)`.
- [ ] `/sessions` opens browse mode; `[Resume]` button fires.
- [ ] `nuka --resume <id>` shows AwaySummaryCard before first user input.
- [ ] No regressions: 01, 02, 04, 08 still green.

- [ ] **Step 23: Commit**
```bash
git commit -am "feat(spec-a/m7): slash reliability + recap-on-resume + /teams + /sessions"
```

---

## Task 8: M8 — ink-ui-explorer fixtures (G11)

≈ 250 LOC across 8 fixture files + .gitignore + optional CI.

**Files:**
- Create: `test/ui-auto/fixtures/Welcome.fixtures.tsx`
- Create: `test/ui-auto/fixtures/PromptInput.fixtures.tsx`
- Create: `test/ui-auto/fixtures/StatusPanel.fixtures.tsx`
- Create: `test/ui-auto/fixtures/SlashCard.fixtures.tsx`
- Create: `test/ui-auto/fixtures/Settings.fixtures.tsx`
- Create: `test/ui-auto/fixtures/Messages.fixtures.tsx`
- Create: `test/ui-auto/fixtures/Tasks.fixtures.tsx`
- Create: `test/ui-auto/fixtures/HarnessSubmenu.fixtures.tsx`
- Modify: `.gitignore` (append `/.ink-explorer/`)
- Optional: `.github/workflows/ink-ui-explorer.yml`

### 8.1 Author the eight fixtures

Each fixture follows the template in
`docs/superpowers/specs/2026-05-02-ink-ui-explorer-design.md` §4.3:

```ts
import type { Fixture } from 'ink-ui-explorer/runner'
import { Welcome } from '../../../src/tui/Welcome/Welcome'

export default {
  component: 'Welcome',
  cases: {
    cold: {
      render: () => <Welcome /* …minimal props… */ />,
      mustContain: ['NUKA'],
      expectsHugContent: true,
    },
    withRecents: {
      render: () => <Welcome recents={[{ id: 's1', label: 'session-1', cwd: '/tmp' }]} />,
      mustContain: ['NUKA', 'Recent'],
    },
  },
  viewports: 'default',
} satisfies Fixture
```

- [ ] **Step 1: `Welcome.fixtures.tsx`** ≈ 30 LOC, two cases (`cold`, `withRecents`).
- [ ] **Step 2: `PromptInput.fixtures.tsx`** ≈ 30 LOC, three cases (`empty`, `short`, `overflowing`).
- [ ] **Step 3: `StatusPanel.fixtures.tsx`** ≈ 30 LOC, two cases (`narrow`, `wide`).
- [ ] **Step 4: `SlashCard.fixtures.tsx`** ≈ 30 LOC, three cases
  (`zero-suggestions`, `single`, `pagination-edge` — last item visibility).
- [ ] **Step 5: `Settings.fixtures.tsx`** ≈ 25 LOC, one case (`default`).
- [ ] **Step 6: `Messages.fixtures.tsx`** ≈ 35 LOC, two cases (`empty`, `tail-50`).
  Asserts `allowStatic: false` (regression for "Messages `<Static>` push to scrollback").
- [ ] **Step 7: `Tasks.fixtures.tsx`** ≈ 30 LOC, two cases (`empty`, `5-column`).
- [ ] **Step 8: `HarnessSubmenu.fixtures.tsx`** ≈ 25 LOC, one case (`default`).

### 8.2 .gitignore

- [ ] **Step 9: Append `/.ink-explorer/` to `.gitignore`**

### 8.3 Optional CI workflow

- [ ] **Step 10: Create `.github/workflows/ink-ui-explorer.yml`** (optional ≈ 30 LOC)

```yaml
name: ink-ui-explorer sweep
on: [pull_request]
jobs:
  sweep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install
      - name: Install ink-ui-explorer skill
        run: |
          if [ ! -d "$HOME/.claude/skills/ink-ui-explorer" ]; then
            echo "::warning ::ink-ui-explorer skill not installed; skipping"
            exit 0
          fi
      - run: ink-ui-explorer sweep test/ui-auto/fixtures/**/*.fixtures.tsx --no-judge
```

### 8.4 Acceptance criteria for M8

- [ ] All 8 fixture files compile (vitest "smoke" suite).
- [ ] When `~/.claude/skills/ink-ui-explorer/` is present, `sweep` runs
  without crashing (zero new dumps OR all dumps repaired+promoted).

- [ ] **Step 11: Commit**
```bash
git commit -am "feat(spec-a/m8): ink-ui-explorer fixtures for 8 components"
```

---

## Task 9: M9 — Verification + bundle audit

No new code. Run all the gates ×3.

### 9.1 Test-plan re-run

- [ ] **Step 1: Run all test-plans ×3**

```bash
for f in test-plans/*.yaml; do
  for i in 1 2 3; do
    echo "=== Run $i — $f ==="
    npm run nuka -- --test-plan "$f" --reporter=tap || exit 1
  done
done
```

Expected: all 7 plans green ×3 each.

### 9.2 Type + unit + integration

- [ ] **Step 2: `npm run typecheck`** — 0 errors.
- [ ] **Step 3: `npm test`** — all suites green.
- [ ] **Step 4: `npm test -- --run -t integration`** — slow integration suite green.

### 9.3 Bundle audit

- [ ] **Step 5: Build + measure**
```bash
npm run build
ls -lh dist/cli.bundle.js
```

Acceptance: bundle ≤ 540 KB. Current README shows 376 KB. Spec A
adds:

| Item | Estimated bundle delta |
|------|------------------------|
| `callableHub.ts` + smallFastModel + researcherTools | +6 KB |
| `udsBackend.ts` rewrite | +4 KB |
| `run-shell.ts` rewrite (without node-pty native) | +3 KB |
| `run-remote-agent.ts` rewrite | +4 KB |
| `bin/nuka-remote-runner.js` (separate file, not bundled) | 0 KB |
| `slash/teams.ts` + `slash/sessions.ts` | +2 KB |
| `AwaySummaryCard.tsx` | +3 KB |
| `tui/testing/waitForFrame.ts` (only in test build) | 0 KB |
| Total estimated delta | +22 KB |

Final estimated: 376 + 22 = 398 KB. Comfortably under 540 KB cap.

### 9.4 Stub-removal sanity grep

- [ ] **Step 6: Grep for residual stubs**

```bash
git grep -E "stub triage|stub.*results for|prompt user via TUI|not implemented \(phase14a\)" src/
```

Expected: zero hits.

### 9.5 README cross-check

- [ ] **Step 7: Verify README claims hold**

Run the slash help command list:

```bash
npm run nuka -- --slash list
```

Expected output includes: `/monitor`, `/recap`, `/harness`, `/teams`,
`/settings`, `/sessions`, `/stats`, `/doctor`. No "missing" placeholders.

### 9.6 Sibling-spec non-collision

- [ ] **Step 8: Verify no overlap with sibling spec deliverables**

```bash
git grep -E "worktree-as-thread|/goal\b|cron_create|spec-c|spec-d|spec-e" src/ docs/
```

Expected: no hits in `src/` (those are sibling spec scope). Hits in
`docs/` only at the spec self-references in §3 / §10.

### 9.7 Acceptance criteria for M9

- [ ] All 7 test-plans run green ×3.
- [ ] `npm run typecheck && npm test` green.
- [ ] Bundle ≤ 540 KB.
- [ ] `git grep` for stub strings returns 0.
- [ ] README slash list matches reality.
- [ ] No sibling-spec scope leakage.

- [ ] **Step 9: Commit final verification artifact**
```bash
git commit -am "chore(spec-a/m9): verification — all 7 test-plans green ×3, bundle <540KB"
```

---

## Test-first ordering recap (per Nuka harness profile)

The harness three-axis matrix
(`docs/plans/2026-05-01-harness-three-axis-refactor-design.md` §7) for
**`feature` profile + `medium` difficulty + `tdd` strategy** mandates:
**Implement = "完整流程不拆"** + "TDD 经典红绿重构 (unit)". Every
milestone with new code (M1–M6) follows red-green-refactor:

| Milestone | Failing test first | Then implementation |
|-----------|--------------------|---------------------|
| M1 | `callableHub.runFork.test.ts` | `callableHub.ts` runFork body |
| M2 | `callableHub.runResearcher.test.ts` | `callableHub.ts` runResearcher body |
| M3 | `callableHub.askUser.test.ts` | `callableHub.ts` askUser body + `permBridge.ask` |
| M4 | `run-shell.test.ts` | `run-shell.ts` rewrite |
| M5 | `udsBackend.framing.test.ts` | `udsBackend.ts` parser |
| M5 | `udsBackend.test.ts` | `udsBackend.ts` full body |
| M6 | `run-remote-agent.test.ts` (integration) | `run-remote-agent.ts` + `bin/nuka-remote-runner.js` |
| M7 | `recap-resume-card.test.ts` | resume hook in cli.tsx |
| M7 | `teams.test.ts` | `/teams` slash |
| M7 | `sessions.test.ts` | `/sessions` slash |
| M7 | rewritten `06-slash-text-output.yaml` | `waitForFrame.ts` extension |
| M8 | smoke compile of fixtures | (no implementation; M8 *is* fixtures) |
| M9 | (no new code) | verification only |

The unit tests for the three callables (M1–M3) run **before** the
cli.tsx wiring change to avoid making a broken cli — the unit tests
verify the API surface, then the wiring is a one-liner that the smoke
build covers.

---

## LOC summary

| Milestone | New LOC | Modified LOC | Tests LOC |
|-----------|---------|--------------|-----------|
| M1 | 115 (hub skeleton + smallFastModel) | 8 (cli.tsx) | 130 |
| M2 | 110 (researcher branch + tools) | 3 (cli.tsx) | 170 |
| M3 | 90 (askUser + submenu) | 35 (cli.tsx + App.tsx) | 150 |
| M4 | 100 (run-shell rewrite) | 12 (types.ts) | 220 |
| M5 | 200 (udsBackend rewrite) | 5 (router.ts) | 220 |
| M6 | 250 (remote-agent + runner bin) | 18 (types.ts) | 100 |
| M7 | 280 (waitForFrame, slashes, card, hooks) | 110 (App.tsx, cli.tsx, plans) | 240 |
| M8 | 250 (8 fixtures) | 1 (.gitignore) | 0 |
| M9 | 0 | 0 | 0 |
| **Total** | **≈ 1395** | **≈ 192** | **≈ 1230** |

Total = ~2820 LOC across 9 milestones.

---

## Verification commands (npm scripts)

The following npm scripts must all be green at M9 completion:

| Script | Source | Coverage |
|--------|--------|----------|
| `npm run typecheck` | `package.json` `scripts.typecheck` | TypeScript 0 errors |
| `npm test` | `package.json` `scripts.test` | All vitest suites |
| `npm run test:plans` | NEW — adds wrapper that runs all `test-plans/*.yaml` ×3 | All 7 plans green ×3 |
| `npm run build` | `package.json` `scripts.build` | esbuild bundle ≤ 540 KB |
| `npm run lint` | existing | ESLint clean |

Add the new npm script in M9 step 1:

```json
"test:plans": "for f in test-plans/*.yaml; do for i in 1 2 3; do node ./dist/cli.bundle.js --test-plan \"$f\" --reporter=tap || exit 1; done; done"
```

---

## Risks & mitigations (plan-level)

| Risk | Mitigation |
|------|------------|
| `npm install node-pty` fails in CI sandbox | M4 step 4 explicitly tests the lazy-import error path; CI uses `node-pty` prebuilt binary; fallback to skip on `process.platform === 'win32'` |
| UDS path > 104 chars on macOS in CI tmpdir | Use `os.tmpdir() + '/n.sock'` (8 chars) in tests; production uses `<sessionId-8>` |
| `permBridge.ask` race when multiple `askUser` calls overlap | Each call gets a unique `resolveId`; submenu queue holds pending; UI shows current + count of waiting |
| `waitForFrameContaining` masks real React bugs by hiding them with longer timeouts | Default timeout 1000ms is short; failing tests will show clear timeout errors with the searched text |
| `--resume` recap hook delays REPL start by ≤ 15s | Fork is awaited with `AbortSignal.timeout(15_000)`; if it doesn't finish, REPL starts without a card |
| Three-test-plan determinism still flakes after waitFor | `npm run test:plans` runs each ×3; if any single run fails, the milestone is rolled back and the underlying race investigated (likely Ink reconciler ordering) |
| ink-ui-explorer skill not installed in dev environment | M8 fixtures still compile via vitest smoke suite; explorer-side sweep is the optional gate |
| Bundle delta exceeds 540 KB | Drop bundled `bin/nuka-remote-runner.js` from npm files (it ships separately); switch `node-pty` to peer dependency |

---

## Rollback procedure

Each milestone is one PR. To roll back:

1. `git revert <merge-commit-of-MN>` (preserves history).
2. If multiple milestones depend (M5 → M6, M1 → M2/M3/M7), revert in
   reverse order.
3. `npm run typecheck && npm test` to confirm clean revert.
4. Re-open the milestone PR with the failing case reproduced.

Per-milestone rollback fallbacks are documented in spec §9.

---

## Appendix A — Manual smoke checklist (post-M9)

After all milestones land, run this manual sequence in a fresh terminal
(matches user-facing acceptance):

1. `nuka` — boots offline, no provider configured.
2. `/teams` — shows `(no teams configured)`.
3. `/sessions` — opens browse-mode session-picker.
4. `Esc`, `Esc`.
5. (configure Anthropic provider via `/settings`)
6. `/triage make a new feature`. Expected: harness state machine
   classifies the request (no `(stub triage fork response)`).
7. (start a teammate via `team_create` — coordinator mode).
8. Manually enqueue a `LocalShellSpec` for `top -bn1` via the
   plugin sample. Expected: row appears in Backgrounds column;
   Enter shows live output.
9. Quit. Restart with `nuka --resume <last-id>`. Expected:
   AwaySummaryCard at top of conversation.
10. `/help`. Expected: `/teams` and `/sessions` listed.

If all 10 steps pass on a clean install, M9 is complete.

---

*End of plan.*
