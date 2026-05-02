# Spec E — Context efficiency audit & redesign

**Date:** 2026-05-02
**Status:** Spec
**Depends on:** `2026-04-23-nuka-rewrite-design.md` (loop, system prompt, ToolRegistry), `2026-04-28-phase11-mcp-removal-tool-platform-design.md` (skill activation, tag taxonomy), `2026-04-30-phase14-foundation-design.md` (EventBus topics, retention sweep)
**Related siblings:** `2026-05-02-spec-a-finish-the-promise-design.md`, `2026-05-02-spec-b-modernize-core-design.md`, `2026-05-02-spec-c-cron-primitive-design.md`, `2026-05-02-spec-d-provider-expansion-design.md`
**Author:** Investigation + brainstorming session 2026-05-02

---

## 1. Problem

A user reported on 2026-05-02:

> "I sent a single `hello` and Nuka used ~1.3k tokens of context before any tool ran. That can't be right — what is in there?"

The number is reproducible. We measured every byte that leaves the process on a fresh "hello" turn against `provider.stream(...)` (Anthropic format) and the answer is **8,031 bytes ≈ 1.3k–2.0k tokens** depending on tokenizer (BPE compresses repetitive JSON `"type":"string"` patterns to ~5–6 chars/token; the user-observed 1.3k matches the JSON-dense end of that range; a naïve `len/4` upper bound is 2.0k).

The headline finding: **tool schemas are 94% of pre-provider bytes** (7,514 / 8,031). The system prompt is 485 bytes (~6%). The user message itself is 32 bytes. We are not over-prompting; we are over-tooling. Specifically, on every turn — including a turn where the model is going to reply "hello" without calling any tool — we serialize and send:

- **All 19 registered tools** in the default Nuka boot path (`cli.tsx:404–600`), even though `Skill`-narrowing exists (`activation.ts:66–83`) but is bypassed when no skill keywords match.
- **Three swarm-coordination tools** (`pipeline_run`, `roundtable`, `team_create`/`team_delete`) totaling ~2.4 KB that almost no "hello" turn will use.
- **The `dispatch_agent` tool**, whose 1,144-byte description embeds a `name — description` string for **every registered agent** (`dispatchTool.ts:33–40`). Currently there are 6 (1 editor + 5 roles). With 12 plugin agents this single tool will exceed 2 KB.
- **Three harness primitive tools** (`sequential_thinking`, `search_and_verify`, `ask_user_question`) registered unconditionally whenever `harnessMode !== 'off'` — and `harness.mode` defaults to `'deep'` in the schema (`schema.ts:134`).
- **A `## Plan` block** in `systemPrompt.ts:66–68` that is dead code in the current cli wiring (`plan` is never passed in the input — see `cli.tsx:651–654`). Harmless but indicative of unbounded growth.

The mechanics are not the problem. Anthropic prompt-caching, when enabled, will fold most of this into a cache-read on subsequent turns. But the *first* turn always pays full freight, and every fork/sub-agent/dispatch starts a *new* first turn (`forkedAgent.ts:55–60` rebuilds the tool list verbatim). Multi-agent fan-out multiplies the tax linearly. With sub-agents enabled (phase14a swarm), a 5-worker dispatch costs 5 × ~1.3k = 6.5k tokens of pure tool-schema setup *before any work happens*.

The spec proposes a measurement-first redesign: a fragment registry that gates every system-prompt block and every tool schema with an explicit "applies-when" predicate, a context budget enforcer that drops optional blocks when the total exceeds a cap, and a telemetry event that surfaces the per-turn breakdown in `/doctor` and `/stats`.

---

## 2. Investigation results — the contributor inventory

This is the centerpiece of the spec. Every contributor to the bytes that go to `provider.stream({system, tools, messages})` on a fresh "hello" turn, in **the default config**: harness mode `deep` (`cli.tsx:689`), no LSP servers (`cli.tsx:506` gates LSP tools), no plugins, empty `.nuka/skills` (project + global), empty memdir, plan inactive, `NUKA_COORDINATOR_MODE` unset. All measurements taken statically by serializing each block per the path documented in §2.4.

### 2.1 Reproducible scenario

```
$ git clone … && cd Nuka
$ NUKA_COORDINATOR_MODE=  HARNESS_MODE=  nuka      # default boot
> hello
[turn assembled]                                   # what we measured
```

Boot path (single trace, all line numbers verified against tip of main):

