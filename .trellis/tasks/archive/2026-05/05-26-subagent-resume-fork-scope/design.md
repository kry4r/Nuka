# Subagent true resume fork and scope parity design

## Context

Nuka already has a broad subagent foundation: local-agent task sidecars,
stable `agent_id`, background spawn/wait/close, lightweight resume/send,
worktree cwd preservation, and minimal summarized `fork_context`. The roadmap
still correctly marks subagent parity as partial because Nuka-Code's
`AgentTool` keeps stronger sidechain state:

- `resumeAgentBackground()` reloads prior transcript and worktree metadata, then
  appends the new user prompt to provider-visible messages.
- fork children receive explicit scope rules and worktree notices.
- cache-identical fork prefixes require provider-native assistant tool-use and
  placeholder tool-result blocks.

Nuka's current sidecars contain a text transcript baseline, not provider-native
tool-use blocks. That makes byte-identical fork prefixes a later task. This
child should close the safer intermediate gap: deterministic transcript
rehydration and persisted write-scope contracts.

## Data Contract

Add `LocalAgentWriteScope` under `src/core/tasks/types.ts`:

```ts
export type LocalAgentWriteScope = {
  allow?: string[]
  deny?: string[]
  note?: string
}
```

This is intentionally descriptive in this child task. It travels through:

`spawn_agent input -> LocalAgentSpec.writeScope -> TaskMeta.writeScope -> TaskTranscript.writeScope -> resume/send seed -> rebuilt LocalAgentSpec.writeScope -> dispatch context`.

The persisted shape uses only strings and arrays so old sidecars remain
readable and future permission enforcement can validate the same contract.

## Runtime Behavior

`spawn_agent` accepts `write_scope?: { allow?: string[]; deny?: string[]; note?: string }`.
It trims paths, rejects empty entries, preserves caller context, and appends a
deterministic note to the child context:

```text
Write scope:
- Allowed paths: src/core/agents, test/core/agents
- Denied paths: docs/plans
- Note: do not edit roadmap docs from this worker
```

When `fork_context: true`, the context order is:

1. summarized parent context,
2. write-scope note,
3. explicit caller context.

`resume_agent`, `send_agent`, and `send_input` recover `writeScope` from the
newest in-memory task or persisted sidecar. Their rebuilt context order is:

1. prior task context,
2. previous transcript summary,
3. write-scope note,
4. caller-supplied context.

This order keeps older context stable and makes the new instruction the actual
tool task. It also avoids embedding scope rules only in the user-facing output.

## Boundaries

This task does not enforce writes at the filesystem boundary. Nuka already has
`PermissionChecker` and profile enforcement; hard write-scope controls should
be added there only after this metadata contract exists and tests can prove all
entry points pass the scope consistently.

This task also does not implement Nuka-Code's cache-identical fork prefix.
Current Nuka local-agent transcripts are text summaries. A faithful port needs
provider-native assistant tool-use persistence and unresolved-tool filtering
before it can safely synthesize placeholder tool results.

## Testing

Tests stay focused on current owners:

- `test/core/agents/spawnTool.test.ts` for schema/input validation and queued
  local-agent specs.
- `test/core/tasks/manager.test.ts` for meta/transcript sidecar persistence.
- `test/core/agents/agentLifecycleTools.test.ts` for in-memory and persisted
  follow-up rehydration.

No Ink capture is required in this child because no visible TUI layout changes
are planned.
