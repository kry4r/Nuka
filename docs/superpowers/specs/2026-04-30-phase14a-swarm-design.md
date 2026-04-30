# Phase 14a — Swarm: coordinator + named teammates + cascade pipelines + role collaboration

**Date:** 2026-04-30
**Status:** Spec
**Depends on:** `2026-04-30-phase14-foundation-design.md` (Task type union, EventBus, MessageRouter, TeamRegistry, ProgressTracker, forkedAgent, Coordinator gate)
**Author:** Brainstorming session 2026-04-30 (post-foundation)

## 1. Problem

The phase14 foundation locks down the data and event primitives, but no caller exercises them yet. Nuka's main agent loop today only knows about a single `dispatch_agent` tool that runs an isolated sub-session and returns text. There is no:

- Way to spawn a **named, addressable teammate** that survives across turns
- Way for one agent to **send a message** to another by name
- Way for the user to ask "give me a team that does X" and have the model **fan out** workers + a leader
- Way to express a **cascade pipeline** (researcher → planner → implementer → reviewer) where each stage's output is the next stage's input
- Way to express **role collaboration** (a planner and a skeptic argue over the same artifact for N rounds before the implementer starts)
- Way to switch the lead agent into **coordinator mode** so its toolbox is reduced to "delegate + steer" while workers carry the implementation tools

This sub-spec wires those four shapes (named teammates, send-message, cascade pipeline, role collab) on top of the foundation. UDS / bridge cross-machine backends remain interface-only — phase14a ships only the in-process backend, plus a UDS skeleton that future phases can flesh out without redesigning anything above.

## 2. Goals

1. **`team_create` / `team_delete` / `send_message` tools** — three new built-in tools, gated by `isCoordinatorMode()` for `team_*`, always available for `send_message`. Schemas follow Claude Code's exactly.
2. **`in_process_teammate` runner** — full body for `src/core/tasks/run-teammate.ts`. AsyncLocalStorage-style scoped session; idle ↔ running transitions; pending-message inbox; plan-mode approval protocol; clean shutdown via `shutdown_request`.
3. **Coordinator-mode wiring** — `AgentLoop` reads `isCoordinatorMode()` at boot and applies the worker-tool whitelist to dispatched workers. Coordinator session stays untouched (it has the steering tools). `getCoordinatorUserContext()` is injected into the system prompt of the lead.
4. **Cascade pipeline primitives** — a new `pipeline_run` built-in tool that takes a DAG of stages and seeds them sequentially, threading each stage's output into the next via the `handoff` protocol message (already in `MessageEnvelope` schema). Failure of any node aborts the rest with a structured error.
5. **Role-collaboration primitive** — a `roundtable` built-in tool that spawns N named teammates in the same team with a shared topic, runs them through K rounds of `SendMessage` debate, then closes with a designated "synthesizer" producing a single artifact. Used by harness's `Plan` and `Review` stages later.
6. **Recursion guard preserved** — `dispatch_agent`'s existing recursion-guard (`session.allowedAgentDispatch = false`) is extended to the new `team_create` tool: a teammate cannot create another team. SendMessage between siblings is allowed.
7. **UDS backend skeleton** — `src/core/messaging/udsBackend.ts` ships as a stub class that registers as a `MessageBackend` but throws `'not implemented'` on `send`. The class file exists so phase14b/c can opt-in without a foundation amendment.

## 3. Non-Goals

