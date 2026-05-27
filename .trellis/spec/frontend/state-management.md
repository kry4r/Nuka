# State Management

> How state is managed in this project.

---

## Overview

Nuka does not use Redux, Zustand, React Query, or a browser router. State is
split between:

- core runtime objects (`SessionManager`, `TaskManager`, provider registries,
  event buses);
- React local state in `App.tsx` and focused dialogs;
- pure reducers for view models; and
- persisted JSON sidecars/config under core modules.

---

## State Categories

### Local UI state

Use `useState`, `useReducer`, and refs for transient UI state such as current
submenu, scroll offset, expanded detail window, prompt input, picker selection,
and compact progress.

Example owners: `src/tui/App.tsx`, `src/tui/dialogs/ModelPicker.tsx`,
`src/tui/Submenu/SubmenuList.tsx`.

### Derived view state

Use pure reducers/functions when events need to become display rows.

Example: `src/tui/Tasks/columnReducer.ts` converts task/message events into
bounded task-panel columns. This keeps the Ink component mostly presentational
and gives tests a stable non-React target.

### Runtime state

Keep long-lived state in core services:

- sessions in `src/core/session/*`;
- background tasks and subagent sidecars in `src/core/tasks/*`;
- costs in `src/core/cost/*`;
- config in `src/core/config/*`;
- provider and tool registries in their core modules.

### Persisted state

Use core persist/load modules for filesystem state. UI components should not
write ad hoc files.

---

## When to Use Global State

Promote state out of a component only when it must be shared across runtime
boundaries or survive process/session transitions:

- Provider/model/config selection belongs in `src/core/config/*`.
- Session messages, goal metadata, and fork/resume metadata belong in
  `src/core/session/*`.
- Subagent/task status belongs in `TaskManager` plus task meta/transcript
  sidecars.
- Usage/cost attribution belongs in `CostTracker` and cost persistence.

Do not create a new global singleton for a component convenience. Prefer
passing a typed callback or introducing a focused core manager with tests.

---

## Server State

Provider streams are not cached by a UI data library. `runAgent` owns the
provider-visible transcript, tool-call loop, compact/microcompact preflight,
and usage events. The UI consumes yielded events and core state snapshots.

Background subagents use the task runtime:

- `spawn_agent` enqueues a `local_agent` task;
- task state/progress events flow through the event bus;
- sidecars persist metadata, final output, transcript baseline, cwd, provider,
  and model for later `resume_agent` / `send_agent` recovery.

### Scenario: Structured Subagent Fork Context

#### 1. Scope / Trigger

- Trigger: `spawn_agent({ fork_context: true })` needs to give the child agent
  parent-session context without flattening tool-use structure into text.
- This is provider-visible runtime state. It crosses session messages,
  `LocalAgentSpec`, task sidecars, and the `dispatchAgent` provider request.

#### 2. Signatures

- Tool input:
  `spawn_agent({ agent: string; task: string; fork_context?: boolean; context?: string; write_scope?: ... })`.
- Runtime spec:
  `LocalAgentSpec.forkContext?: { mode: "structured" }` and
  `LocalAgentSpec.forkMessages?: Message[]`.
- Sidecars:
  `TaskMeta.forkContext?: { mode: "structured" }` and
  `TaskTranscript.forkContext?: { mode: "structured" }`.

#### 3. Contracts

- Non-fork spawns keep the old fresh-subsession behavior: provider history is
  only the new task plus optional context.
- Structured forks clone parent `Message[]` into `forkMessages`; task runners
  must not mutate the parent session's message objects.
- If and only if the parent transcript tail is an assistant message containing
  `tool_use` blocks, synthesize one stable placeholder `tool` message per
  tool call before the child directive.
- Resolved earlier tool calls must stay as-is. Do not scan backward to an older
  assistant message and add duplicate placeholder results.
- Caller context and write scope belong in the final fork directive message, so
  sibling forks share the inherited prefix and only differ in their directive.

#### 4. Validation & Error Matrix

