# Phase 14d — Workflow harness: stage state machine + editor-in-chief agent

> **⚠ Superseded by:** `docs/plans/2026-05-01-harness-three-axis-refactor-design.md` (2026-05-01).
> The 7-class single-axis profile model defined here was replaced by a three-axis
> (profile × difficulty × testStrategy) model with a new `coordination/` layer for
> sub-task DAGs and event-driven a2a routing. Implementation lives on branch
> `worktree-refactor-harness-three-axis`. This document is retained as historical
> context.

**Date:** 2026-04-30
**Status:** Superseded
**Depends on:** `2026-04-30-phase14-foundation-design.md` (HarnessEvent + HarnessStage already reserved on the EventBus, forkedAgent for editor calls), `2026-04-30-phase14a-swarm-design.md` (the editor dispatches workers via the swarm primitives), `2026-04-30-phase14c-recap-design.md` (Recap stage emits a recap doc)
**Author:** Brainstorming session 2026-04-30

## 1. Problem

External workflow plugins (superpowers, trellis, agent-os) all share the same shortcoming the user explicitly flagged: **they default to TDD-first regardless of task profile, and lack a global view of what should actually happen**. They are libraries of skills, not orchestrators — when invoked they tend to push every task through `brainstorm → plan → TDD-implement`, which is wrong for:

- **Exploration / research** ("what does this codebase do?") — should not write tests
- **Bugfix / hotfix** — needs a *minimal repro* + targeted patch, not a fresh spec
- **Refactor** — needs a *test shield* + call-graph trace before changes
- **Documentation / config / styling** — TDD has nothing to verify
- **Multi-stage feature** — TDD inside *each* stage is fine, but the *outer* stage sequencing is what makes it work

Nuka's lead agent today has the same problem — it reaches for skills, executes them straight through, and sometimes commits to an interpretation before searching enough. It doesn't iterate, doesn't ask the user enough, doesn't reconsider.

Phase14d puts a **workflow harness** *inside Nuka itself*, with two halves agreed in brainstorm:

- **(a) Stage state machine** — hard gates between Brainstorm → Spec → Plan → Search → Implement → Review → Recap. Each stage has its own default skill set; the model cannot skip stages without an explicit fast-path bypass. This guarantees flow integrity (the part TDD-only frameworks miss).
- **(h) Editor-in-chief agent** — a long-running coordinator who *does not write code*. Its job: assign workers, audit their output, decide when a stage is done, decide whether to re-enter a stage, and ultimately drive the state machine. Stages are checkpoints; the editor is the navigator.

Together these solve the user's two complaints: "永远只是 TDD" (TDD-only) → state machine has stage-specific defaults that are NOT TDD; "缺少全局考虑" (lack of global thinking) → editor-in-chief is the global mind, with persistent memory and dispatch authority.

## 2. Goals

1. **HarnessStateMachine** — single in-memory state object for the current session: `{ currentStage, history, scratchpad, workerHandles, gates }`. Transition table is hard-coded; transitions emit `harness.stage.enter / harness.stage.exit` to the bus.
2. **Stage gate enforcement** — only certain stages can transition to certain other stages (no `Brainstorm → Implement` skip). Each gate has a programmatic check (`canTransition(from, to, ctx)`) that fails closed with a structured reason.
3. **Per-stage skill bundles** — each stage has its own default skill list and **its own forbidden skills**. Example: `Implement` requires TDD only when the *task profile* is `feature` or `bugfix`; `Explore` actively forbids the TDD skill. The skill bundle is computed by `pickSkillsForStage(stage, taskProfile)`.
4. **Editor-in-chief agent** — a built-in `core:editor` agent definition. The lead session in harness mode is **always** the editor; user requests flow through the editor, which dispatches workers and steers stages. Editor never holds the implement tools (uses coordinator-mode worker filter).
5. **Mandatory mid-stage primitives** — within every stage, the editor must (a) call `sequential_thinking_tool` (read-only thinking), (b) run at least one `search_and_verify` (codebase grep / web fetch / file read), (c) call `ask_user_question` at least once *if* the stage is one of `Brainstorm | Spec | Plan` *and* it has been entered for the first time. These are enforced as soft requirements: the editor's system prompt commits it; if violated the stage exit gate refuses with `"missing primitive: <name>"`.
6. **Task profile classifier** — first action of harness on a fresh user message is `classifyTaskProfile()` → `'explore' | 'fix' | 'refactor' | 'feature' | 'docs' | 'config' | 'research'`. Picked via small-fast-model fork on the user message (single-token classifier prompt). Profile pins which stages are mandatory vs. optional and which skills are bundled.
7. **Fast-path bypass** — `/harness fast` enters reduced mode (skips Brainstorm + Spec; goes straight to Search → Implement → Review). `/harness deep` (default for new task) walks the full state machine. `/harness off` disables the harness entirely (returns to phase11 behavior).
8. **Editor scratchpad** — a per-session markdown buffer at `~/.nuka/harness/<sessionId>.md`, holding the editor's running notes, decisions, and worker outputs. Persists across `/clear`. Read by every stage entry (the editor refreshes its global view from disk).
9. **Stage-Recap handoff** — at `Recap` stage entry, the harness automatically calls `/recap` (phase14c) and includes the resulting `RecapDoc` in the editor's scratchpad. This closes the loop: every harness session ends with a persisted recap.