- ❌ No bridge / cross-machine backend (deferred indefinitely; relevant for SaaS, not local CLI)
- ❌ No remote-agent runner full body (`run-remote-agent.ts` stays a stub)
- ❌ No dream runner full body (`run-dream.ts` is phase14c's responsibility)
- ❌ No UI work for swarm — all `Tasks` panel and `/monitor` dashboard wiring is phase14b
- ❌ No persistence of in-flight teammate conversations beyond what the existing `Session` machinery already does
- ❌ No automatic retry of failed pipeline nodes (failure aborts the DAG; retry is a higher-level concern)
- ❌ No team-level access control / permissions beyond the existing `PermissionChecker`

## 4. High-level architecture

```
                ┌─────────────── Lead Agent Session ─────────────────┐
                │  systemPrompt += getCoordinatorUserContext()       │
                │  toolFilter ⊆ COORDINATOR_INTERNAL_TOOLS           │
                │       ┌──────────┐  ┌────────────┐  ┌─────────────┐│
                │       │team_create│ │send_message│  │pipeline_run ││
                │       │team_delete│ │ (always)   │  │ roundtable  ││
                │       └────┬─────┘  └─────┬──────┘  └──────┬──────┘│
                │            │              │                 │      │
                └────────────┼──────────────┼─────────────────┼──────┘
                             │              │                 │
                ┌────────────▼─────┐ ┌──────▼──────┐ ┌────────▼───────┐
                │  TeamRegistry    │ │MessageRouter│ │ Pipeline DAG   │
                │  (foundation)    │ │(foundation) │ │ runner (NEW)   │
                └────────┬─────────┘ └──────┬──────┘ └────────┬───────┘
                         │                  │                 │
                         │            ┌─────▼──────┐          │
                         │            │ InProcess  │          │
                         │            │ Backend    │          │
                         │            └─────┬──────┘          │
                         │                  │                 │
                ┌────────▼──────────────────▼─────────────────▼──────┐
                │      In-process Teammate Tasks (run-teammate.ts)    │
                │   ┌──────┐  ┌──────┐  ┌──────┐  ┌────────┐         │
                │   │alice │  │ bob  │  │carol │  │skeptic │ ...     │
                │   └──────┘  └──────┘  └──────┘  └────────┘         │
                │  Each: Session + ProgressTracker + Inbox            │
                │  toolFilter = WORKER_ALLOWED_TOOLS                  │
                └─────────────────────────────────────────────────────┘
                                       │
                                       ▼
                          EventBus emits task.* / agent.* / message.*
```

**Invariants preserved from foundation:**
- All cross-agent comms go through MessageRouter (no direct session-to-session calls).
- Recursion guard: a teammate's `Session.allowedAgentDispatch` is `false`; `team_create` checks this AND a separate `Session.allowedTeamCreate = false`.
- All forks (background summary, plan-mode approval prompt, synthesizer recap) use `runForkedAgent` for cache reuse.

**New invariants added by phase14a:**
- A `Pipeline` is a directed acyclic graph of `Stage` nodes; each Stage maps to one teammate spawn + one `handoff` message in/out. Stages execute strictly in topological order.
- A `Roundtable` is a closed group: `members[]` and `synthesizer`; the synthesizer is the only member that can emit the final artifact (others can only debate).

## 5. Data schemas

### 5.1 `team_create` tool input

```ts
const TeamCreateInputSchema = z.object({
  team_name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string().min(1),
})
```

Output: stringified `{ teamName, taskListId, configPath }`.

### 5.2 `team_delete` tool input

```ts
const TeamDeleteInputSchema = z.object({
  team_name: z.string(),
  keep_tasks: z.boolean().default(false),
})
```

Output: stringified `{ removed: true, members: number }`.

### 5.3 `send_message` tool input

```ts
const SendMessageInputSchema = z.object({
  to: z.string(),                  // teammate name OR "team:<name>/<agent>" OR "*"
  summary: z.string().min(1).max(200),
  message: z.union([z.string(), ProtocolMessageSchema]),
})
```

Resolution rules (`to` field):
- Bare name (`alice`) → resolved against the current team via the calling teammate's `teamName` context. Coordinator MUST use qualified `team:<name>/<agent>` because it does not have a single team context.
- `*` → broadcast to all members of the calling teammate's team. Coordinator must use `team:<name>/*`.
- `team:<name>/<agent>` → exact address.
- `uds:<sock>` / `bridge:<id>` — backend selection, stub-rejected this phase (UDS) or unsupported (bridge).

Output: `{ delivered: boolean, envelopeId: string }`.

### 5.4 `pipeline_run` tool input

```ts
const PipelineNodeSchema: z.ZodType<PipelineNode> = z.lazy(() => z.object({
  id: z.string(),                                  // e.g. "research"
  agent: z.string(),                               // qualified agent def name
  prompt: z.string(),                              // template; {{prev}} interpolated
  team: z.string().optional(),                     // existing team to spawn in;
                                                   // if omitted, an ephemeral team is created
  next: z.array(z.string()).default([]),           // child node ids
  timeoutMs: z.number().int().positive().default(300_000),
}))

const PipelineInputSchema = z.object({
  nodes: z.array(PipelineNodeSchema).min(1),
  entry: z.string(),                               // node id where execution begins
  ephemeralTeamName: z.string().optional(),        // override default ephemeral name
})
```

Output: `{ stages: [{ nodeId, agentName, status, output, durationMs }] }`.

DAG execution semantics: BFS from `entry`, level-synchronous. All nodes at level *L* run in parallel (fan-out via `runForkedAgent` for the read-only stages OR via `in_process_teammate` spawn for stages that need tools). When all level-L nodes finish, their outputs are concatenated and bound to `{{prev}}` for level L+1. Failure at any node short-circuits.

### 5.5 `roundtable` tool input

```ts
const RoundtableInputSchema = z.object({
  team: z.string(),                                // existing team name
  members: z.array(z.object({
    agent: z.string(),                             // qualified agent def
    name: z.string(),                              // unique within team
    role: z.string(),                              // "planner", "skeptic", "researcher", ...
  })).min(2).max(6),
  synthesizer: z.string(),                         // member name that produces final artifact
  topic: z.string().min(1),
  rounds: z.number().int().min(1).max(8).default(3),
})
```

Output: `{ artifact: string, rounds: number, transcript: string }`.

Execution: spawn all members → seed each with a system suffix `"You are the {role}. Topic: {topic}. Engage with other roles via send_message; never restate, only react."` → run K rounds where every member sends one message per round → synthesizer reads the transcript via inbox `drain()` and produces the final artifact via a `runForkedAgent` call.

### 5.6 In-process teammate state

```ts
type TeammateState = {
  taskId: string
  agentName: string
  teamName: string
  pendingUserMessages: string[]
  pendingProtocolMessages: ProtocolMessage[]
  conversation: Message[]              // capped at 200 entries; oldest dropped
  shutdownRequested: boolean
  planAwaitingApproval?: { plan: string; requestId: string }
}
```

Stored inside `run-teammate.ts` closure, exposed read-only via `TaskManager.getTeammateState(taskId)`.

## 6. Component contracts

### 6.1 `team_create` tool — `src/core/tools/builtin/teamCreate.ts`

```ts
defineTool<TeamCreateInput>({
  name: 'team_create',
  description: '…',
  parameters: { /* schema 5.1 */ },
  source: 'builtin',
  tags: ['core', 'swarm', 'coordinator-only'],
  annotations: { readOnly: false, destructive: false, openWorld: false, parallelSafe: false },
  needsPermission: () => 'none',
  async run(input, ctx) {
    if (ctx.session.allowedTeamCreate === false) {
      return { output: 'Sub-agents cannot create teams.', isError: true }
    }
    if (!isCoordinatorMode()) {
      return { output: 'team_create is only available in coordinator mode.', isError: true }
    }
    const team = await ctx.deps.teams.create(input.team_name, input.description)
    return { output: JSON.stringify({ teamName: team.name, taskListId: team.taskListId }), isError: false }
  },
})
```

### 6.2 `team_delete` tool — `src/core/tools/builtin/teamDelete.ts`

Mirror of `team_create`, calls `teams.delete(name, { keepTasks })`. On success returns `{ removed: true, members: <count> }`.

### 6.3 `send_message` tool — `src/core/tools/builtin/sendMessage.ts`

```ts
async run(input, ctx) {
  const fromAddr = resolveSelfAddress(ctx)   // "team:<t>/<a>" or "lead"
  const toAddr = resolveTargetAddress(input.to, ctx)
  if (input.to === '*') {
    if (!ctx.session.teamName) {
      return { output: '* broadcast requires teamName context (use qualified address from lead)', isError: true }
    }
    const team = ctx.deps.teams.find(ctx.session.teamName)
    if (!team) return { output: 'team not found', isError: true }
    const n = await ctx.deps.router.broadcast({
      teamName: team.name,
      members: team.members.map(m => m.agentName),
      base: { id: ulid(), from: fromAddr, summary: input.summary, message: input.message, sentAt: Date.now() },
    })
    return { output: JSON.stringify({ delivered: n > 0, count: n }), isError: false }
  }
  const env: MessageEnvelope = {
    id: ulid(), from: fromAddr, to: toAddr,
    summary: input.summary, message: input.message, sentAt: Date.now(),
  }
  const ok = await ctx.deps.router.send(env)
  return { output: JSON.stringify({ delivered: ok, envelopeId: env.id }), isError: !ok }
}
```

### 6.4 `in_process_teammate` runner — `src/core/tasks/run-teammate.ts` (full body)

Pseudocode:

```ts
export async function runTeammate(task: Task, signal: AbortSignal): Promise<void> {
  const spec = task.spec as InProcessTeammateSpec
  const session = createSession({ providerId, model: spec.agentDef.model })
  session.allowedAgentDispatch = false
  session.allowedTeamCreate = false                     // recursion guard for team_create
  session.teamName = spec.teamName
  session.agentName = spec.agentName

  const tracker = new ProgressTracker(task.id, deps.bus)
  const inboxOff = deps.router.inbox(`team:${spec.teamName}/${spec.agentName}`)
    .subscribe(env => onIncomingMessage(env, session, state))
  const summarizer = startSummarizer(task.id, session, tracker, deps)  // 30s forked summary

  state = { ...initial, pendingUserMessages: [spec.initialMessage] }

  while (!signal.aborted && !state.shutdownRequested) {
    if (state.pendingUserMessages.length === 0) {
      task.state = 'idle'
      deps.bus.emit('task', { type: 'task.state', id: task.id, from: 'running', to: 'idle' })
      await waitForMessage(state, signal)
      task.state = 'running'
      deps.bus.emit('task', { type: 'task.state', id: task.id, from: 'idle', to: 'running' })
    }
    const next = state.pendingUserMessages.shift()!
    appendMessage(session, makeUserMessage(next))
    await runOneTurn(session, deps, tracker)            // existing AgentLoop, scoped
  }

  inboxOff()
  summarizer.stop()
}
```

Key behaviors:
- **Idle ↔ running transitions** are visible to the EventBus.
- **Plan-mode approval**: when the teammate calls `EnterPlanMode`, the runner sends a `plan_approval_request` envelope to the coordinator and parks the loop until a `plan_approval_response` arrives.
- **Shutdown protocol**: a `shutdown_request` envelope sets `state.shutdownRequested = true`; the loop drains the current turn then exits gracefully.
- **Background summarization**: every 30s `runForkedAgent` produces a 3-5 word "what is it doing now" summary; written to `tracker.setSummary()` which propagates via `task.progress`.

### 6.5 Coordinator-mode wiring — `src/core/agent/loop.ts` patch

```ts
// At loop start, when building the tool registry for THIS session:
let effectiveTools = registry.list()
if (isCoordinatorMode() && !session.isWorker) {
  // Lead in coordinator mode: keep only coordinator-internal tools.
  effectiveTools = effectiveTools.filter(t => COORDINATOR_INTERNAL_TOOLS.has(t.name))
} else if (isCoordinatorMode() && session.isWorker) {
  // Worker: drop coordinator-internal tools.
  effectiveTools = effectiveTools.filter(t => !COORDINATOR_INTERNAL_TOOLS.has(t.name))
}

// systemPrompt suffix injection:
if (isCoordinatorMode() && !session.isWorker) {
  systemPrompt += '\n\n' + buildCoordinatorContext(getCoordinatorUserContext({ tools: registry }))
}
```

`session.isWorker` is set to `true` when the session is created by `dispatchAgent` or `runTeammate`.

### 6.6 Pipeline DAG runner — `src/core/swarm/pipeline.ts` (new file)

```ts
export type PipelineNode = z.infer<typeof PipelineNodeSchema>
export type PipelineResult = { stages: StageResult[]; ok: boolean; failedAt?: string }

export async function runPipeline(opts: {
  input: PipelineInput
  deps: { teams: TeamRegistry; router: MessageRouter; agents: AgentRegistry; bus: EventBus; tasks: TaskManager }
  parentSession: Session
  signal: AbortSignal
}): Promise<PipelineResult>
```

Implementation outline:
1. Topo-sort nodes from `entry`.
2. For each level: spawn one `in_process_teammate` per node into the (ephemeral or named) team. Seed each with `prompt` + `{{prev}}` substitution.
3. Wait for level completion (each teammate emits `handoff` envelope when done).
4. Aggregate level outputs, advance to next level.
5. On any node's `task.state → failed`, abort sibling tasks with `requestShutdown` and return `{ ok: false, failedAt: nodeId }`.

### 6.7 Roundtable runner — `src/core/swarm/roundtable.ts` (new file)

```ts
export async function runRoundtable(opts: {
  input: RoundtableInput
  deps: { /* same as pipeline */ }
  parentSession: Session
  signal: AbortSignal
}): Promise<{ artifact: string; rounds: number; transcript: string }>
```

Steps:
1. Spawn each member as `in_process_teammate` with a role suffix in `systemPrompt`.
2. Round driver: in each round R, the runner sends every member a `Round R: react to peers` user message. They respond via `send_message` to the `*` broadcast. The router's `inbox.drain()` collects each member's outbound for that round.
3. After K rounds, the synthesizer is given the full transcript (concatenated) and produces the artifact via `runForkedAgent` (cache-reusing the team's parent prompt).
4. Returns the artifact + transcript; teammates are sent `shutdown_request`.

### 6.8 UDS backend skeleton — `src/core/messaging/udsBackend.ts` (new stub)

```ts
export class UdsBackend implements MessageBackend {
  readonly kind = 'uds' as const
  send(_envelope: MessageEnvelope): Promise<boolean> {
    return Promise.resolve(false)  // not implemented this phase
  }
  subscribe(_localAddress: string, _cb: (e: MessageEnvelope) => void): () => void {
    return () => {}                 // no-op
  }
}
```

Registered behind a feature flag `~/.nuka/config.yaml` `swarm.udsBackend: true` (default false).

### 6.9 Default role agent defs — `src/core/agents/builtin/`

Ship five built-in agent definitions used by `roundtable` defaults:

| Name | Description | Allowed tools |
|------|-------------|---------------|
| `core:planner` | Designs implementation steps; never writes code | `Read, Grep, Glob, ToolSearch, AskUserQuestion` |
| `core:skeptic` | Pushes back on plans; surfaces missing edge cases | `Read, Grep, Glob` |
| `core:researcher` | Searches codebase + docs; never writes | `Read, Grep, Glob, WebFetch, WebSearch` |
| `core:implementer` | Executes plan; full tool access | (default) |
| `core:reviewer` | Reads diffs, flags issues; read-only | `Read, Grep, Glob, Bash (ls/git only)` |

Stored in `src/core/agents/builtin/roles.ts` and registered at boot time.

## 7. Testing strategy

| Area | Test | Coverage |
|------|------|----------|
| `team_create` tool | unit | recursion guard + coordinator-mode gate + duplicate name |
| `team_delete` tool | unit | tear-down with `keep_tasks=true/false` |
| `send_message` tool | unit | name resolution; broadcast count; unknown target returns isError |
| `run-teammate.ts` | integration with fake provider | idle ↔ running; pending message dequeue; shutdown protocol drains turn |
| Plan-mode approval | integration | teammate parks until response; rejection sends back to revise |
| Coordinator-mode tool filter | unit on `loop.ts` | lead drops non-coord tools; worker drops coord-internal tools; non-coord mode = identity filter |
| `pipeline_run` | integration with 3-node DAG | level-sync execution; `{{prev}}` substitution; one-node failure aborts siblings |
| `roundtable` | integration with 3 members + synthesizer | K rounds run; synthesizer sees full transcript; teammates shut down cleanly |
| UDS backend stub | unit | `send` returns false; `subscribe` is no-op (no leak) |
| Recursion guards | unit | teammate calling `team_create` is rejected; teammate calling `dispatch_agent` is rejected (existing) |

CI gate: `npm run typecheck && npm test`. Bundle budget: foundation +50 KB (315 → 365 KB).

## 8. Milestones

| M | Subject | Touches |
|---|---------|---------|
| M1 | `team_create` / `team_delete` tools | `core/tools/builtin/team*.ts`, registry registration |
| M2 | `send_message` tool + address resolver | `core/tools/builtin/sendMessage.ts`, `core/messaging/addresses.ts` |
| M3 | `run-teammate.ts` full body + plan-mode protocol + 30s summarizer | `core/tasks/run-teammate.ts`, `core/agent/agentSummary.ts` |
| M4 | Coordinator-mode wiring in `loop.ts` | `core/agent/loop.ts`, system-prompt builder |
| M5 | Pipeline DAG runner + `pipeline_run` tool | `core/swarm/pipeline.ts`, `core/tools/builtin/pipelineRun.ts` |
| M6 | Roundtable runner + `roundtable` tool + 5 default role defs | `core/swarm/roundtable.ts`, `core/tools/builtin/roundtable.ts`, `core/agents/builtin/roles.ts` |
| M7 | UDS backend stub + config flag | `core/messaging/udsBackend.ts` |
| M8 | End-to-end demo test: coordinator spins a 3-node pipeline that uses a roundtable in stage 2 | `test/integration/phase14a-swarm.test.ts` |

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Plan-mode approval deadlocks if coordinator never responds | 5-minute timeout → auto-reject + structured error to teammate |
| Pipeline `{{prev}}` blows up when a level has 5+ nodes (huge concat) | Cap concatenation at 16 KB; truncate older entries; warn in stage output |
| Roundtable members spam each other and never converge | Hard-cap K rounds (default 3, max 8); no extension allowed |
| `*` broadcast accidentally hit by lead in coordinator mode (no `teamName`) | Tool returns isError with message "lead must use qualified address" |
| AsyncLocalStorage scope leakage across teammates | Each teammate gets its own `Session` object; no shared state by reference; integration test asserts isolation |
| 30s summarizer eats the prompt cache | Always uses `runForkedAgent`; budget tracked per fork in `forks/<parent>/<id>.json`; warning log if cache miss rate > 50% |
| Recursive `team_create` from a teammate via crafted tool call | Two independent guards: `session.allowedTeamCreate === false` AND coordinator-mode gate |

## 10. Open questions (deferred)

- UDS backend full implementation — likely phase14e if cross-session scenarios materialize
- Per-team permission policies (read-only vs. write teams) — defer until a concrete use case
- Pipeline retry-on-failure — would need a retry policy DSL; defer to user request