- `fork_context` omitted or false -> no `forkContext`, no `forkMessages`, and
  normal fresh dispatch.
- Empty parent messages -> structured fork still runs with only the directive
  message.
- Parent tail is `assistant` with tool calls -> add placeholder tool messages.
- Parent tail is `tool`, `user`, `system`, or `responses_compaction` -> add no
  placeholder tool messages.
- Recursive subagent spawn attempt -> reject before constructing fork messages.

#### 5. Good/Base/Bad Cases

- Good: parent assistant just emitted two `spawn_agent` tool calls; each fork
  receives the same parent user/assistant prefix, two stable placeholder tool
  results, then its own directive.
- Base: `spawn_agent` without `fork_context` starts a clean sub-session.
- Bad: flattening parent messages under `Forked parent context:` text. This
  loses tool-use/tool-result structure and prevents cache-friendly siblings.
- Bad: adding placeholders for an older assistant tool call after the real tool
  result is already in history.

#### 6. Tests Required

- `test/core/agents/spawnTool.test.ts` proves structured fork metadata, tool
  output wording, provider-visible message order, placeholder synthesis, and
  the already-resolved-tool-call edge case.
- `test/core/tasks/manager.test.ts` proves task meta/transcript sidecars persist
  the fork marker.
- `test/core/agents/agentLifecycleTools.test.ts` keeps existing resume/send
  behavior green while fork metadata is added.

#### 7. Wrong vs Correct

Wrong:
```typescript
const context = mergeContext(formatForkContext(parent.messages), nextContext)
```

Correct:
```typescript
const fork = buildStructuredForkContext({
  parentMessages: session.messages,
  directive: input.task,
  context: nextContext,
})
dispatchAgent({ forkMessages: fork.forkMessages, ... })
```

### Scenario: Local Subagent Write-Scope Sidecars

#### 1. Scope / Trigger

- Trigger: a background `local_agent` needs explicit ownership guidance that
  survives task persistence and later `resume_agent`, `send_agent`, or
  `send_input` executions.
- This contract is descriptive and provider-visible. It is not filesystem
  enforcement until the permission/tool boundary implements hard checks.

#### 2. Signatures

- Tool input:
  `spawn_agent({ write_scope?: { allow?: string[]; deny?: string[]; note?: string } })`.
- Runtime spec:
  `LocalAgentSpec.writeScope?: LocalAgentWriteScope`.
- Sidecars:
  `TaskMeta.writeScope?: LocalAgentWriteScope` and
  `TaskTranscript.writeScope?: LocalAgentWriteScope`.

#### 3. Contracts

- `allow` and `deny` are path strings trimmed before storage.
- Empty path entries are rejected before enqueueing the task.
- Empty `allow`, empty `deny`, and blank `note` are omitted from the normalized
  stored value.
- Follow-up tools recover the latest write scope from the in-memory local-agent
  task first, then persisted task metadata/transcripts.
- Provider-visible follow-up context is ordered as prior context, previous
  transcript summary, `Write scope:`, then caller-supplied context.

#### 4. Validation & Error Matrix

- `write_scope.allow` contains a blank or whitespace-only path -> return a tool
  error and do not enqueue a `local_agent`.
- `write_scope.deny` contains a blank or whitespace-only path -> return a tool
  error and do not enqueue a `local_agent`.
- Missing `write_scope` -> preserve existing spawn/resume behavior.
- Old sidecars without `writeScope` -> resume normally without a write-scope
  section.

#### 5. Good/Base/Bad Cases

- Good: a spawned worker owns `src/core/agents` and `test/core/agents`, avoids
  `docs/plans`, and every follow-up repeats that same boundary in context.
- Base: a worker has no explicit write scope, so no extra context is injected.
- Bad: only putting the scope in the first prompt. A persisted follow-up would
  lose the ownership boundary after process restart.

#### 6. Tests Required

- `test/core/agents/spawnTool.test.ts` proves input normalization, validation,
  queued `LocalAgentSpec.writeScope`, and the provider-visible `Write scope:`
  section.