## 3. Non-Goals

- ❌ No multi-session harness state (each session starts fresh; carryover happens via memdir, not harness state)
- ❌ No graph editing of stages; the state machine is hard-coded with one transition table per profile
- ❌ No automatic re-classification mid-session — the user must `/harness reset` to re-classify
- ❌ No replacement of the existing `dispatch_agent` tool — the editor uses it (and the swarm tools from phase14a) underneath
- ❌ No language-specific stage logic (the harness doesn't know about Python vs TypeScript; that's the worker's job)
- ❌ Mandatory-primitives enforcement is **soft, not hard** — gates check for evidence in scratchpad, not for tool-call records (a determined editor can still bypass; the goal is to bias behavior, not lock it)

## 4. High-level architecture

```
                        user input
                            │
                            ▼
              ┌─────────────────────────────────────┐
              │       Editor-in-chief Agent         │
              │  (always-on lead in harness mode)   │
              │  scratchpad: ~/.nuka/harness/*.md   │
              │  systemPrompt: stage-aware          │
              └────────────────┬────────────────────┘
                               │
                       enters / exits
                               ▼
              ┌─────────────────────────────────────┐
              │      Harness State Machine          │
              │   currentStage → next via gate      │
              │                                     │
              │  Brainstorm → Spec → Plan → Search  │
              │       ↑           ↘                 │
              │    (re-enter)       Implement       │
              │       ↑                ↓             │
              │       └─── Review ←────┘             │
              │              ↓                       │
              │            Recap                     │
              └────────────────┬────────────────────┘
                               │
                emits harness.stage.* on EventBus
                               │
              ┌────────────────▼────────────────────┐
              │ pickSkillsForStage(stage, profile)  │
              │ → effectiveSkills[]  + forbidden[]  │
              └─────────────────────────────────────┘

              ┌────────── Worker dispatch ──────────┐
              │ Editor uses phase14a swarm tools:   │
              │   - dispatch_agent                  │
              │   - team_create / send_message     │
              │   - pipeline_run / roundtable      │
              │ Workers do the writing; editor     │
              │ only directs and audits.           │
              └─────────────────────────────────────┘

              ┌────── Mid-stage primitives ────────┐
              │  sequential_thinking (read-only)   │
              │  search_and_verify (Grep/WebFetch) │
              │  ask_user_question (when applicable)│
              └────────────────────────────────────┘
```

**Profile-aware stage matrix** (mandatory ✅, optional ◯, forbidden ✗):

| Profile | Brainstorm | Spec | Plan | Search | Implement | Review | Recap |
|---------|------------|------|------|--------|-----------|--------|-------|
| explore   | ◯ | ✗ | ◯ | ✅ | ✗ | ◯ | ✅ |
| fix       | ◯ | ◯ | ✅ | ✅ | ✅ (TDD)| ✅ | ✅ |
| refactor  | ◯ | ✅ | ✅ | ✅ | ✅ (test shield first) | ✅ | ✅ |
| feature   | ✅ | ✅ | ✅ | ✅ | ✅ (TDD) | ✅ | ✅ |
| docs      | ◯ | ◯ | ◯ | ✅ | ✅ (no TDD) | ◯ | ✅ |
| config    | ◯ | ◯ | ◯ | ✅ | ✅ (no TDD) | ◯ | ✅ |
| research  | ✅ | ◯ | ◯ | ✅ | ✗ | ◯ | ✅ |

The matrix is the single source of truth for "what counts as a complete workflow for this kind of task". TDD is on for `fix / refactor / feature` only — directly answering the user's "永远只是 TDD" complaint.

## 5. Data schemas

### 5.1 Harness state

```ts
type TaskProfile = 'explore' | 'fix' | 'refactor' | 'feature' | 'docs' | 'config' | 'research'

type HarnessStage =
  | 'brainstorm' | 'spec' | 'plan' | 'search'
  | 'implement' | 'review' | 'recap'

type HarnessMode = 'deep' | 'fast' | 'off'

type StageEntry = {
  stage: HarnessStage
  enteredAt: number
  exitedAt?: number
  workersSpawned: { taskId: string; agentName: string }[]
  primitivesSeen: { sequentialThinking: boolean; searchAndVerify: boolean; askUser: boolean }
  exitReason?: 'completed' | 'aborted' | 'reentered' | 'fast-path-skipped'
}

type HarnessState = {
  sessionId: string
  mode: HarnessMode
  taskProfile: TaskProfile | null    // null until classifier runs
  currentStage: HarnessStage | null
  history: StageEntry[]
  scratchpadPath: string             // ~/.nuka/harness/<sessionId>.md
  startedAt: number
}
```

### 5.2 Skill bundle resolution

```ts
type StageSkillBundle = {
  required: string[]                  // skill names that auto-activate at stage entry
  optional: string[]                  // skill names available but not auto
  forbidden: string[]                 // skill names denied entirely (e.g. TDD in 'explore')
}

function pickSkillsForStage(stage: HarnessStage, profile: TaskProfile): StageSkillBundle
```

Default mappings (illustrative; finalised in M3):

| Stage | Required | Forbidden |
|-------|----------|-----------|
| brainstorm | `superpowers:brainstorming` | `tdd`, `simplify` |
| spec       | `superpowers:writing-skills` (for spec-writing) | `tdd` |
| plan       | `superpowers:writing-plans` | `tdd` (plan != tests yet) |
| search     | `loop` (for repeated searches), `claudeApi` (for context7-style doc lookup) | `tdd` |
| implement  | profile==`feature\|fix\|refactor` → `tdd`, `simplify`; profile==`docs\|config` → `simplify` only | — |
| review     | `superpowers:requesting-code-review` | `tdd` |
| recap      | (auto invokes `/recap`) | all |

### 5.3 Transition table

```ts
const transitions: Record<HarnessStage, HarnessStage[]> = {
  brainstorm: ['spec', 'plan', 'search'],         // can skip ahead in fast/profile
  spec:       ['plan', 'search', 'brainstorm'],   // back-edge to brainstorm
  plan:       ['search', 'implement', 'spec'],
  search:     ['implement', 'plan', 'recap'],     // recap if research-only
  implement:  ['review', 'search', 'plan'],
  review:     ['recap', 'implement'],
  recap:      [],                                 // terminal
}
```

Profile constraints: `transitions` is filtered by the profile matrix at runtime (e.g. `explore` profile cannot transition into `implement`).

### 5.4 Editor scratchpad markdown

```markdown
# Harness — <sessionId>
- Started: <ISO>
- Profile: feature
- Mode: deep

## Stage history
- ✅ brainstorm (12:00 → 12:08) — workers: planner, skeptic
- ✅ spec      (12:08 → 12:30) — wrote docs/.../<spec>.md
- ▶ plan      (12:30 → ⏳)

## Decisions log
- 12:05 (brainstorm) — chose discriminated union over enum (skeptic flagged)
- 12:25 (spec)       — defer auth refactor to phase15

## Worker outputs
- planner @ 12:02 → "3-step approach: …"
- skeptic @ 12:04 → "edge case: …"
- ...

## Open questions
- (none)
```

Editor reads the entire scratchpad at every stage entry as part of its context. Limit: 50 KB (truncated oldest-first).

### 5.5 HarnessEvent payloads (already in foundation)

```ts
type HarnessEvent =
  | { type: 'harness.stage.enter'; stage: HarnessStage; sessionId: string }
  | { type: 'harness.stage.exit'; stage: HarnessStage; sessionId: string; reason: string }
  | { type: 'harness.editor.directive'; sessionId: string; directive: string }
```

Phase14d adds emitters. Monitor (phase14b) already subscribes to this topic for the timeline view.

## 6. Component contracts

### 6.1 HarnessStateMachine — `src/core/harness/state.ts` (new)

```ts
export class HarnessStateMachine {
  constructor(opts: {
    sessionId: string
    bus: EventBus
    home: string
    mode?: HarnessMode
  })

  /** First action: classify the user message and pin profile. */
  async start(userMessage: string, deps: { provider: ProviderResolver }): Promise<TaskProfile>

  /** Returns transition decision: ok or refused with structured reason. */
  canTransition(to: HarnessStage): { ok: true } | { ok: false; reason: string }

  /** Performs the transition; emits events; updates scratchpad. */
  async transition(to: HarnessStage, reason?: string): Promise<void>

  /** Stage-exit gate: caller must have registered each required primitive. */
  recordPrimitive(name: 'sequentialThinking' | 'searchAndVerify' | 'askUser'): void

  /** Read state for UI / logs. */
  snapshot(): HarnessState

  /** Persist scratchpad markdown. */
  flushScratchpad(): Promise<void>
}
```

### 6.2 Profile classifier — `src/core/harness/classifier.ts` (new)

```ts
export async function classifyTaskProfile(opts: {
  userMessage: string
  provider: ProviderResolver
}): Promise<TaskProfile>
```

Implementation: small-fast-model `runForkedAgent` with system prompt:

> Classify this user request into ONE of: explore, fix, refactor, feature, docs, config, research. Reply with the single word, no explanation.

Falls back to `'feature'` (most general) if the model returns an unknown token after one retry.

### 6.3 Editor-in-chief agent def — `src/core/agents/builtin/editor.ts` (new)

```ts
export const editorAgent: BuiltinAgentDef = {
  name: 'core:editor',
  description: 'Workflow editor-in-chief. Holds global view, dispatches workers, never writes code directly.',
  systemPrompt: editorSystemPrompt,           // long; built from template + scratchpad
  allowedTools: [
    'dispatch_agent', 'team_create', 'team_delete', 'send_message',
    'pipeline_run', 'roundtable',
    'sequential_thinking', 'search_and_verify',  'ask_user_question',
    'recap',                                  // can invoke /recap programmatically
    'Read', 'Grep', 'Glob',                   // can audit, never write
    'task_create', 'task_update', 'task_list',
  ],
  deniedTools: [
    'Edit', 'Write', 'Bash',                  // hard deny — workers do the work
  ],
  maxTurns: 100,                              // long-running across stages
}
```

Editor system prompt skeleton (`src/core/harness/editorPrompt.ts`):

```
You are the workflow editor-in-chief. You DO NOT write code.
Your job is to navigate the workflow stages, dispatch workers, audit outputs, and decide when to advance.

Current stage: {{currentStage}}
Task profile: {{taskProfile}}
Mode: {{mode}}

Stage rules:
- {{stageRules}}

Mandatory primitives this stage:
- sequential_thinking before any worker dispatch
- search_and_verify at least once
- ask_user_question if this is your first entry into Brainstorm/Spec/Plan

Workers available:
- {{workerList}}

Scratchpad (your global view):
<scratchpad>
{{scratchpad}}
</scratchpad>

When this stage's work is complete, call transition_stage(<next>). Otherwise continue dispatching workers and reasoning.
Never call Edit/Write/Bash directly.
```

### 6.4 Mid-stage primitives — `src/core/harness/primitives.ts` (new)

Three new built-in tools, registered when harness mode != 'off':

- **`sequential_thinking`** — read-only thought tool. The model writes a chain-of-thought; the tool returns `{ ok: true, recorded: true }`. Used to force pause + reflection. Records `primitivesSeen.sequentialThinking = true`.
- **`search_and_verify`** — wrapper that dispatches a read-only researcher agent (or runs Grep+Glob+WebFetch directly for small queries). Records `primitivesSeen.searchAndVerify = true`.
- **`ask_user_question`** — same as the existing `AskUserQuestion` if available; if not, a minimal dialog tool that prints the question and waits for user input via the prompt. Records `primitivesSeen.askUser = true`.

```ts
defineTool<{}>({
  name: 'sequential_thinking',
  description: 'Record a thinking step. Returns immediately; the value is the act of thinking.',
  parameters: { type: 'object', properties: { thought: { type: 'string' } }, required: ['thought'] },
  source: 'builtin',
  needsPermission: () => 'none',
  async run(_input, ctx) {
    ctx.deps.harness?.recordPrimitive('sequentialThinking')
    return { output: 'thought recorded', isError: false }
  },
})
```

### 6.5 `/harness` slash command — `src/slash/harness.ts` (new)

```ts
const subcommands = ['deep', 'fast', 'off', 'reset', 'status', 'transition']

export const harnessCommand: SlashCommand = {
  name: 'harness',
  description: 'Control the workflow harness',
  async handler(ctx, args) {
    const sub = parseSub(args)               // see subcommands
    switch (sub.kind) {
      case 'deep':       return harness.setMode('deep')
      case 'fast':       return harness.setMode('fast')
      case 'off':        return harness.setMode('off')
      case 'reset':      return harness.reset()       // re-classify on next user msg
      case 'status':     return ctx.printAssistant(formatHarnessStatus(harness.snapshot()))
      case 'transition': return harness.transition(sub.to as HarnessStage, 'manual')
    }
  },
}
```

### 6.6 Boot integration — `src/cli.tsx` patch

```ts
import { HarnessStateMachine } from './core/harness/state'
import { editorAgent } from './core/agents/builtin/editor'

// after loading config:
const harnessMode = config.harness?.mode ?? 'deep'
const harness = new HarnessStateMachine({
  sessionId: session.id,
  bus: eventBus,
  home: os.homedir(),
  mode: harnessMode,
})

// register editor agent + harness primitives + /harness slash:
agentRegistry.register(editorAgent)
toolRegistry.register(sequentialThinkingTool(harness))
toolRegistry.register(searchAndVerifyTool(harness, deps))
toolRegistry.register(askUserQuestionTool(harness))
slashRegistry.register(harnessCommand)

// when harness is on, the lead session uses editor agent's def + system prompt.
if (harnessMode !== 'off') {
  session.leadAgent = editorAgent
}
```

### 6.7 Stage-Recap handoff — `src/core/harness/state.ts` extension

`transition('recap')` automatically:
1. Calls the `/recap` slash handler internally with `scope: { kind: 'full' }`.
2. Reads back the persisted recap markdown from `~/.nuka/recaps/...md`.
3. Appends to scratchpad under `## Final recap`.
4. Marks `currentStage = 'recap'`, `exitReason = 'completed'`.

### 6.8 Config schema additions

```yaml
harness:
  mode: deep              # deep | fast | off
  scratchpadKB: 50        # max scratchpad size before truncation
  forceTddProfiles: ['feature', 'fix', 'refactor']   # editable
```

## 7. Testing strategy

| Area | Test type | Coverage |
|------|-----------|----------|
| Profile classifier | unit + msw | each profile keyword maps; unknown → fallback to 'feature' |
| State machine transitions | unit | valid transition allowed; invalid refused with reason; profile matrix filters |
| Mandatory-primitive gate | unit | exit refused when sequentialThinking unrecorded; clean exit when all 3 seen |
| Skill bundle picker | unit | 'explore' profile → tdd in forbidden; 'feature' implement → tdd in required |
| Editor agent def | snapshot | allowedTools/deniedTools fixed shape; system prompt template fields valid |
| Sequential thinking tool | unit | records primitive; returns "thought recorded" |
| Search-and-verify tool | unit | dispatches researcher OR runs Grep — both record primitive |
| Ask-user-question tool | integration | prints to conversation; resolves on user input fixture |
| `/harness` slash | unit | each sub-command dispatches correctly; `transition` rejects invalid |
| Recap handoff | integration | transition('recap') invokes /recap and appends to scratchpad |
| Fast-path skip | integration | mode='fast' allows brainstorm → search; deep mode rejects same transition for `feature` |
| Editor never writes code | integration with fake provider | denied-tool calls produce isError; no Edit/Write/Bash actually fires |
| Scratchpad persistence | unit + tmpdir | written on every transition; read back on next stage entry; 50KB truncation |
| Bus event emission | unit | every transition emits stage.enter/exit; harness.editor.directive on dispatch |

CI gate: `npm run typecheck && npm test`. Bundle budget: full phase14 (a+b+c+d) ≤ 510 KB.

## 8. Milestones

| M | Subject | Touches |
|---|---------|---------|
| M1 | HarnessStateMachine + transition table + persistence | `core/harness/state.ts`, `core/harness/transitions.ts` |
| M2 | Profile classifier + small-fast-model fork | `core/harness/classifier.ts` |
| M3 | Skill bundle picker + per-stage defaults | `core/harness/skills.ts` |
| M4 | Three mid-stage primitives as built-in tools | `core/harness/primitives.ts`, `core/tools/builtin/*` |
| M5 | Editor-in-chief agent def + system prompt template | `core/agents/builtin/editor.ts`, `core/harness/editorPrompt.ts` |
| M6 | `/harness` slash command + status formatter | `slash/harness.ts`, `core/harness/format.ts` |
| M7 | Boot integration + Recap stage handoff + config schema | `cli.tsx`, `core/harness/state.ts` extension, `core/config/schema.ts` |
| M8 | End-to-end demo: feature profile walks all 7 stages with one worker dispatch + final recap | `test/integration/phase14d-harness.test.ts` |

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Classifier picks wrong profile and TDD fires when not wanted | `/harness reset` re-classifies; user can `/harness transition <stage>` manual override |
| Editor's denied tools (Edit/Write/Bash) confuse model into infinite loop trying to write | System prompt explicitly says "delegate via dispatch_agent"; tests assert isError doesn't loop |
| Stage-exit gate too aggressive (refuses legitimate work) | All gates fail with structured reason; `/harness transition` provides manual override |
| Editor scratchpad grows unboundedly | 50 KB cap with oldest-section eviction; on truncation a warning line appears in scratchpad |
| Mid-stage primitives spam the conversation | sequential_thinking output is collapsed in TUI (existing tool fold mechanism); no stdout pollution |
| Fast-path bypasses too much for `refactor` profile | Fast mode still mandates `Search` (test shield); only Brainstorm + Spec are skippable |
| Ask-user-question blocks progress when user is AFK | 5-min default timeout → editor proceeds with "(user did not respond)" recorded; configurable |
| Two harness instances in same process | Singleton pattern keyed by sessionId; second `new HarnessStateMachine` throws with the existing one's id |
| Recap stage handoff fails silently if /recap throws | Errors are caught and written to scratchpad as `## Final recap (FAILED): <reason>`; transition still completes |
| Profile matrix evolves and breaks existing tests | Matrix is data, not code — change requires updating §4 table + one fixture file; no scattered conditionals |

## 10. Open questions

- Whether to support per-project harness config (`<repo>/.nuka/harness.yaml`) overriding global — defer until users ask
- Whether to expose `harness.editor.directive` events to the user as TUI footnotes — likely yes, defer to phase14b polish
- Whether the editor itself should be allowed to call `Bash` for `git status` / `git diff` (audit-class commands) — current spec says no; revisit if real-world use shows it's painful
- Whether the editor agent should have its own dedicated model (e.g. Sonnet) vs. user's chosen model — defer to a per-stage model config in phase14d M7
- Whether to add an 8th stage `Verify` between Implement and Review — would address the user's "more iteration" wish but adds complexity; keep flexible by allowing Implement → Search re-entry instead
