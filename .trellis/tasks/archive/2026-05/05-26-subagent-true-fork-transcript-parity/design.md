# Subagent True Fork Transcript Parity Design

## Current Behavior

`spawn_agent` currently accepts `fork_context: true`, but it serializes parent
messages into a text context section. That preserves some human-readable
history, but it does not preserve the provider-visible transcript shape. In
particular, parent assistant `tool_use` blocks become text and no placeholder
tool results are created, so fork siblings cannot share a stable request prefix
the way Nuka-Code's fork path does.

## Target Slice

This task upgrades the fork path to a structured local-agent contract:

- `LocalAgentSpec` gains optional fork metadata and structured fork messages.
- `spawn_agent` builds fork messages from the parent session when
  `fork_context: true`.
- `dispatchAgent` seeds the child session with those structured messages before
  appending the new task/context directive.
- Task sidecars persist a small fork-mode marker so resume/send can reason
  about forked executions later without changing their current behavior.

This is still an incremental parity step. Nuka will not yet reuse the parent's
exact rendered system prompt or exact tool-definition serialization. Those need
separate request-schema and provider-prefix tests before claiming full
Nuka-Code parity.

## Fork Message Construction

For structured forks, use a helper owned by `src/core/agents/forkContext.ts`.
It accepts the parent `Message[]` and the child directive. It returns:

1. A clone of the parent messages up to the relevant fork point.
2. When the last included assistant message contains tool calls, placeholder
   tool messages for each call using a stable constant.
3. A child directive user message containing Nuka's fork-worker instructions,
   the requested task, optional write-scope context, optional caller context,
   and optional worktree notice.

The placeholder text must be identical across sibling forks. Per-child details
belong only in the final directive/context message.

## Dispatch Flow

`dispatchAgent` remains the single place that creates the sub-session and sends
provider requests. Its new optional `forkMessages` input is appended into the
fresh session before the seed user message. For non-fork executions,
`forkMessages` is undefined and the current behavior remains unchanged.

The seed user message is still the new task plus context. This keeps lifecycle
hooks, task prompt metadata, and final output behavior stable. Provider-visible
history becomes:

```text
structured parent messages
synthetic placeholder tool result messages, if needed
child task/context directive
```

## Persistence

Task sidecars stay backward compatible. Add a `forkContext` marker to:

- `LocalAgentSpec`
- `TaskMeta`
- `TaskTranscript`

The marker is intentionally small (`mode: "structured"` plus an optional note).
We do not persist full parent history in task meta because that can be large;
the transcript sidecar remains the persisted execution summary and future work
can add bounded full-history sidecars if required.

## Error Handling

- No parent session or empty messages: structured fork still starts, but only
  the child directive/context is used.
- Parent tail with unresolved tool-use assistant messages: synthesize stable
  placeholder tool messages before the directive.
- Unsupported/corrupt old sidecars: existing readers ignore missing fork
  metadata.
- Recursive spawn attempts from subagents are still rejected before fork
  construction.

## Validation

Focused tests should prove:

- `spawn_agent` queues structured fork metadata and no longer labels the output
  as summary-only.
- The queued runner sends parent user/assistant/tool messages to the provider
  before the child directive.
- Assistant tool calls receive stable placeholder tool results before the
  directive.
- `TaskManager` sidecars persist the fork marker.
- Existing resume/send tests remain green.