- `test/core/tasks/manager.test.ts` proves `<task>.meta.json` and
  `<task>.transcript.json` persist the normalized scope.
- `test/core/agents/agentLifecycleTools.test.ts` proves resume/send/send_input
  rehydrate write scope and prior transcript context for provider requests.

#### 7. Wrong vs Correct

Wrong:
```typescript
const context = mergeContext(previousContext, nextContext)
```

Correct:
```typescript
const context = mergeContext(
  previousContext,
  transcriptSummary,
  formatWriteScopeContext(seed.writeScope),
  nextContext,
)
```

Compact and goal state are session/core concerns, not presentation-only state.

### Scenario: Persisted Session History Search

#### 1. Scope / Trigger

- Trigger: `/history <query>` needs to filter persisted sessions by local
  conversation content while reusing the existing history browser.
- This crosses slash command parsing, `DialogDescriptor`, `App.tsx` dialog
  orchestration, `HistoryStore`, and `SessionList`.

#### 2. Signatures

- Slash command:
  `HistoryCommand.run(args, ctx) -> { type: "dialog"; dialog: { kind: "history-list"; query?: string } }`.
- Core store:
  `HistoryStore.search(query: string): Promise<HistoryListEntry[]>`.
- TUI:
  `SessionList({ entries, loading, query?, onResume, onDelete, onCancel })`.

#### 3. Contracts

- Blank or whitespace-only query delegates to `HistoryStore.list()`.
- Nonblank queries are trimmed before being stored in the dialog descriptor.
- Search is case-insensitive and whitespace-normalized over persisted local
  JSONL messages from `SessionStore`.
- Searchable text includes user/assistant text blocks, system text, and string
  tool outputs. Image blocks and opaque Responses compaction payloads are not
  searched.
- Search result previews prioritize the matched text. In search mode,
  `SessionList` rows should spend width on the match preview rather than
  timestamp metadata.

#### 4. Validation & Error Matrix

- Persistence disabled -> `/history <query>` returns the same enablement text
  as `/history`.
- Query blank -> unfiltered newest-first list.
- Query has no matches -> empty list with "No matching sessions" wording.
- Persisted message file malformed/unreadable -> skip that file for search;
  do not crash the dialog.
- Narrow viewport -> search summary and row text must truncate by display
  width without hiding the match term in ordinary cases.

#### 5. Good/Base/Bad Cases

- Good: `/history auth bug` opens the history browser with a `Search: auth bug`
  summary, shows matching snippets, and resume/delete still use the selected
  session id.
- Base: `/history` with no query renders the existing date/message-count rows.
- Bad: filtering in the component only after loading every unfiltered row into
  UI state; core search must own persisted-message scanning so slash/App stay
  orchestration-only.
- Bad: showing "No past sessions" for a nonblank query with zero matches.

#### 6. Tests Required

- `test/core/session/history/store.test.ts`: matching, blank-query delegation,
  malformed-message tolerance.
- `test/slash/history.test.ts`: disabled persistence and query propagation.
- `test/tui/History/SessionList.test.tsx`: filtered summary, empty filtered
  state, existing resume/delete keyboard behavior.
- `test/ui-auto/fixtures/*history-search*.fixtures.tsx` plus explorer sweep for
  desktop and narrow viewports.

#### 7. Wrong vs Correct

Wrong:
```typescript
const entries = await history.list()
const filtered = entries.filter(e => e.preview.includes(query))
```

Correct:
```typescript
const entries = query
  ? await history.search(query)
  : await history.list()
```

---

## Common Mistakes

- Storing provider-visible history only in UI state. Session and compact logic
  must see the same messages.
- Mutating arrays or message objects in reducers/helpers. Use immutable updates
  so React and tests observe stable transitions.
- Letting task panel rendering classify raw tasks differently from task runtime
  metadata. Keep classification centralized in `columnReducer`.
- Treating compacted prompt copies as canonical history. Microcompact modifies
  provider request copies; local session history remains complete for resume,
  persistence, and auditability.