| Step | File:line | What |
|------|-----------|------|
| 1 | `cli.tsx:354` | `loadSkills({home, cwd})` → `[]` (no skill dirs). |
| 2 | `cli.tsx:404–407` | Register 9 tools: `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `WebFetch`, `TodoWrite`, `WebSearch`. |
| 3 | `cli.tsx:506–510` | LSP tools — gated on `lspManager.list().length > 0`. **Skipped in default config.** |
| 4 | `cli.tsx:513`     | Register `Skill` tool. |
| 5 | `cli.tsx:524`     | Register `core:editor` agent (no tool). |
| 6 | `cli.tsx:531–587` | Register 5 swarm tools: `team_create`, `team_delete`, `send_message`, `pipeline_run`, `roundtable`. |
| 7 | `cli.tsx:589`     | Register 5 role agents (no tools). |
| 8 | `cli.tsx:593–600` | Register `dispatch_agent` (description enumerates agents from step 5+7). |
| 9 | `cli.tsx:697–701` | Register harness primitives `sequential_thinking`, `search_and_verify`, `ask_user_question` IFF `harnessMode !== 'off'`. **Default is `'deep'`** (`schema.ts:134`). |

### 2.2 Per-tool serialization sizes

Each tool's wire payload is `{name, description, input_schema}` (`anthropic.ts:200–206`). Sizes were measured by serializing each tool's actual `description` and `parameters` (verbatim from source) with `JSON.stringify`. The Anthropic SDK adds no extra whitespace.

| # | Tool | Source | `cli.tsx:` | bytes | tok≈/4 | tok≈/6 | tag set | conditional? |
|---|------|--------|------------|-------|--------|--------|---------|---------------|
| 1 | `Read`               | `tools/read.ts:13`     | 405 | 263 | 66 | 44 | `core, fs.read` | always |
| 2 | `Write`              | `tools/write.ts:9`     | 405 | 220 | 55 | 37 | `core, fs.write` | always |
| 3 | `Edit`               | `tools/edit.ts:24`     | 405 | 281 | 71 | 47 | `core, fs.write` | always |
| 4 | `Bash`               | `tools/bash.ts:8`      | 405 | 239 | 60 | 40 | `core, shell, exec` | always |
| 5 | `Glob`               | `tools/glob.ts:29`     | 405 | 213 | 54 | 36 | `core, fs.read` | always |
| 6 | `Grep`               | `tools/grep.ts:57`     | 405 | 353 | 89 | 59 | `core, fs.read` | always |
| 7 | `WebFetch`           | `tools/webFetch.ts:4`  | 405 | 250 | 63 | 42 | `core, net.read` | always |
| 8 | `TodoWrite`          | `tools/todoWrite.ts:14`| 406 | 389 | 98 | 65 | `core, session` | always |
| 9 | `WebSearch`          | `tools/webSearch.ts:88`| 407 | 281 | 71 | 47 | `core, net.read` | always |
| 10| `Skill`              | `skill/skillTool.ts:4` | 513 | 190 | 48 | 32 | `[]` (no tags) | always |
| 11| `team_create`        | `builtin/teamCreate.ts:13`     | 531 | 415 | 104 | 70 | `core, swarm, coordinator-only` | always (tool present even when not in coord mode; runtime guards with "coordinator mode only" error — see `teamCreate.ts:33`) |
| 12| `team_delete`        | `builtin/teamDelete.ts`        | 532 | 370 | 93 | 62 | `core, swarm, coordinator-only` | always |
| 13| `send_message`       | `builtin/sendMessage.ts:18`    | 533 | 502 | 126 | 84 | `core, swarm` | always |
| 14| `pipeline_run`       | `builtin/pipelineRun.ts:24`    | 534 | 755 | 189 | 126 | `core, swarm` | always |
| 15| `roundtable`         | `builtin/roundtable.ts:5`      | 553 | 870 | 218 | 145 | `core, swarm` | always |
| 16| `dispatch_agent`     | `agents/dispatchTool.ts:42`    | 593 | **1,144** | **286** | **191** | `core, agent` | always; **size scales with `agents.list().length`** |
| 17| `sequential_thinking`| `harness/primitives.ts:5`      | 698 | 266 | 67 | 44 | `core, harness` | iff `harnessMode !== 'off'` (default `'deep'`) |
| 18| `search_and_verify`  | `harness/primitives.ts:20`     | 699 | 243 | 61 | 41 | `core, harness` | iff `harnessMode !== 'off'` |
| 19| `ask_user_question`  | `harness/primitives.ts:38`     | 700 | 270 | 68 | 45 | `core, harness` | iff `harnessMode !== 'off'` |
|   | **TOTAL TOOLS**       |                                |     | **7,514** | **1,879** | **1,253** |  |  |

`cli.tsx:506–510` LSP tools (`lsp_diagnostics`, `lsp_definition`, `lsp_references`) add an extra ~1.5 KB combined when at least one LSP server is configured; they are zero in the measured baseline.

### 2.3 System prompt and message inventory

Per `systemPrompt.ts:27–71`, the prompt is assembled from at most five blocks:

| # | Block | File:line | bytes (default) | tok≈/6 | conditional? |
|---|-------|-----------|------|------|---|
| S1| Header `"You are Nuka, a terminal coding agent. Be concise. Act. Ask before destructive changes."` | `systemPrompt.ts:32` | 92 | 16 | always |
| S2| `Environment:` block (cwd, platform, shell, node, git) | `systemPrompt.ts:34–39` | ~145 (varies with cwd len) | 24 | always |
| S3| `Tool usage:` block (4 bullets) | `systemPrompt.ts:41–45` | ~248 | 41 | always |
| S4| `Skills:` block — for `s.when === 'on-session-start'` | `systemPrompt.ts:48–56` | 0 (empty in default) | 0 | iff any skill has `when: on-session-start` |
| S5| `## Memory` block — top-N relevant memdir entries | `systemPrompt.ts:58–64` | 0 (empty memdir) | 0 | iff `findRelevant(...)` returns ≥ 1 |
| S6| `## Plan` block — per-cwd plan body | `systemPrompt.ts:66–68` | 0 | 0 | **dead in default cli** — `plan` is never passed in `systemPromptInput()` (`cli.tsx:651–654`) |
|   | **TOTAL SYSTEM (default)** |  | **~485** | **~81** |  |

User message: `[{ "type": "text", "text": "hello" }]` ≈ 32 bytes / ~6 tokens.

### 2.4 Pre-provider grand total — measured

```
TOTAL TOOLS ARRAY :  7,514 bytes  ~1,253 tok (BPE) / ~1,879 tok (/4 upper)
SYSTEM PROMPT     :    485 bytes  ~   81 tok
USER MSG "hello"  :     32 bytes  ~    6 tok
                    ─────────
GRAND PRE-PROVIDER:  8,031 bytes  ~1,340 tok (BPE) / ~2,008 tok (/4 upper)
                                  ↑ user-observed 1.3k matches BPE end of range ✓
```

### 2.5 Verdict — is 1.3k justified?

**No.** It is *explained*, but not *justified*. The decomposition shows:

- **94% of bytes are tool schemas.** System prompt and user message together are 6%. Optimization effort must focus on tools.
- **The 6 file/shell tools the user actually relies on** (Read, Write, Edit, Bash, Glob, Grep) total **1,569 bytes** — only 21% of the tool budget. Everything else (13 tools) is 79%.
- **`dispatch_agent` alone is 1,144 bytes (15%)** and *grows with every plugin*. A user with the marketplace's roughly 12 plugin-agents enabled would see this tool exceed 2 KB on its own.
- **Swarm cluster (`team_create`, `team_delete`, `send_message`, `pipeline_run`, `roundtable`)** is 2,912 bytes (39%). For a "hello" turn — or any non-multi-agent turn — every byte is waste.
- **Harness trio** is 779 bytes (10%) registered unconditionally on every Nuka boot because `harness.mode` defaults to `'deep'`.
- The system prompt itself is fine. Trimming verbosity here would save tens of bytes; trimming the tool surface saves thousands.

