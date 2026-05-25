# Implementation Plan

## Scope

Implement the structured fork-context slice for background subagents. Keep the
write set focused on:

- `src/core/tasks/types.ts`
- `src/core/tasks/meta.ts`
- `src/core/agents/forkContext.ts` (new)
- `src/core/agents/spawnTool.ts`
- `src/core/agents/dispatch.ts`
- focused tests under `test/core/agents/*` and `test/core/tasks/*`

## Steps

1. [x] Red tests for fork construction and sidecar persistence
   - Add/adjust `test/core/agents/spawnTool.test.ts` so
     `fork_context: true` expects structured fork metadata, not a text summary
     label.
   - Add a provider-visible regression that drains the queued runner and
     asserts parent structured messages and placeholder tool results are sent
     before the child directive.
   - Add `test/core/tasks/meta.test.ts` or `manager.test.ts` coverage for
     persisted fork metadata.

2. [x] Add task contract types
   - Add a small serializable `LocalAgentForkContext` type.
   - Add optional `forkContext` and structured fork-message fields to
     `LocalAgentSpec`.
   - Thread the fork marker into `TaskMeta` and `TaskTranscript`.

3. [x] Implement fork-context helper
   - Build stable placeholder tool messages for assistant tool-use blocks.
   - Build a child directive message with fork-worker instructions.
   - Clone parent messages so task runners do not mutate session history.
   - Keep helper output typed and testable.

4. [x] Thread structured fork messages through spawn and dispatch
   - `spawn_agent` builds the helper output when `fork_context` is true.
   - Structured fork construction happens after worktree resolution so a
     forked isolated worktree can append parent/worktree cwd translation
     guidance to the child directive.
   - Queued `LocalAgentSpec` carries the fork marker and messages.
   - The runner passes those messages to `dispatchAgent`.
   - `dispatchAgent` appends structured fork messages before the seed task
     message.
   - Update `spawn_agent` output text to report structured fork semantics.

5. [x] Verify
   - `npm test -- test/core/agents/spawnTool.test.ts test/core/tasks/meta.test.ts test/core/tasks/manager.test.ts test/core/agents/agentLifecycleTools.test.ts`
   - `npm run typecheck`
   - `git diff --check`

Evidence 2026-05-26:

- Focused fork/task/bundle suite passed:
  `npm test -- test/core/agents/spawnTool.test.ts test/core/tasks/manager.test.ts test/core/tasks/meta.test.ts test/core/agents/agentLifecycleTools.test.ts test/build/bundle-size.test.ts`
  with 5 files / 60 tests.
- `npm run typecheck` exited 0.
- `npm run lint` exited 0 with 55 existing warnings and 0 errors.
- `git diff --check` exited 0.
- The final refinement added a RED/GREEN fork+worktree notice regression while
  preserving the strict `dist/cli.js` ceiling through shorter schema/output
  wording instead of raising the bundle-size budget.

## Rollback

If structured messages reveal provider adapter incompatibilities, keep the
typed sidecar marker and helper tests, but gate structured `forkMessages` behind
`fork_context: true` only and fall back to the previous text context with an
explicit PRD update explaining the provider constraint.
