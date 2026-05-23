# Nuka Objective Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` before implementing the checklist below. Keep each checked item tied to a test or a captured TUI frame.

**Goal:** finish the current usability/provider fixes, then move Nuka toward Nuka-Code/Codex-class subagents, compacting, feature parity, and a cleaner interactive TUI.

**Architecture:** treat this as four independently verifiable tracks: current bugfix hardening, subagent parity, compact parity, and TUI interaction redesign. Do not mix large migrations into small provider/statusline fixes; each track should land with focused tests and screenshots/harness frames where UI is involved.

**Known Local Sources:**
- Nuka current implementation: `/data/xtzhang/Nuka`
- Nuka-Code reference: `/data/xtzhang/Nuka-Code`
- claude-status reference: `/tmp/claude-status` if already cloned; clone through `http://192.168.2.185:7897` if missing.
- Codex reference: `/tmp/openai-codex` at commit `7d47056ea42636271ac020b86347fbbef49490aa`.
- Upstream feature intake: `docs/plans/2026-05-23-upstream-feature-intake.md`.

---

## Track 0 - Current Bugfix Hardening

- [x] Custom OpenAI-compatible providers use the Responses API path, not chat completions.
  - Primary files: `src/core/provider/openai.ts`, `test/core/provider/openai.test.ts`
  - Acceptance: custom base ending in `/v1` posts to `/v1/responses`; custom base without `/v1` falls back from `/responses` to `/v1/responses` on 404; Responses text/tool-call streams translate into Nuka provider events.

- [x] Scrollback recognizes raw terminal PageUp/PageDown/Home/End escape sequences.
  - Primary files: `src/tui/App.tsx`, `src/tui/PromptInput/PromptInput.tsx`, `test/tui/app.test.tsx`
  - Acceptance: PageUp scrolls older messages and the raw `[5~` bytes are not inserted into the prompt.

- [x] Statusline is simplified toward the claude-status style.
  - Primary files: `src/tui/Status/StatusPanel.tsx`, `test/tui/Status.harness.test.tsx`
  - Acceptance: idle status omits noisy `[idle]`; the default statusline is one calm row; provider display prefers configured provider name over internal id; counts/cost only appear when useful.

- [x] Custom provider `id` is derived from the configured provider name instead of staying `custom` / `custom-2` by default.
  - Primary files: `src/core/onboarding/wizard.ts`, `src/core/onboarding/templates.ts`, `test/core/onboarding/wizard.test.ts`
  - Acceptance: a custom provider named `Xiaomi Mimo` persists as provider id `xiaomi-mimo` and display name `Xiaomi Mimo`.

- [x] Run final focused verification for the current bugfix set.
  - Command: `npm test -- test/core/provider/openai.test.ts test/core/provider/openai.image.test.ts test/core/onboarding/wizard.test.ts test/core/onboarding/probe.test.ts test/tui/app.test.tsx test/tui/Status.harness.test.tsx test/tui/planModeBadge.test.tsx test/tui/PromptInput.cursorAnsi.test.tsx test/tui/Layout.harness.test.tsx test/tui/Submenu.harness.test.tsx test/tui/UIState.harness.test.tsx test/tui/SlashCard.harness.test.tsx`
  - Command: `git diff --check`
  - Note: full `npm run typecheck` currently exposes unrelated pre-existing test type errors outside this bugfix slice; fix in a separate baseline-test track.

---

## Track 1 - Nuka-Code Subagent Parity