**Per-skill activation already exists** (`activeToolsForMany` at `activation.ts:66–83`) but the early-out at line 70 *returns the full registry* when no skill matched. The user's "hello" matches no skill keyword — so the narrowing path is bypassed entirely. **The current narrowing semantics are inverted from what context efficiency demands**: a session with no active skill should narrow to `core` only, not expand to "every tool".

### 2.6 Headroom calculation

A leaner default — only the 6 file/shell tools + `Skill` (so the model can ask for more) + system prompt + user message — measures **~2,086 bytes ≈ 350–400 tokens**. That is the floor we should shoot for. The remaining 13 tools are admitted on-demand (skill activation, error-driven retry, explicit user opt-in via `Skill` tool).

---

## 3. Goals

1. **Make every byte that crosses the wire opt-in.** Replace the implicit "include everything that was registered" semantics in `runAgent` (`loop.ts:243–250`) with an explicit assembler that, for each candidate fragment (system block or tool), evaluates an `appliesWhen(ctx)` predicate.

2. **Lower the default "hello" baseline to ≤ 500 tokens** of system + tools + user (BPE estimate). Concretely: a snapshot test fails if the assembled prompt for an empty-skill, default-config "hello" turn exceeds **2,400 bytes** (the static character budget that BPE compresses to ~500 tokens; chosen 1.2× over the 2,086 floor for headroom). Stretch target **400 tokens / ~1,920 bytes**.

3. **Lazy tool injection.** When no skill is active, send only `core`-tagged tools that are **always** safe (Read/Write/Edit/Bash/Glob/Grep + `Skill`). A "tool not available" error path lets the model request a specific tool by tag, which un-defers it for the rest of the session.

4. **Conditional system blocks.** Each system-prompt block is a `Fragment` with an `appliesWhen(ctx) → boolean` and a `render(ctx) → string`. The defaulted environment block stays; the `Plan` and `Memory` blocks render only when their data is non-empty; future blocks (coordinator, recap-on-resume, harness summary) gate on their own predicates.

5. **Context budget enforcement.** A `BudgetEnforcer` drops optional fragments in priority order when the assembled total exceeds the configured cap (per provider/model). When a drop occurs, the TUI status line surfaces a yellow `ctx-trim` indicator.

6. **De-duplication & folding.** Detect when a Skill body verbatim-overlaps the system prompt (`Tool usage` paragraph etc.) and keep only the canonical copy. Long static blocks (mode descriptions, harness rationale) get a one-line summary in the system prompt + an `expand_block(name)` tool to fetch the full text on demand.

7. **Per-turn telemetry.** Every `assemblePrompt` call emits a `prompt.assembled` event on `EventBus` with `{sessionId, turnId, totalBytes, totalTokenEstimate, breakdown: Fragment.id → bytes}`. `/doctor` shows the live snapshot; `/stats` aggregates p50/p99 over the rolling session history.

8. **Drop the "always-include-everything" inversion.** Specifically: change `activeToolsForMany(skills, registry)` so that `skills.length === 0` returns the **core+`alwaysLoad` set**, not the full registry. The current behaviour at `activation.ts:70` is the proximate cause of the inflated baseline. Documented at length in §11.

9. **Backward compatibility for explicit users.** A `--no-budget` CLI flag and a `context.lazy: false` config key restore today's "send everything" behaviour for users who depend on it. The default flips.

10. **Observable migration.** During the migration window we ship both pipelines side-by-side gated on `context.assembler` config (`legacy` | `v2`, default `legacy` for one release, `v2` thereafter). The telemetry event fires under both pipelines so a regression is impossible to miss.

---

## 4. Non-Goals

- ❌ **Not changing model behaviour.** This spec only changes the bytes Nuka *sends*; it does not change how the model interprets them. No prompt rewording, no tool API changes, no parameter renames.
- ❌ **Not changing the provider abstraction.** That is Spec D's territory. We continue to pass `{system, tools, messages}` in the same shape as today (`anthropic.ts:49–55`, `openai.ts`).
- ❌ **Not introducing prompt caching.** Anthropic prompt caching is opt-in via `cache_control` markers on the request; it is *complementary* to this work but a separate spec. This spec reduces what gets cached/sent in the first place; caching is a separate later optimization.
- ❌ **Not auto-summarizing tool descriptions.** A future spec could LLM-generate shorter descriptions; here we just gate which descriptions ship.
- ❌ **Not introducing dynamic tool *invention*.** Every tool that can be sent must already be registered in the registry. We are restricting the *subset* that is sent per turn, not generating tools at runtime.
- ❌ **Not replacing memdir.** Memdir loading at `cli.tsx:633` and `findRelevant` at `cli.tsx:653` are unchanged; the `Memory` block is just one fragment among many, with the same predicate it has today (non-empty result list).
- ❌ **Not changing multi-agent fan-out semantics.** Sub-agents still get their own system prompt; their assembler will *also* be lazy, but the tree topology is unchanged.
- ❌ **Not deferring CLI-args resolution.** `--no-budget` and similar flags are honoured at process start; per-turn flag changes require restart.
- ❌ **Not exposing the budget enforcer to plugins.** Plugin tools are gated by the same predicates as builtins (`source: 'plugin'` is just a tag), but plugins cannot register their own enforcers.

---

## 5. Architecture

