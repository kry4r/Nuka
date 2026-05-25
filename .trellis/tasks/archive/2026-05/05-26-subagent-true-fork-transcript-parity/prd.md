# Subagent true fork transcript parity

## Goal

Close the next P0 Nuka-Code subagent parity gap by upgrading
`spawn_agent(..., fork_context: true)` from a flattened text summary into a
structured fork that preserves the parent transcript shape and placeholder tool
results. This makes forked background agents closer to the
`/data/xtzhang/Nuka-Code` AgentTool behavior while keeping Nuka's existing
explicit `spawn_agent` API, task sidecars, and worktree isolation model.

## Requirements

- Preserve the public `spawn_agent` API shape: callers still pass an explicit
  `agent`, `task`, and optional `fork_context: true`.
- When `fork_context` is true, build provider-visible child history from the
  parent session's structured messages, not from a lossy text block.
- If the parent tail ends with an assistant message containing `tool_use`
  blocks, include placeholder tool results before the child directive so the
  child request remains structurally valid and cache-friendly across sibling
  forks.
- Keep explicit caller `context` and `write_scope` visible after the inherited
  transcript prefix.
- When a structured fork is also launched in an isolated worktree, include a
  path-translation notice in the child directive so inherited parent paths are
  re-read and translated to the child worktree root before edits.
- Preserve current recursion protection: a subagent still cannot spawn further
  subagents.
- Preserve current non-fork spawn/resume behavior unless explicitly covered by
  this task.
- Persist enough fork metadata in local-agent task specs/sidecars so future
  resume/send work can identify whether an execution was a structured fork.
- Do not claim full Nuka-Code parity for unsupported pieces: byte-identical
  parent system prompt reuse, exact tool-definition inheritance, content
  replacement state, MCP/hook frontmatter, and hard write-scope enforcement
  remain separate gaps unless implemented and verified.

## Acceptance Criteria

- [x] `spawn_agent({ fork_context: true })` queues a `local_agent` whose child
  dispatch sends structured parent messages before the new fork directive.
- [x] A parent assistant tool call is followed by synthetic placeholder tool
  results in the forked child request before the child directive text.
- [x] The placeholder text is stable across sibling forks so only the directive
  differs.
- [x] The tool result for `spawn_agent` reports structured fork semantics and no
  longer advertises the fork as "summary-only".
- [x] Non-fork spawns still seed a fresh isolated sub-session with only the task
  and optional context.
- [x] Forked worktree spawns include parent/worktree cwd guidance in the child
  directive without breaking the CLI bundle-size ceiling.
- [x] Task metadata/transcript sidecars record the fork mode without breaking old
  sidecar readers.
- [x] Focused tests cover spawn-time fork construction, provider-visible child
  request messages, sidecar persistence, and existing resume/send behavior.

## Evidence

- RED tests first failed for the intended current behavior:
  `npm test -- test/core/agents/spawnTool.test.ts` reported failures for
  schema wording, missing `forkContext`, and provider-visible message order;
  `npm test -- test/core/tasks/manager.test.ts` reported missing persisted
  `forkContext`.
- GREEN verification on 2026-05-26:
  `npm test -- test/core/agents/spawnTool.test.ts test/core/tasks/manager.test.ts test/core/tasks/meta.test.ts test/core/agents/agentLifecycleTools.test.ts test/build/bundle-size.test.ts`
  passed with 5 files / 60 tests.
- `npm run typecheck` exited 0.
- `npm run lint` exited 0 with the repo's existing warning baseline
  (55 warnings, 0 errors).
- `git diff --check` exited 0.
- Additional RED/GREEN refinement on 2026-05-26:
  `test/core/agents/spawnTool.test.ts` first failed because forked isolated
  worktree directives lacked parent/worktree cwd translation guidance; after
  moving structured fork construction after worktree resolution and tightening
  the directive text to stay within the startup bundle budget, the focused
  fork/task/bundle suite passed with 60 tests.

## Notes

- Reference behavior:
  `/data/xtzhang/Nuka-Code/src/tools/AgentTool/forkSubagent.ts` clones the
  parent assistant tool-use message and appends placeholder tool results plus a
  child directive.
- Current Nuka behavior:
  `src/core/agents/spawnTool.ts` flattens parent messages into
  `Forked parent context:` text, which loses structured tool-use/tool-result
  ordering.
- The implemented placeholder text is intentionally short to preserve the
  strict `dist/cli.js` startup bundle ceiling; tests assert stability and
  structure rather than user-facing wording.