Reference files in Nuka-Code:
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/AgentTool.tsx`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/runAgent.ts`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/resumeAgent.ts`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/forkSubagent.ts`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/agentMemory.ts`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/agentMemorySnapshot.ts`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/agentDisplay.ts`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/agentColorManager.ts`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/built-in/*.ts`

Current Nuka files:
- `src/core/agents/dispatch.ts`
- `src/core/agents/dispatchTool.ts`
- `src/core/agents/subagentLoader.ts`
- `src/core/agents/registry.ts`
- `src/core/agents/coordinator/*`
- `src/tui/Tasks/*`

Checklist:
- [x] Build a parity matrix between Nuka-Code `AgentTool` features and current Nuka `dispatch_agent`.
  - Reference: `/data/xtzhang/Nuka-Code/src/tools/AgentTool/AgentTool.tsx`, `runAgent.ts`, `resumeAgent.ts`, `forkSubagent.ts`, `loadAgentsDir.ts`, `agentMemory.ts`
  - Current Nuka: `src/core/agents/dispatchTool.ts`, `src/core/agents/dispatch.ts`, `src/core/agents/subagentLoader.ts`, `src/core/tasks/*`, `src/core/worktree/*`
  - Parity matrix:
    | Capability | Nuka-Code behavior | Current Nuka status | Next Nuka action |
    | --- | --- | --- | --- |
    | Agent definitions | Markdown/JSON agents with tools, disallowedTools, model, effort, permissionMode, mcpServers, hooks, maxTurns, skills, memory, background, isolation | Partial: YAML/JSON/Markdown loader supports tools/disallowedTools alias, model, maxTurns, maxTokens, temperature, keywords, memory, isolation, background | Add `skills`, `permissionMode` only if corresponding Nuka runtime support exists; keep unsupported keys rejected until implemented |
    | Synchronous subagents | `AgentTool` can run foreground and return final result with usage/tool count | Present: `dispatch_agent` runs isolated sub-session and returns final output/usage internally | Keep as baseline; expose richer metadata later only if model benefits |
    | Background subagents | `run_in_background` / agent `background` registers stable `agentId`, returns output file and can be queried later | Present foundation: `spawn_agent` wraps `dispatchAgent` in `TaskManager.enqueue(local_agent)`, returns `task_id`/`agent_id`/output file; agent definitions can mark `background: true`; `/task run` remains separate | Add richer progress metadata next |
    | Task output/stop | Output and kill by async agent id/output path | Present foundation: `TaskOutput`/`TaskStop` address by task id or stable `agent_id`; `wait_agent`/`close_agent` expose agent-oriented aliases | Keep behavior centralized in task tools while adding resume/send later |
    | Resume | `resumeAgentBackground(agentId, prompt)` reloads transcript/metadata/worktree, appends prompt, relaunches async | Foundation: `resume_agent` can relaunch the latest local-agent execution under the same `agent_id` and inherited task metadata; full transcript/worktree reconstruction still missing | Persist subagent transcript + metadata before upgrading `resume_agent` to true stateful resume |
    | Fork | Omitted subagent type can inherit parent context/system prompt/tools; cache-friendly placeholders; recursive fork guard | Missing: no fork context support; existing recursion guard only blocks dispatch inside sub-session | Add explicit `fork_context` option after transcript capture and prompt-cache policy are designed |
    | Worktree/cwd isolation | Agent input supports `isolation: worktree` and `cwd`; worktree cleanup/keep-on-change | Foundation: `spawn_agent` can create a tracked git worktree on request; agent definitions can default to `isolation: worktree`; dispatch/resume preserve captured cwd | Add cleanup/keep-on-change policy and richer write-scope controls |
    | Tool filtering | Tool allow/deny, async-safe restrictions, Agent(...) allowed-agent narrowing, MCP tools | Partial: Nuka has allow/deny filtering and dispatch recursion guard | Add async-safe filtering for background subagents before exposing background spawn broadly |
    | Frontmatter hooks/MCP/skills | Agent-specific MCP servers, hooks, skill preload | Missing in Nuka agent runtime | Defer; implement after core spawn/resume/fork is stable |
    | Agent memory | user/project/local persistent memory prompt per agent type | Foundation: loose-file and plugin agent schemas accept `memory`; dispatch appends agent-scoped memory prompts and memory-enabled allowlists gain Read/Write/Edit | Add snapshot sync and richer memory-file recall later if needed |
    | Progress/UI | Foreground progress, auto-background hint, background notifications, summaries, color display | Partial: TUI renders dispatch calls/tasks; no subagent progress summaries | Add minimal task progress metadata first, then TUI polish |
- [x] Add Nuka-Code-style markdown/frontmatter subagent definitions to Nuka's loose-file loader.
  - Primary files: `src/core/agents/subagentLoader.ts`, `test/core/agents/subagentLoader.test.ts`
  - Acceptance: `.nuka/subagents/*.md` files with `name` / `description` frontmatter and markdown body load as subagents; `tools: "*"` means all tools; `disallowedTools` maps to Nuka's `deniedTools`; ordinary markdown docs are ignored during directory scans.
- [x] Add Nuka-Code-style persistent memory frontmatter for subagents.
  - Primary files: `src/core/agents/subagentLoader.ts`, `src/core/agents/types.ts`, `src/core/agents/agentMemory.ts`, `src/core/agents/dispatch.ts`, `test/core/agents/subagentLoader.test.ts`, `test/core/agents/dispatch.test.ts`
  - Acceptance: loose-file and plugin agents can declare `memory: user | project | local`; memory-enabled agents append a scoped `Persistent Agent Memory` prompt to provider-visible system instructions; explicit tool allowlists gain `Read`, `Write`, and `Edit` so the agent can maintain its memory files; memory prompt load failures are best-effort and fall back to the base system prompt.
- [x] Add stable local subagent `agentId` metadata to the background task runtime.
  - Primary files: `src/core/tasks/types.ts`, `src/core/tasks/manager.ts`, `src/core/tasks/meta.ts`, `src/core/tasks/outputTool.ts`, `src/tui/Tasks/columnReducer.ts`
  - Acceptance: every `local_agent` task gets a stable `agent-<task id>` identity unless the caller supplies one; `TaskOutput` prints `agent_id=...`; task metadata persists it; TUI task columns classify local agents as subagents and retain the agent id for lookup.
- [x] Allow task tools to address local subagent executions by stable `agent_id`.
  - Primary files: `src/core/tasks/lookup.ts`, `src/core/tasks/outputTool.ts`, `src/core/tasks/stopTool.ts`, `test/core/tasks/outputTool.test.ts`, `test/core/tasks/stopTool.test.ts`
  - Acceptance: `TaskOutput` and `TaskStop` accept `agent_id` when `task_id` is omitted, choose the newest matching execution record, keep `task_id` / `shell_id` precedence, and report clear unknown-agent errors.
- [x] Add a minimal public `spawn_agent` API for background subagents.
  - Primary files: `src/core/agents/spawnTool.ts`, `src/cli.tsx`, `test/core/agents/spawnTool.test.ts`
  - Acceptance: `spawn_agent` validates agent names, refuses recursive subagent spawning, enqueues a `local_agent` task whose runner executes `dispatchAgent`, and returns `status=spawned`, `task_id`, `agent_id`, `agent`, `description`, and `output_file`.
- [x] Add `wait_agent` and `close_agent` aliases over the task runtime.
  - Primary files: `src/core/agents/agentLifecycleTools.ts`, `src/cli.tsx`, `test/core/agents/agentLifecycleTools.test.ts`
  - Acceptance: `wait_agent` delegates to `TaskOutput` with `block=true`; `close_agent` delegates to `TaskStop`; both prefer `agent_id` while allowing `task_id` as a compatibility escape hatch.
- [x] Add a foundation `resume_agent` API over local-agent task metadata.
  - Primary files: `src/core/agents/agentLifecycleTools.ts`, `src/core/agents/spawnTool.ts`, `src/core/tasks/types.ts`, `src/cli.tsx`, `test/core/agents/agentLifecycleTools.test.ts`, `test/core/agents/spawnTool.test.ts`
  - Acceptance: `resume_agent` accepts `agent_id` and follow-up `prompt`, selects the newest matching local-agent task, rebuilds a fresh `dispatchAgent` runner from the current registered agent definition, enqueues a new local-agent execution with the same stable `agent_id`, inherited agent name/provider/model/context metadata, `resumed: true`, and returns `status=resumed`, new `task_id`, `agent_id`, source task id, and output file.
  - Limitation: this is not yet Nuka-Code-equivalent true resume; it does not reconstruct full provider-visible transcript or content replacement state.
- [x] Persist local-agent resume metadata into task sidecars.
  - Primary files: `src/core/tasks/meta.ts`, `test/core/tasks/meta.test.ts`
  - Acceptance: `fromTask()` writes local-agent `agentName`, follow-up task prompt, merged context, `resumed`, provider id, and model to `<task>.meta.json`, so future cross-process resume work has a metadata baseline.
- [x] Let `resume_agent` recover the latest matching local-agent sidecar when the original task is not in memory.
  - Primary files: `src/core/agents/agentLifecycleTools.ts`, `src/core/tasks/meta.ts`, `src/cli.tsx`, `test/core/agents/agentLifecycleTools.test.ts`, `test/core/tasks/meta.test.ts`
  - Acceptance: `resume_agent` first checks the in-memory task table, then falls back to the newest `<task>.meta.json` with the requested `agent_id`, rebuilds a fresh runner from the current registered agent definition, preserves provider/model/context metadata, and reports the persisted source task id in `resumed_from`.
- [x] Persist in-flight local-agent task metadata as soon as a background subagent starts.
  - Primary files: `src/core/tasks/manager.ts`, `test/core/tasks/manager.test.ts`
  - Acceptance: immediately after `TaskManager.enqueue(local_agent)`, `<task>.meta.json` exists with `state: "running"`, stable `agentId`, agent name, prompt, context, provider id, and model; later transitions continue refreshing the same sidecar.
- [x] Persist local-agent final output into task sidecars after completion.
  - Primary files: `src/core/tasks/meta.ts`, `test/core/tasks/manager.test.ts`
  - Acceptance: terminal local-agent sidecars include a bounded `finalOutput` snapshot from the task log, giving later resume/listing work a direct final-result lookup without re-reading the output file first.
- [x] Let `TaskOutput` / `wait_agent` recover completed local-agent output from sidecars.
  - Primary files: `src/core/tasks/outputTool.ts`, `src/cli.tsx`, `test/core/tasks/outputTool.test.ts`
  - Acceptance: when `agent_id` is not present in the in-memory task table, `TaskOutput` falls back to the newest matching local-agent sidecar and returns its `finalOutput` using the same task metadata text format; interactive `wait_agent` inherits this through the registered `TaskOutput` tool.
- [x] Decide the public API shape for `fork/send` before implementation.
  - Decision: add `send_agent` as a user-facing alias for the current lightweight `resume_agent` semantics: `{ agent_id, message, context?, description? }` enqueues a new background `local_agent` execution under the same stable `agent_id`, with `message` normalized to the existing follow-up `prompt`.
  - Decision: extend `spawn_agent` with explicit `fork_context?: boolean` rather than overloading missing `agent`; the first implementation may reject `fork_context: true` with a clear unsupported error until parent transcript capture is available.
  - Decision: keep true fork/resume state separate from the alias: true fork must inherit parent transcript/system/tool context and eventually worktree state; true send must recover transcript when available, but can initially share `resume_agent` metadata fallback.
  - Acceptance for first code iter: `send_agent` delegates to the same task metadata/path as `resume_agent`, preserves `agent_id`, accepts `message` instead of `prompt`, and is registered in CLI.
- [x] Add `send_agent` follow-up alias over the local-agent task runtime.
  - Primary files: `src/core/agents/agentLifecycleTools.ts`, `src/cli.tsx`, `test/core/agents/agentLifecycleTools.test.ts`
  - Acceptance: `send_agent` accepts `{ agent_id, message, context?, description? }`, preserves the stable `agent_id`, merges prior and new context, enqueues a resumed `local_agent` execution, reports `status=sent` and `sent_to=<source task>`, and is registered by the CLI.
- [x] Add `send_input` compatibility alias over the local-agent task runtime.
  - Primary files: `src/core/agents/agentLifecycleTools.ts`, `src/cli.tsx`, `test/core/agents/agentLifecycleTools.test.ts`
  - Acceptance: `send_input` accepts `{ agent_id, input, context?, description? }`, preserves the stable `agent_id`, enqueues the same follow-up path as `send_agent`, reports `status=sent` and `sent_to=<source task>`, and is registered by the CLI.
- [x] Add explicit `fork_context` input to `spawn_agent`.
  - Primary files: `src/core/agents/spawnTool.ts`, `test/core/agents/spawnTool.test.ts`
  - Acceptance: `spawn_agent(..., fork_context: true)` injects a summarized parent-session context into the child task context and preserves explicit caller context; schema text describes the lightweight fork accurately.
- [x] Add resumable subagent state, including final output lookup and in-flight task metadata.
  - Primary files: `src/core/tasks/meta.ts`, `src/core/tasks/manager.ts`, `test/core/tasks/meta.test.ts`, `test/core/tasks/manager.test.ts`
  - Acceptance: local-agent task sidecars persist in-flight metadata, terminal `finalOutput`, and a `<task>.transcript.json` baseline containing the user task/context and assistant final output for future true resume/fork reconstruction.
- [x] Let `resume_agent` / `send_agent` include persisted transcript context when available.
  - Primary files: `src/core/agents/agentLifecycleTools.ts`, `test/core/agents/agentLifecycleTools.test.ts`
  - Acceptance: persisted local-agent resumes read `<task>.transcript.json`, include the previous user/assistant transcript summary in the follow-up context, and still fall back to meta-only context when the transcript sidecar is missing.
- [x] Persist and recover local-agent cwd/worktree metadata for resume.
  - Primary files: `src/core/tasks/types.ts`, `src/core/tasks/meta.ts`, `src/core/agents/spawnTool.ts`, `src/core/agents/agentLifecycleTools.ts`, `test/core/tasks/meta.test.ts`, `test/core/tasks/manager.test.ts`, `test/core/agents/spawnTool.test.ts`, `test/core/agents/agentLifecycleTools.test.ts`
  - Acceptance: `spawn_agent` records the effective active worktree cwd into local-agent task specs; task meta and transcript sidecars persist `cwd`; persisted `resume_agent` rebuilds a new local-agent task with the prior cwd metadata, narrowing the gap to true worktree-aware resume.
- [x] Bind background subagent runners to their captured or recovered cwd.
  - Primary files: `src/core/agents/dispatch.ts`, `src/core/agents/spawnTool.ts`, `src/core/agents/agentLifecycleTools.ts`, `test/core/agents/spawnTool.test.ts`, `test/core/agents/agentLifecycleTools.test.ts`
  - Acceptance: `dispatchAgent` accepts an execution-level cwd override; `spawn_agent` and persisted `resume_agent` pass the captured/recovered cwd into the rebuilt runner; subagent tool contexts use that cwd even if the parent active worktree changes before execution; subagents can still update their own cwd after `EnterWorktree` / `ExitWorktree`.
- [x] Add forked-context support with explicit write-scope and parent-session inheritance rules.
  - Primary files: `src/core/agents/spawnTool.ts`, `test/core/agents/spawnTool.test.ts`
  - Acceptance: `spawn_agent(..., fork_context: true)` injects a textual parent-session context summary into the child `local_agent` context and preserves explicit caller context; recursion guard still prevents subagents from forking further.
  - Limitation: this is a minimal context-summary fork, not yet Nuka-Code's cache-identical full transcript/tool-result placeholder fork and not yet isolated worktree write-scope support.
- [x] Add spawn-time worktree isolation for background subagents.
  - Primary files: `src/core/agents/spawnTool.ts`, `test/core/agents/spawnTool.test.ts`
  - Acceptance: `spawn_agent({ isolation: "worktree" })` creates a tracked git worktree using the existing worktree git runner helpers, records the isolated cwd in the queued local-agent spec, includes the worktree path in tool output, keeps the parent active worktree pointer unchanged, and runs the background agent's tools inside the isolated cwd.
- [x] Let subagent definitions declare default worktree isolation.
  - Primary files: `src/core/agents/types.ts`, `src/core/agents/subagentLoader.ts`, `src/core/agents/spawnTool.ts`, `test/core/agents/subagentLoader.test.ts`, `test/core/agents/spawnTool.test.ts`
  - Acceptance: loose-file and plugin agent schemas accept `isolation: inherit | worktree`; markdown frontmatter preserves the field; `spawn_agent` inherits the resolved agent's isolation default when the caller omits `isolation`; explicit `isolation: "inherit"` on the tool call overrides a worktree-default agent.
- [x] Preserve loose-file subagent runtime metadata during registration.
  - Primary files: `src/core/agents/types.ts`, `src/core/agents/subagentLoader.ts`, `src/core/agents/dispatchTool.ts`, `src/cli.tsx`, `test/core/agents/subagentLoader.test.ts`, `test/core/agents/dispatchTool.test.ts`
  - Acceptance: loose-file registration uses a shared `subagentToAgentDef` mapper so `memory`, `isolation`, `background`, and other runtime metadata are not dropped before `resolveAgentDef`; markdown frontmatter accepts `background: true | false` and quoted boolean strings; `dispatch_agent` refuses synchronous execution for `background: true` agents with a direct `spawn_agent` instruction.
- [x] Port useful built-in agents: general, explore, plan, verification, statusline setup, and Claude-Code guide equivalents where they fit Nuka.
  - [x] Add first Nuka-Code-style fast read-only code exploration agent as `core:explorer`.
  - [x] Add Nuka-Code-style independent verification agent as `core:verifier`.
  - [x] Upgrade `core:planner` toward Nuka-Code Plan behavior: explore first, produce an implementation strategy, and list critical files.
  - [x] Add Nuka-Code-style general-purpose agent as `core:general`.
  - Decision: do not port Claude-Code-guide/statusline-setup as default Nuka roles yet; they are Claude-specific setup/help agents, while Nuka now has native provider/statusline code paths and docs should stay outside the default role list until there is a Nuka-specific guide generator.
- [x] Add agent display/color metadata to `src/tui/Tasks/*` without making the statusline noisy.
  - [x] New Tasks columns display local subagent agent name, task/id context, and stable theme-bound agent color keys.
- [x] Add regression tests for recursive-dispatch prevention, lifecycle hooks, tool filtering, cwd/worktree inheritance, and cancellation.
  - Existing coverage: `test/core/agents/recursion.test.ts`, `test/core/agents/toolFilter.test.ts`, `test/core/agents/dispatchHookThreading.test.ts`, `test/core/tasks/stopTool.test.ts`, and `test/core/tasks/run-agent-lifecycle.test.ts`.
  - [x] Add `spawn_agent` regression coverage for inherited lifecycle hooks and active worktree cwd in the queued background runner.

---

## Track 2 - Compact Parity And Efficiency

Reference files in Nuka-Code:
- `/data/xtzhang/Nuka-Code/src/services/compact/autoCompact.ts`
- `/data/xtzhang/Nuka-Code/src/services/compact/microCompact.ts`
- `/data/xtzhang/Nuka-Code/src/services/compact/grouping.ts`
- `/data/xtzhang/Nuka-Code/src/services/compact/apiMicrocompact.ts`
- `/data/xtzhang/Nuka-Code/src/services/compact/sessionMemoryCompact.ts`
- `/data/xtzhang/Nuka-Code/src/services/compact/postCompactCleanup.ts`
- `/data/xtzhang/Nuka-Code/src/services/compact/compactWarningHook.ts`
- `/data/xtzhang/Nuka-Code/src/services/compact/timeBasedMCConfig.ts`

Current Nuka files:
- `src/core/agent/autoCompact.ts`
- `src/core/compact/compact.ts`
- `src/core/tokens/estimate.ts`
- `src/core/provider/openai.ts`
- `test/core/agent/autoCompact.test.ts`
- `test/core/compact/compact.test.ts`
- `test/core/provider/openai.test.ts`

Checklist:
- [x] Locate Codex compact source or docs and record exact source path/commit.
  - Source: `/tmp/openai-codex` at commit `7d47056ea42636271ac020b86347fbbef49490aa`.
  - Key files: `/tmp/openai-codex/codex-rs/core/src/compact.rs`, `/tmp/openai-codex/codex-rs/core/src/compact_remote_v2.rs`, `/tmp/openai-codex/codex-rs/core/templates/compact/prompt.md`, `/tmp/openai-codex/codex-rs/core/templates/compact/summary_prefix.md`.
  - Finding: Codex remote v2 uses `/v1/responses/compact`, collects exactly one `type:"compaction"` output item, keeps recent user/developer/system input under a retained-message budget, and feeds the opaque compaction item back into later Responses requests.
- [x] Add first-class OpenAI Responses compact endpoint support for OpenAI-compatible providers.
  - Primary files: `src/core/provider/types.ts`, `src/core/provider/openai.ts`, `src/core/message/types.ts`, `src/core/compact/compact.ts`, `test/core/provider/openai.test.ts`, `test/core/compact/compact.test.ts`
  - Acceptance: OpenAI-compatible/custom providers post manual compact requests to `/responses/compact` or `/v1/responses/compact` depending on base URL; official OpenAI posts to `/v1/responses/compact`; returned raw `output` items are stored as a `responses_compaction` message and later passed through to the Responses API input unchanged.
- [x] Keep legacy text-summary compact as a fallback for providers without native compact.
  - Primary file: `src/core/compact/compact.ts`
  - Acceptance: providers without `compact()` still stream the old `[[compact-summary]]` assistant summary and preserve the configured recent turns.
- [x] Compare Nuka-Code API-round grouping to Nuka's current pure `maybeAutoCompact` partitioning.
  - Primary files: `src/core/agent/autoCompact.ts`, `test/core/agent/autoCompact.test.ts`
  - Finding: raw-message tail preservation can cut too aggressively inside a single user prompt with multiple assistant API responses; Nuka now supports opt-in `preserveRecentApiRounds` so recent assistant/tool-result rounds stay together while the existing default message-count behavior remains unchanged.
- [x] Decide whether Nuka should add microcompact as a separate pre-provider pass or fold it into the existing session-aware wrapper.
  - Decision: add Nuka-Code-style local microcompact as a separate pre-provider pass, before each provider stream request, and keep `compactSessionAware` as the heavier post-turn summary/native compact path.
  - Rationale: microcompact removes or replaces stale tool-result payloads to reduce the next prompt immediately; the current `compactSessionAware` runs only after `turn_end`, so folding microcompact into it would miss the over-budget request that needs the relief. Nuka also does not yet expose provider-level context-management fields in `LLMRequest`, so API/context-management microcompact stays deferred until provider request schemas support it cleanly.
  - Initial implementation target: pure helper over `Message[]` that clears older `role: "tool"` contents for allowlisted high-volume tools while keeping the newest N tool results and preserving tool ids/error flags; then wire it at the provider-call boundary with focused loop tests.
- [x] Add pure local microcompact helper for stale tool-result payloads.
  - Primary files: `src/core/compact/microCompact.ts`, `test/core/compact/microCompact.test.ts`
  - Acceptance: helper maps assistant `tool_use` ids to tool names, clears older allowlisted `role: "tool"` contents, keeps the newest N compactable tool results, preserves ids/error flags, returns estimated token savings, and does not mutate the input transcript.
- [x] Wire local microcompact into `runAgent` as a pre-provider prompt-copy pass.
  - Primary files: `src/core/agent/loop.ts`, `test/core/agent/loop.test.ts`
  - Acceptance: when `deps.microCompact` is provided, provider requests receive stale allowlisted tool results replaced by the cleared marker while `session.messages` remains complete for local history, persistence, and future resume/rewind work.
- [x] Add config surface for local microcompact.
  - Primary files: `src/core/config/schema.ts`, `test/core/config/load.test.ts`
  - Acceptance: project/user config can set `compact.microCompact.enabled` and `compact.microCompact.keepRecent`; defaults remain compatible with existing configs.
- [x] Enable local microcompact through CLI wiring.
  - Primary files: `src/core/config/microCompact.ts`, `src/cli.tsx`, `test/core/config/microCompact.test.ts`
  - Acceptance: CLI passes `{ keepRecent }` into `runAgent` by default, honors `compact.microCompact.keepRecent`, and disables the pre-provider pass when `compact.microCompact.enabled: false`.
- [x] Add warning-state UX before context pressure becomes a hard failure.
  - Primary files: `src/tui/Status/StatusPanel.tsx`, `test/tui/Status.harness.test.tsx`
  - Acceptance: context usage >=80% shows `compact soon`, >=90% shows `compact now`, while low-pressure statuslines stay quiet; Ink capture verifies the high-context row remains a single concise line.
- [x] Add post-compact cleanup so stale tool-result-heavy context does not leak back into prompts.
  - Primary files: `src/core/compact/compact.ts`, `src/cli.tsx`, `test/core/compact/compact.test.ts`
  - Acceptance: manual compact can apply the same local microcompact cleanup to the retained window after summary/native compaction succeeds, and CLI passes the configured microcompact options into `/compact`.
- [x] Add tests for tool-use/tool-result pairing across compact boundaries.
  - Primary files: `src/core/agent/autoCompact.ts`, `test/core/agent/autoCompact.test.ts`
  - Acceptance: `maybeAutoCompact` expands the preserved tail backward when a kept `tool` message would otherwise lose its matching assistant `tool_use`, so provider-visible history never starts a retained tool result without its call.
- [x] Add tests for image/document blocks so compacting never expands base64 or binary payloads.
  - Primary file: `test/core/agent/autoCompact.image.test.ts`
  - Acceptance: text extraction for compaction skips base64 image payloads; token estimation charges image blocks structurally instead of inlining binary data into summaries.
- [x] Add Codex-style retry/shrink-on-context-window-exceeded behavior for local summary compact and native compact.
  - Primary files: `src/core/compact/compact.ts`, `src/core/agent/autoCompact.ts`, `src/core/compact/contextWindowError.ts`, `test/core/compact/compact.test.ts`, `test/core/agent/autoCompact.test.ts`
  - Acceptance: native Responses compact, manual text-summary compact, and pure autoCompact custom summarizers retry with a smaller older/middle slice on context-window errors while preserving ordinary error propagation.
- [x] Add Codex-style retained-message budget support for manual compact.
  - Primary files: `src/core/compact/compact.ts`, `src/core/config/schema.ts`, `src/cli.tsx`, `src/tui/Submenu/settings/CompactForm.tsx`, `test/core/compact/compact.test.ts`, `test/core/config/load.test.ts`, `test/tui/Submenu/settings/CompactForm.test.tsx`
  - Acceptance: manual compact can retain only the newest messages that fit within `compact.retainedMessageBudget` estimated tokens even when `keepTurns` would otherwise no-op; budget cuts do not orphan retained tool results; Settings exposes the field as `tailBudget` and can save or clear it.
- [x] Add visible manual compact progress state.
  - Primary files: `src/tui/App.tsx`, `test/tui/app.test.tsx`
  - Acceptance: `/compact` shows `compact: running` while the compact request is in flight, changes to `compact: done` after success, and shows `compact: failed` plus the error message if the compact endpoint fails without crashing the TUI.

---

## Track 3 - Upstream Feature Intake

- [x] Locate or clone the current upstream repositories/docs for Claude Code, Codex, and Pi.
  - Evidence: Codex local checkout `/tmp/openai-codex`; Claude Code official docs fetched from `code.claude.com`; Pi official release notes fetched from `pi.dev/news/releases`.
- [x] Record source, date, commit, and license constraints for every inspected feature.
  - Evidence: `docs/plans/2026-05-23-upstream-feature-intake.md`.
- [x] Create a feature checklist with columns: source, feature, user value, Nuka equivalent, gap, risk, priority, test surface.
  - Evidence: `docs/plans/2026-05-23-upstream-feature-intake.md`.
- [x] Pull only features that improve repeated work: task delegation, context survival, recovery, editing flow, and provider reliability.
  - Evidence: accepted iteration order in `docs/plans/2026-05-23-upstream-feature-intake.md`.
- [x] Reject features that are mostly decorative unless they directly improve TUI comprehension.
  - Evidence: rejected/deferred section in `docs/plans/2026-05-23-upstream-feature-intake.md`.

### Accepted Feature Implementation Log

- [x] Add Codex-style read-only thread view facade over persisted Nuka sessions.
  - Primary files: `src/core/session/threadView.ts`, `src/core/session/history/index.ts`, `test/core/session/threadView.test.ts`
  - Acceptance: callers can read a stored session as a `thread/read`-style metadata view without resuming it, optionally include reconstructed user-turn groups, and page turns with JSON cursors plus ascending/descending direction. This is a foundation for later `thread/fork` / true resume rather than a new UI yet.
- [x] Add persisted session fork primitive for Codex-style `thread/fork` foundations.
  - Primary files: `src/core/session/manager.ts`, `test/core/session/manager.test.ts`
  - Acceptance: `SessionManager.forkPersisted(id)` reads a stored session, creates a new active child session with `parentId` set to the source id, deep-copies provider/model/mode/usage/messages, persists the new message snapshot, and writes fork metadata through the existing meta writer.
- [x] Add Codex-style paged thread metadata listing over persisted sessions.
  - Primary files: `src/core/session/threadView.ts`, `src/core/session/history/index.ts`, `test/core/session/threadView.test.ts`
  - Acceptance: `ThreadViewStore.list()` returns `thread/list`-style metadata pages with JSON cursors, newest-first default ordering, optional ascending direction, and provider/model/search filters without resuming sessions.

---

## Track 4 - Human TUI Redesign

Use `ink-ui-explorer` for capture/sweep/judge/repair after each meaningful Ink layout change.

- [x] Capture current main screen, long conversation, model picker, provider wizard, task panel, and statusline in desktop and narrow widths.
  - Evidence fixture: `test/ui-auto/fixtures/iter-23-human-tui-baseline.fixtures.tsx`
  - Evidence test: `npm test -- test/ui-auto/humanTuiBaseline.test.ts`
  - Evidence captures: `ink-ui-explorer capture test/ui-auto/fixtures/iter-23-human-tui-baseline.fixtures.tsx --viewport=120x30` and `--viewport=70x24`; expected desktop/narrow capture JSON pairs have zero error-level L1 violations.
- [x] Redesign conversation spacing: less cramped than current output, but still terminal-dense enough for coding.
  - Evidence test: `npm test -- test/tui/Messages.static.test.tsx test/ui-auto/humanTuiBaseline.test.ts test/tui/app.test.tsx`
  - Evidence captures: refreshed `iter-23-human-tui-baseline` at 120x30 and 70x24; message turns now have a single blank row between them while long conversations keep the scroll hint and newest messages.
- [x] Redesign assistant message framing by studying Codex/Nuka-Code patterns; avoid nested cards and noisy borders.
  - Evidence test: `npm test -- test/tui/agentCall.test.tsx test/tui/Messages.static.test.tsx test/ui-auto/humanTuiBaseline.test.ts test/tui/app.test.tsx test/tui/outputStylesRender.test.tsx`
  - Evidence captures: refreshed `iter-23-human-tui-baseline` at 120x30 and 70x24; assistant text renders as quiet indented copy while user turns retain the left marker and tool/agent components keep their structured display.
- [x] Make provider/model identity visible in one place with the configured provider name.
  - Evidence test: `npm test -- test/tui/Status.harness.test.tsx test/tui/planModeBadge.test.tsx test/ui-auto/humanTuiBaseline.test.ts test/tui/app.test.tsx`
  - Evidence captures: refreshed `iter-23-human-tui-baseline` at 120x30 and 70x24; statusline keeps `Xiaomi Mimo/mimo-v2-pro` visible at 70 columns and preserves context separators when truncating.
- [x] Make scroll state discoverable without instructional clutter.
  - Evidence test: `npm test -- test/tui/Messages.static.test.tsx test/tui/app.test.tsx test/ui-auto/humanTuiBaseline.test.ts`
  - Evidence captures: refreshed `iter-23-human-tui-baseline` at 120x30 and 70x24; long conversations now show a concise `history: 5 visible · 29 older` state summary with no PageUp/PgUp instructional text.
- [x] Simplify task/subagent panels so in-flight work is legible at a glance.
  - Progress: narrow mode now uses a concise `Tasks: plan 1 · sub 1 · pipe 1 · bg 1 · msg 1 · focus sub 2/5` summary instead of the dense `[plan(1) sub(1) ...]` tab strip.
  - Progress: wide mode now uses the same summary plus one digest row per active lane, replacing five simultaneous bordered columns.
  - Evidence test: `npm test -- test/tui/Tasks/TasksPanelNew.test.tsx test/integration/phase14b-monitor.test.tsx test/tui/App.panels.test.tsx test/ui-auto/humanTuiBaseline.test.ts`
  - Evidence captures: refreshed `iter-23-human-tui-baseline` at 120x30 and 70x24; 120-column main screen/task panel show a borderless task digest, while 70-column main screen/task panel keep the summary plus focused subagent detail.
- [x] Add harness tests for text overflow, border bleed, cursor placement, and statusline truncation.
  - Evidence test: `npm test -- test/tui/LayoutGuards.harness.test.tsx test/tui/PromptInput.cursorAnsi.test.tsx test/tui/Status.harness.test.tsx test/tui/toolCall.test.tsx`
  - Coverage: `LayoutGuards.harness` now runs L1 checks for narrow statusline provider/model truncation, bordered tool progress overflow/border bleed, and native cursor declaration in the full App viewport.
- [x] Keep `stringWidth` / `truncateByWidth` in every width-sensitive path.
  - Evidence test: `npm test -- test/tui/LayoutGuards.harness.test.tsx test/tui/Status.harness.test.tsx test/ui-auto/humanTuiBaseline.test.ts`
  - Coverage: audited terminal-visible `.length`/`.slice` paths; statusline cwd shortening now uses display-width left truncation so CJK paths preserve the leaf directory and context segment in narrow viewports.