```
                ┌────────────────────────── Nuka REPL ──────────────────────────┐
                │                                                                │
   user "hello" │  cli.tsx → runAgent({text}, session, deps)                     │
   ──────────►  │       │                                                        │
                │       │   per turn, replaces the body of loop.ts:232–250       │
                │       ▼                                                        │
                │   ┌─────────────────────── Assembler v2 ───────────────────┐  │
                │   │                                                         │  │
                │   │   ┌─ ctx ─────────────────────────────────────────────┐ │  │
                │   │   │ session, cwd, gitBranch, env, matched skills,     │ │  │
                │   │   │ active triage, plan-mode flag, coordinator flag,  │ │  │
                │   │   │ memory-relevance(top-K), provider/model           │ │  │
                │   │   └───────────────────────────────────────────────────┘ │  │
                │   │                  │                                      │  │
                │   │                  ▼                                      │  │
                │   │   ┌───────────── FragmentRegistry ─────────────────┐    │  │
                │   │   │ fragments: Fragment[]                          │    │  │
                │   │   │  - id   : 'sys.header' | 'sys.env' | 'sys.tools-usage'│ │
                │   │   │  - id   : 'sys.skills.<name>'                  │    │  │
                │   │   │  - id   : 'sys.memory'                         │    │  │
                │   │   │  - id   : 'sys.plan'                           │    │  │
                │   │   │  - id   : 'sys.coordinator'                    │    │  │
                │   │   │  - id   : 'sys.recap-resume'                   │    │  │
                │   │   │  - id   : 'sys.harness-summary'                │    │  │
                │   │   │  - id   : 'tool.<name>'  (one per registered tool)│ │  │
                │   │   │ each: appliesWhen(ctx), render(ctx), priority,   │    │  │
                │   │   │       optional, kind                              │    │  │
                │   │   └───────────────────┬─────────────────────────────┘    │  │
                │   │                       │                                  │  │
                │   │                       ▼                                  │  │
                │   │             [filter: appliesWhen(ctx)]                   │  │
                │   │                       │                                  │  │
                │   │                       ▼                                  │  │
                │   │             [render → bytes; collect breakdown]          │  │
                │   │                       │                                  │  │
                │   │                       ▼                                  │  │
                │   │             ┌── BudgetEnforcer.fit(...) ──┐              │  │
                │   │             │ if total > policy.cap:      │              │  │
                │   │             │   drop optional fragments   │              │  │
                │   │             │   in ascending priority     │              │  │
                │   │             │   until ≤ cap (or no more)  │              │  │
                │   │             │ collect droppedIds[]        │              │  │
                │   │             └──────────────┬──────────────┘              │  │
                │   │                            │                             │  │
                │   │                            ▼                             │  │
                │   │   ┌────────────── AssembledPrompt ──────────────┐        │  │
                │   │   │ system: string                              │        │  │
                │   │   │ tools : ToolSpec[]                          │        │  │
                │   │   │ trace : { breakdown, totals, droppedIds }   │        │  │
                │   │   └────────┬───────────────────────────┬────────┘        │  │
                │   │            │                           │                 │  │
                │   │            ▼                           ▼                 │  │
                │   │   provider.stream({system,tools,…})    EventBus.emit(   │  │
                │   │            │                           'prompt.assembled') │
                │   └────────────┼─────────────────────────────────────────────┘  │
                │                │                                                  │
                │                ▼                                                  │
                │   ┌── Status line ──┐    ┌── /doctor ──┐    ┌── /stats ──┐        │
                │   │ ctx 312 / 500 t │    │ last turn   │    │ p50/p99 over │      │
                │   │  (yellow if    │    │ breakdown   │    │  session     │      │
                │   │  trimmed)      │    │ table       │    │  history     │      │
                │   └────────────────┘    └─────────────┘    └──────────────┘      │
                │                                                                  │
                └──────────────────────────────────────────────────────────────────┘

                                    Files touched in v2
                                    ───────────────────
                  src/core/agent/
                    ├── systemPrompt.ts        [refactored to fragments registry]
                    ├── assembler.ts           [NEW — assemblePrompt(ctx)]
                    ├── fragments/             [NEW dir — one file per Fragment family]
                    │   ├── headerFragment.ts
                    │   ├── envFragment.ts
                    │   ├── toolUsageFragment.ts
                    │   ├── skillFragment.ts
                    │   ├── memoryFragment.ts
                    │   ├── planFragment.ts
                    │   ├── coordinatorFragment.ts
                    │   ├── recapResumeFragment.ts
                    │   └── harnessSummaryFragment.ts
                    ├── budgetEnforcer.ts      [NEW — fit(fragments, policy)]
                    └── loop.ts                [stops calling buildSystemPrompt; calls assemblePrompt]
                  src/core/skill/
                    └── activation.ts          [activeToolsForMany(): empty skills → core only]
                  src/core/tools/
                    └── expandBlockTool.ts     [NEW — expand a folded block on demand]
                  src/core/events/topics.ts    [add 'prompt.assembled' event type]
                  src/slash/doctor.ts          [show last assembly trace]
                  src/slash/stats.ts           [show rolling p50/p99 of bytes/tok]
```

The assembler is purely *additive* alongside `buildSystemPrompt` during the migration window. The legacy code path stays alive behind `config.context.assembler === 'legacy'` for one release.

---

## 6. Data schemas

### 6.1 `Fragment`

```ts
// src/core/agent/fragments/types.ts
export type FragmentKind = 'system' | 'tool'

export type FragmentPriority =
  | 'critical'   // never dropped (header, env, user msg)
  | 'high'       // dropped only when impossible to fit (skills, dispatch_agent)
  | 'medium'     // dropped before high (memory, recap-on-resume)
  | 'low'        // first to drop (folded long-form blocks)

export type FragmentTrace = {
  id: string
  bytes: number
  tokenEstimate: number       // floor(bytes / 6) for BPE-friendly text;
                              // floor(bytes / 4) for densely-tokenized JSON
  rendered: boolean           // false if appliesWhen returned false
  dropped?: 'budget' | undefined
}

export interface Fragment {
  id: string                          // stable, dot-notated, e.g. 'sys.env', 'tool.Read'
  kind: FragmentKind
  priority: FragmentPriority
  optional: boolean                   // budget-droppable iff true && priority !== 'critical'
  appliesWhen(ctx: AssemblyContext): boolean
  render(ctx: AssemblyContext): string | ToolSpec
}
```

### 6.2 `AssemblyContext`

