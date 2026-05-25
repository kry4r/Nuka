# Subagent true resume fork and scope parity

## Goal

Close the highest-value remaining gap between Nuka's current background
subagent lifecycle and the Nuka-Code `AgentTool` reference: follow-up
executions should preserve provider-visible transcript context and explicit
write-scope expectations instead of relying only on flattened context strings.

## Requirements

- Preserve the existing public lifecycle tools: `spawn_agent`, `wait_agent`,
  `close_agent`, `resume_agent`, `send_agent`, and `send_input`.
- Add a typed write-scope contract for local background subagents. The contract
  must be serializable into task meta/transcript sidecars and must not enforce
  destructive filesystem rules until the permission/runtime layer has a tested
  enforcement path.
- Let `spawn_agent` accept explicit write-scope metadata so callers can tell a
  forked or isolated worker which paths it owns and which paths are off limits.
- Persist write-scope metadata through `LocalAgentSpec`, `<task>.meta.json`,
  and `<task>.transcript.json`.
- Rehydrate write-scope metadata in `resume_agent`, `send_agent`, and
  `send_input` so logical subagent identity keeps the same ownership boundary
  across executions.
- Improve provider-visible follow-up context from persisted transcript
  sidecars. The follow-up prompt must contain the previous user/assistant
  transcript in a deterministic section before the new instruction and any
  caller-supplied context.
- Keep the current lightweight `fork_context` behavior, but rename its
  limitation clearly in docs/output: it is a summarized transcript fork, not
  Nuka-Code's byte-identical tool-result placeholder fork.
- Do not port frontmatter MCP/hooks runtime in this child task. Those are a
  separate gap because they introduce external runtime connections and trust
  policy questions.

## Acceptance Criteria

- [x] `spawn_agent` schema and tests cover `write_scope` with `allow` and
  `deny` path lists, preserve existing callers, and reject malformed empty path
  entries.
- [x] Local-agent task metadata and transcript sidecars persist and recover the
  write-scope contract.
- [x] `resume_agent` / `send_agent` / `send_input` include prior transcript and
  write-scope context in rebuilt background runs, with tests proving provider
  requests see the old user prompt, old assistant result, new instruction, and
  write-scope note.
- [x] The implementation keeps worktree cwd preservation and clean/dirty
  cleanup behavior green.
- [x] Lightweight `fork_context` is labeled in tool schema/output as a
  summarized transcript fork, not a byte-identical tool-result placeholder fork.
- [x] Focused verification passes:
  `npm test -- test/core/agents/spawnTool.test.ts test/core/agents/agentLifecycleTools.test.ts test/core/tasks/manager.test.ts`.
- [x] Baseline quality passes:
  `npm run typecheck` and `git diff --check`.

## Out of Scope

- Byte-identical fork request prefixes with placeholder `tool_result` blocks.
  Nuka's local message model does not yet persist full provider-native
  assistant tool-use blocks for background subagent sidechains.
- Hard filesystem enforcement of write scopes. This child adds the typed,
  persisted, provider-visible contract first; enforcement belongs in the
  permission checker/tool boundary after the contract is proven.
- Agent-specific MCP server and hook frontmatter runtime. Those require a
  trust model and cleanup semantics separate from resume/fork reconstruction.

## Technical Notes

- Nuka-Code references inspected:
  - `/data/xtzhang/Nuka-Code/src/tools/AgentTool/forkSubagent.ts`
  - `/data/xtzhang/Nuka-Code/src/tools/AgentTool/resumeAgent.ts`
  - `/data/xtzhang/Nuka-Code/src/tools/AgentTool/runAgent.ts`
- Current Nuka files inspected:
  - `src/core/agents/spawnTool.ts`
  - `src/core/agents/agentLifecycleTools.ts`
  - `src/core/tasks/types.ts`
  - `src/core/tasks/meta.ts`
  - `test/core/agents/spawnTool.test.ts`
  - `test/core/agents/agentLifecycleTools.test.ts`
  - `test/core/tasks/manager.test.ts`
- Evidence 2026-05-26:
  - RED: focused tests failed because queued specs, sidecars, and follow-up
    reconstruction did not include `writeScope`.
  - GREEN: `npm test -- test/core/agents/spawnTool.test.ts test/core/tasks/manager.test.ts test/core/agents/agentLifecycleTools.test.ts`
    passed with 3 files / 45 tests.
  - `npm run typecheck` exited 0.
  - `git diff --check` exited 0.
  - Fresh verification 2026-05-26 02:44 CST:
    `npm test -- test/core/agents/spawnTool.test.ts test/core/agents/agentLifecycleTools.test.ts test/core/tasks/manager.test.ts`
    passed with 3 files / 45 tests; `npm run typecheck` exited 0;
    `npm run lint` exited 0 with warning-only legacy unused-code findings;
    `git diff --check` exited 0.
  - RED/GREEN follow-up 2026-05-26: `test/core/agents/spawnTool.test.ts`
    first failed because `fork_context` did not expose the summary-only
    limitation in the schema or tool output; after updating `spawn_agent`,
    the file passed with 15 tests.
  - Fresh verification 2026-05-26 after the follow-up:
    `npm test -- test/core/agents/spawnTool.test.ts test/core/agents/agentLifecycleTools.test.ts test/core/tasks/manager.test.ts`
    passed with 3 files / 45 tests; `npm run typecheck` exited 0;
    `npm run lint` exited 0 with 55 warning-only legacy unused-code findings;
    `git diff --check` exited 0.
  - Spec sync: `.trellis/spec/frontend/state-management.md` now records the
    local subagent write-scope sidecar contract, validation matrix, and required
    spawn/task/follow-up tests.

## Notes

- Parent task: `05-26-nuka-objective-parity-ux`.