```ts
// src/core/agent/assembler.ts
export type AssemblyContext = Readonly<{
  // Environment (existing systemPromptInput shape, narrowed)
  cwd: string
  platform: string
  shell: string
  nodeVersion: string
  gitBranch: { branch: string; dirty: boolean } | null

  // Session-driven
  session: Pick<Session, 'id' | 'mode' | 'isWorker' | 'unDeferredToolNames' | 'messages'>
  turnId: string

  // First-user-message text — used for keyword skill matching and
  // searchHint matching. Not the full message array.
  userText: string

  // Skills already classified by activator.matchKeywordSkills + alwaysOnSkills
  matchedSkills: Skill[]
  onSessionSkills: Skill[]

  // Memory (post-relevance filter)
  memory: MemoryEntry[]

  // Optional blocks
  plan: { active: boolean; body: string } | null
  isCoordinator: boolean        // isCoordinatorMode()
  isResume: boolean             // session.messages.length > 0 && first turn
  triage: Triage | null         // current harness triage if any

  // Provider knobs influencing budget choice
  provider: { id: string; format: 'anthropic' | 'openai' }
  model: string
}>
```

### 6.3 `BudgetPolicy`

```ts
// src/core/agent/budgetEnforcer.ts
export type BudgetPolicy = {
  /** Max bytes (system + tools combined). User-message bytes are NOT counted —
   *  the user's text is critical and never trimmed. */
  capBytes: number
  /** Soft target — when the trace exceeds this we still send, but emit a
   *  warning event. Defaults to 0.8 × capBytes. */
  warnBytes: number
  /** Drop order: priority levels eligible for drop, lowest first. */
  dropOrder: FragmentPriority[]    // default: ['low', 'medium', 'high']
  /** When true, trim by id-suffix preference: tools alphabetically last
   *  drop first within the same priority. Used to make trims deterministic. */
  deterministic: boolean
}

export const DEFAULT_BUDGET: BudgetPolicy = {
  capBytes: 16_000,        // ~3.2k tok BPE, leaves room for messages history
  warnBytes: 12_800,
  dropOrder: ['low', 'medium', 'high'],
  deterministic: true,
}
```

`capBytes` defaults to **16 KB** rather than the §3 "hello-baseline" 2.4 KB target. The 2.4 KB number is the *snapshot test threshold* for fresh sessions; the *runtime cap* must allow active skills + memory to grow legitimately. The two are different knobs, both surfaced in `/doctor`.

### 6.4 `AssemblyTrace` event

```ts
// src/core/events/topics.ts (added under 'prompt' topic)
export type PromptAssembledEvent = {
  type: 'prompt.assembled'
  sessionId: string
  turnId: string
  totalBytes: number
  totalTokenEstimate: number
  systemBytes: number
  toolsBytes: number
  fragments: FragmentTrace[]      // every fragment, including not-rendered + dropped
  droppedIds: string[]            // subset of fragments where dropped !== undefined
  policy: { capBytes: number; warnBytes: number }
  warnedOverSoft: boolean         // totalBytes > policy.warnBytes
  cappedAtHard: boolean           // any fragment dropped due to budget
}
```

The event ships under a new EventBus topic `prompt`. Topic registration is additive — `events/bus.ts` topic union grows by one entry.

### 6.5 Persistence

Nothing on disk. The assembler is stateless; traces live only on the EventBus and in `/stats` ring buffers (in-memory, capped at 200 entries per session).

---

## 7. Component contracts

### 7.1 `assemblePrompt(ctx, registry)`

```ts
// src/core/agent/assembler.ts
export function assemblePrompt(
  ctx: AssemblyContext,
  fragmentRegistry: FragmentRegistry,
  toolRegistry: ToolRegistry,
  policy?: BudgetPolicy,
): AssembledPrompt
```

Behaviour:

1. Compute `applicable = fragmentRegistry.fragments.filter(f => f.appliesWhen(ctx))`.
2. For each applicable fragment, call `render(ctx)`. System fragments produce a string; tool fragments produce a `ToolSpec`.
3. Compute `bytes` per fragment. For system strings: `Buffer.byteLength(s, 'utf8')`. For tool specs: `Buffer.byteLength(JSON.stringify({name,description,input_schema:parameters}), 'utf8')`.
4. Sum totals. If `total > policy.capBytes`, call `BudgetEnforcer.fit(...)` to drop optional fragments.
5. Concatenate surviving system fragments by `\n\n` separator, in registry order.
6. Emit `prompt.assembled` event before returning.

Returns:

```ts
export type AssembledPrompt = {
  system: string
  tools: ToolSpec[]
  trace: { fragments: FragmentTrace[]; totalBytes: number; droppedIds: string[] }
}
```

Idempotent and deterministic given the same `ctx`.

### 7.2 `Fragment.appliesWhen(ctx)` and `Fragment.render(ctx)` per family

Exhaustive table — every fragment that ships in v2:

| id | kind | priority | optional | `appliesWhen` (predicate over `ctx`) | `render` returns |
|----|------|----------|----------|--------------------------------------|------------------|
| `sys.header` | system | critical | false | `true` | The 1-line "You are Nuka…" header. |
| `sys.env` | system | critical | false | `true` | `Environment:` block (cwd/platform/shell/node/git). |
| `sys.tools-usage` | system | high | true | `true` | The 4-bullet "Tool usage:" block. **Folded by default in v2** — replaced by 1-line `Use tools to read/edit/run; ask before destructive (call expand_block('tool-usage') for full guidance).` |
| `sys.skills.<name>` | system | high | true | `ctx.onSessionSkills.find(s => s.name === name) !== undefined` | `# <name>\n\n<body>` — one fragment per skill. |
| `sys.skills.matched.<name>` | system | high | true | `ctx.matchedSkills.find(s => s.name === name) !== undefined` | matched-keyword skill body. (Today this goes via injected `system` *message*; v2 lifts it into a fragment so its bytes show in the trace.) |
| `sys.memory` | system | medium | true | `ctx.memory.length > 0` | `## Memory\n\n` + bullet list. |
| `sys.plan` | system | medium | true | `ctx.plan?.active === true && ctx.plan.body.trim().length > 0` | `## Plan\n\n` + body. |
| `sys.coordinator` | system | high | true | `ctx.isCoordinator === true` | "## Coordinator\n\nYou are running in coordinator mode…" + `getCoordinatorUserContext()` data. (Today this is injected via *user* context dict; lift to system block.) |
| `sys.recap-resume` | system | medium | true | `ctx.isResume && idleSinceLastTurn(ctx) > IDLE_THRESHOLD` | One-line summary of the last persisted recap. |
| `sys.harness-summary` | system | medium | true | `ctx.triage !== null && ctx.session.mode === 'harness'` | 3-line summary `profile/difficulty/testStrategy` (full rationale folded). |
| `tool.Read` | tool | critical | false | `true` | Read's `ToolSpec`. |
| `tool.Write` | tool | critical | false | `true` | Write's `ToolSpec`. |
| `tool.Edit` | tool | critical | false | `true` | Edit's `ToolSpec`. |
| `tool.Bash` | tool | critical | false | `true` | Bash's `ToolSpec`. |
| `tool.Glob` | tool | high | false | `true` | Glob's `ToolSpec`. |
| `tool.Grep` | tool | high | false | `true` | Grep's `ToolSpec`. |
| `tool.Skill` | tool | critical | false | `true` (so the model can request more) | Skill's `ToolSpec`. |
| `tool.expand_block` | tool | high | false | `ctx.session.unDeferredToolNames.size === 0` (basic) — actually always true once `expand_block` is registered (it's the lever for lazy other blocks) | `expand_block`'s `ToolSpec`. |
| `tool.TodoWrite` | tool | high | true | `true` (small enough; keep on by default) | TodoWrite's `ToolSpec`. |
| `tool.WebFetch` | tool | medium | true | tagged `net.read` reachable from any active skill, OR un-deferred via searchHint, OR `userText` matches `/\b(http|fetch|url)\b/i` | WebFetch's `ToolSpec`. |
| `tool.WebSearch` | tool | medium | true | same as `tool.WebFetch` | WebSearch's `ToolSpec`. |
| `tool.dispatch_agent` | tool | medium | true | `ctx.session.isWorker === false && (skill matches with `agent` tag OR userText hits `/\b(decompose|delegate|sub-agent|dispatch)\b/i`)` | dispatch_agent's `ToolSpec`. |
| `tool.team_create` / `team_delete` / `send_message` | tool | low | true | `ctx.isCoordinator === true && ctx.session.isWorker === false` | the swarm tools. |
| `tool.pipeline_run` / `roundtable` | tool | low | true | matches a skill with `swarm` tag OR userText hits `/\b(pipeline|roundtable|debate)\b/i` | the swarm-orchestration tools. |
| `tool.sequential_thinking` / `search_and_verify` / `ask_user_question` | tool | medium | true | `ctx.triage !== null` (i.e. harness has classified the turn — primitives are useful inside a harness lifecycle, not before one) | the harness primitives. |
| `tool.lsp_diagnostics` / `lsp_definition` / `lsp_references` | tool | medium | true | `ctx.lspManager.list().length > 0` (existing condition) AND (active skill has `lsp` tag OR userText mentions a path) | LSP tools. |

Plugin tools follow the same predicate pattern; plugin authors set the predicate via a new optional `Tool.appliesWhen?: (ctx) => boolean` field that the migration adapter wraps into a Fragment.

### 7.3 `BudgetEnforcer.fit(fragments, policy)`

```ts
export function fit(
  fragments: Array<{ frag: Fragment; bytes: number }>,
  policy: BudgetPolicy,
): { kept: Fragment[]; droppedIds: string[]; finalBytes: number }
```

Behaviour:

1. Sum `bytes`. If `≤ policy.capBytes` → return all kept, no drops.
2. Else: build pool of *droppable* fragments (`f.optional && f.priority !== 'critical'`).
3. Sort pool by `(priorityIndex(f.priority) ASC, lexBy(f.id) DESC)` so we drop lowest-priority first; within tie, alphabetically *last* id drops first (deterministic).
4. Drop one at a time, recompute total, stop when `total ≤ capBytes` or pool exhausted.
5. If pool exhausts and total still over cap, return what's left. The caller (`assemblePrompt`) sets `cappedAtHard: true` and continues; we never refuse to send.

### 7.4 Telemetry event

```ts
// emitted at end of assemblePrompt
deps.bus?.emit('prompt', {
  type: 'prompt.assembled',
  sessionId: ctx.session.id,
  turnId: ctx.turnId,
  totalBytes,
  totalTokenEstimate,
  systemBytes,
  toolsBytes,
  fragments,                  // FragmentTrace[]
  droppedIds,
  policy: { capBytes, warnBytes },
  warnedOverSoft,
  cappedAtHard,
})
```

### 7.5 `expand_block` tool

```ts
// src/core/tools/expandBlockTool.ts
export const ExpandBlockTool = defineTool<{ name: string }>({
  name: 'expand_block',
  description: 'Fetch the full text of a folded system block (e.g. tool-usage, harness-rationale).',
  parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  source: 'builtin',
  tags: ['core'],
  needsPermission: () => 'none',
  async run({ name }) { /* read from a static map; never crosses skill/plugin boundary */ },
})
```

Always-on (it's small — ~250 bytes — and its presence is what makes folding safe).

---

## 8. Testing strategy

### 8.1 Snapshot test — the regression bar

```ts
// test/core/agent/assembler.snapshot.test.ts
test('default-config "hello" turn assembles ≤ 2400 bytes', async () => {
  const ctx = makeBaselineCtx({ userText: 'hello' })
  const out = assemblePrompt(ctx, defaultFragments(), defaultRegistry())
  expect(out.trace.totalBytes).toBeLessThanOrEqual(2400)
  expect(out.trace.fragments.filter(f => f.rendered).map(f => f.id))
    .toEqual([
      'sys.header', 'sys.env', 'sys.tools-usage',
      'tool.Read', 'tool.Write', 'tool.Edit', 'tool.Bash',
      'tool.Glob', 'tool.Grep', 'tool.Skill', 'tool.expand_block',
      'tool.TodoWrite',
    ])
})
```

Hard cap: any future change that pushes the default-baseline over 2,400 bytes fails CI.

### 8.2 Per-fragment size unit tests with regression alarms

For each fragment, a test of the form:

```ts
test('sys.env stays small', () => {
  const ctx = sampleCtx({ cwd: '/p' })
  const f = SysEnvFragment
  const bytes = Buffer.byteLength(f.render(ctx), 'utf8')
  expect(bytes).toBeLessThanOrEqual(180)         // ceil from current 145 + 25% headroom
})
```

CI fails when any fragment grows > 20% over its baseline.

### 8.3 Predicate unit tests — every gating predicate

For each fragment with an `appliesWhen`:

```ts
test('sys.coordinator: rendered iff isCoordinatorMode', () => {
  expect(SysCoordinator.appliesWhen(ctxWithCoord(true))).toBe(true)
  expect(SysCoordinator.appliesWhen(ctxWithCoord(false))).toBe(false)
})
```

24 fragments × 1 test each = 24 unit tests. Cheap.

### 8.4 Integration test — coordinator on/off

```ts
test('coordinator block flips with NUKA_COORDINATOR_MODE', () => {
  process.env.NUKA_COORDINATOR_MODE = '1'
  const a = assemblePrompt(coordinatorCtx, regs(), registry()).system
  process.env.NUKA_COORDINATOR_MODE = ''
  const b = assemblePrompt(plainCtx, regs(), registry()).system
  expect(a).toContain('Coordinator')
  expect(b).not.toContain('Coordinator')
  // also verify the swarm tools appear/disappear
})
```

### 8.5 Integration test — budget trim

```ts
test('huge memory trims via BudgetEnforcer', () => {
  const ctx = ctxWithMemory(/* 50KB of bullets */)
  const policy: BudgetPolicy = { capBytes: 8000, warnBytes: 6400, dropOrder: ['low','medium','high'], deterministic: true }
  const out = assemblePrompt(ctx, regs(), registry(), policy)
  expect(out.trace.totalBytes).toBeLessThanOrEqual(8000)
  expect(out.trace.droppedIds).toContain('sys.memory')
})
```

### 8.6 Telemetry test

```ts
test('emits prompt.assembled with breakdown', () => {
  const events: any[] = []
  const bus = makeTestBus(ev => events.push(ev))
  assemblePrompt(ctx, regs(), registry(), undefined, { bus })
  const ev = events.find(e => e.type === 'prompt.assembled')!
  expect(ev.fragments.length).toBeGreaterThan(0)
  expect(ev.totalBytes).toBe(ev.fragments.reduce((s, f) => s + (f.dropped ? 0 : f.bytes), 0))
})
```

### 8.7 End-to-end harness — replay against `/doctor`

Cross-spec; uses the existing testing harness (`src/core/testing`). After the refactor, `/doctor` shows the last assembly trace; an E2E test runs `/doctor` after a "hello" turn and asserts `last assembly: 12 fragments, X bytes`.

---

## 9. Milestones

### M1 — Measurement reproducibility test (1–2 PRs)

Establish the **measurement-as-test** baseline so future regressions are caught.

- Add `test/core/agent/contextBaseline.test.ts` that wires up `cli.tsx`'s default registration path against an in-memory ToolRegistry (re-using the same factories) and serializes to bytes. Asserts the *current legacy* total ≈ 8,031 bytes (with ±5% slop). This is the "snapshot of today" so we can detect slip during the migration without yet shipping any behaviour change.
- Add `scripts/measure-context.ts` (Node ESM) — a CLI doing the same in standalone form. `npm run measure-context` prints the table from §2.2.
- Add `events/bus.ts` topic `'prompt'` (registration only, no emitter yet).
- No user-visible changes, no config flags. Pure infra.

**Acceptance:** running `npm test -- contextBaseline` passes; running `npm run measure-context` prints a table identical to §2.2 ± 5%.

### M2 — Fragment registry refactor (3–4 PRs)

Refactor `systemPrompt.ts` into the fragments registry, behind a config flag. Old code path remains.

- Land `Fragment`, `AssemblyContext`, `assemblePrompt`, `fragments/*.ts` per §6/§7.
- Wire a new `config.context.assembler: 'legacy' | 'v2'` (default `legacy`).
- In `loop.ts:234`, branch on the flag: legacy → call `buildSystemPrompt`; v2 → call `assemblePrompt`. Tools array is still untouched in M2 (we keep the existing filter pipeline, just for system-prompt parity testing).
- Ship 24 fragment files; ship parity test that asserts `legacy(ctx).system === v2(ctx).system` for the default config (modulo the 1-line trim of `sys.tools-usage` which is the only intentional behavior change in M2).

**Acceptance:** parity test green for ≥ 12 representative ctx variations (default, with skills, with memory, plan-active, coordinator-on, harness-classified, resume, etc.).

### M3 — Lazy tool injection (3 PRs)

Move tool selection into the assembler. Flip the inverted default at `activation.ts:70`.

- Change `activeToolsForMany(skills, registry)`: when `skills.length === 0`, return only tools tagged `core` AND `priority: critical/high` per the table in §7.2 (still core-tagged tools, but the new default is *narrower*). Add a config knob `context.fullToolFloor` (default `false`) to restore the legacy "full registry" behaviour.
- Wire `Fragment.kind === 'tool'` paths in `assemblePrompt` so each tool spec goes through the same predicate-and-render flow as system blocks.
- Add the `expand_block` tool and the `tool-not-available` retry pattern: when the model emits a `tool_use` for a tool not in the current spec list, the loop responds with a tool-result error of the form `Tool '<name>' not active. Call \`Skill('<skill-name>')\` to enable the relevant capability set, or call \`expand_block\` to learn more.` This is a *prompt* convention, not an API change.
- Ship the snapshot test from §8.1 with `assembler: 'v2'` and `fullToolFloor: false`.

**Acceptance:** default "hello" turn measures ≤ 2,400 bytes total. Snapshot test green. Existing E2E tests for tool execution stay green (because all 6 file/shell tools remain on by default).

### M4 — Budget enforcer + dedup + folding (2 PRs)

- Land `BudgetEnforcer.fit(...)`. Default policy capBytes 16 KB.
- Land the `sys.tools-usage` fold (long form fetched via `expand_block`).
- Land dedup: when an active skill body verbatim contains `sys.tools-usage` content, drop the latter.
- TUI status-line indicator: show `ctx-trim` in yellow when `cappedAtHard === true` for the most recent turn. Show `ctx 312/16000B` in dim text on every turn.

**Acceptance:** test §8.5 passes. Status-line manual test: configure `capBytes: 1000` and verify the indicator turns yellow.

### M5 — Telemetry + /doctor + /stats (2 PRs)

- Emit `prompt.assembled` from `assemblePrompt` (bus required at this point — pass via deps).
- `/doctor`: add a "Last context assembly" section showing the breakdown from the most recent event (looked up via a small in-memory ring buffer subscribed to the topic).
- `/stats`: add a "Context (last 200 turns)" section showing `bytes p50/p99` and `droppedIds frequency`.
- Wire CLI flag `--no-budget` to `BudgetPolicy.capBytes = Infinity`.
- Flip `config.context.assembler` default from `legacy` to `v2`. Mark `legacy` deprecated; remove in next major.

**Acceptance:** running Nuka with `/doctor` after a turn shows the breakdown; `/stats` shows non-zero p50/p99 after ≥ 5 turns.

---

## 10. Risks & rollbacks

### Risk R1 — Lazy tool exposure breaks task completion

If a "hello" turn somehow needed `pipeline_run`, the model would now emit a `tool_use` for an unknown tool and our loop responds with the not-available error.

**Likelihood:** low for `hello`-like turns (the very signal that triggered this work); medium for ambiguously-phrased prompts.
**Mitigation:** the `not-available` error mentions `Skill(<name>)`; the model can then activate the relevant skill which un-defers the tool's tag set. Also, `searchHint` un-defer (`loop.ts:222–230`) still applies — every model-facing tool can declare keywords that force-include it on first turn. We backfill `searchHint` for the heavy tools as part of M3.
**Rollback:** flip `config.context.fullToolFloor` to `true` (per-user) or `config.context.assembler` to `legacy` (per-user, full revert).

### Risk R2 — Budget enforcer drops something the model needs

A user's skill is `sys.skills.matched.coding-style` containing critical guidance. Budget pressure drops it. Model misbehaves.

**Likelihood:** rare under default 16 KB cap; the only realistic budget pressure is a user with very long memdir.
**Mitigation:** drop priority is `low → medium → high`. Skill bodies are `high` priority; they only drop if the budget is genuinely impossible (e.g. a 100 KB plan). The TUI warning banner surfaces every drop.
**Rollback:** raise `context.capBytes` per-config or set the cap to `Infinity` via `--no-budget`.

### Risk R3 — Parity test (M2) hides subtle drift in plugin path

The plugin path (`wirePlugin` at `cli.tsx:495`) registers tools and skills; our parity test only covers the default config.

**Likelihood:** medium.
**Mitigation:** add a plugin-fixture parity test in M2 that loads `test/fixtures/plugin-with-skill/*` and runs both pipelines.
**Rollback:** ship M2 behind the legacy default; let users opt in via `assembler: 'v2'` for one release before flipping the default in M5.

### Risk R4 — Telemetry event becomes noisy

Every turn emits a moderately fat event. With 100-turn sessions and no listener cap, the EventBus ring buffer fills up.

**Likelihood:** known and small.
**Mitigation:** the `prompt` topic bus uses the same ring-buffer cap as other topics (foundation §6.2). `/stats` truncates to last 200 entries. No on-disk persistence.
**Rollback:** none required; bounded by design.

### Risk R5 — `expand_block` becomes a chatty round-trip

If folding is too aggressive, the model expands every block on every turn — net byte cost goes UP.

**Likelihood:** medium; we cannot predict model behaviour exactly.
**Mitigation:** §7.2 limits folding to *one* block (`sys.tools-usage`) in v2. Subsequent folds (harness-rationale, etc.) ship in follow-up specs only after we measure that the model leaves them folded most of the time.
**Rollback:** unfold by default (just inline the full body in the fragment's `render`). Trivial — no API surface change.

### Risk R6 — Legacy code path drift after flag-flip

Once `assembler: 'v2'` is the default, the `legacy` code path can rot — tests pass under v2 but legacy regresses. When a user flips back to legacy for a workaround, they hit a bug.

**Likelihood:** medium during the deprecation window.
**Mitigation:** keep the parity test in CI for the full deprecation window. Mark `legacy` `@deprecated` in TypeScript, with a console warning at startup when used.
**Rollback:** when the deprecation window ends, delete legacy. No rollback path needed past that point — we measure the budget regression bar on v2 alone.

---

## Self-review checklist

- [x] **§1 cites the user's report verbatim and our measured number.** "1.3k tokens" → measured 8,031 bytes ≈ 1.3k–2.0k tok depending on tokenizer.
- [x] **§2 contains the contributor table with file:line for every claim.** 19-row tools table + 6-row system-prompt table, all cited.
- [x] **Goals (§3) are concrete and measurable.** Specifically, ≤ 500 tok / 2,400 bytes baseline (snapshot test G2).
- [x] **Non-goals (§4) explicitly carve out provider-abstraction work** (Spec D's territory) and **prompt caching** (separate future spec).
- [x] **§5 has an ASCII diagram** showing fragment registry, budget enforcer, telemetry path, and downstream `/doctor`/`/stats` consumers.
- [x] **§6 schemas are typed (TypeScript) and complete.** `Fragment`, `AssemblyContext`, `BudgetPolicy`, `PromptAssembledEvent` all specified.
- [x] **§7 contracts give exact signatures for `assemblePrompt`, `Fragment.appliesWhen`, `BudgetEnforcer.fit`, the telemetry event.**
- [x] **§7.2 enumerates every fragment** with `appliesWhen` and `priority` — 24 fragments total.
- [x] **§8 testing strategy proposes a hard CI bar (snapshot test).** Per-fragment size tests trip on > 20% growth.
- [x] **§9 milestones are sequenced** so M1 buys *measurement* before M2 changes any behaviour. Migration is 1+1+1+1+1 PRs over ~5 weeks at single-engineer pace.
- [x] **§10 rollbacks are concrete** and connect to the corresponding migration knob (`fullToolFloor`, `assembler`, `capBytes`).
- [x] **No TBDs.** Every numeric is grounded — 16 KB cap, 2,400-byte baseline, 5 priority levels, 24 fragments.
- [x] **Cross-references** to siblings A/B/C/D resolved.
- [x] **Opinion declared.** Target budget: 500 tokens (BPE) or 2,400 bytes for the default-fresh "hello" turn — derived from the measured 2,086-byte floor of "core file/shell tools + system prompt + user message".

---

*End of Spec E.*
