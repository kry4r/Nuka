# Nuka Hook System Reference

This is the authoritative reference for Nuka's **in-process hook system** — the function-based event bus implemented in `src/core/hooks/`. It complements two sibling docs:

- [`docs/plugin-hooks.md`](plugin-hooks.md) — how a plugin manifest declares in-process hooks via `inProcessHooks:`.
- [`docs/plugins.md`](plugins.md) — how a plugin manifest declares **shell-command** hooks via `hooks:` / `hooks.json`.

The two subsystems live side-by-side in `src/core/hooks/`:

| Subsystem | Loader | Surface | Use when… |
|---|---|---|---|
| Shell-command hooks | `loader.ts` + `runner.ts` (loads `hooks.json`; execs via `sh -c`) | `runHooks()`, `HookEntry`, shell-hook events | You want an external command to react to a lifecycle event. Portable to Nuka-Code. |
| In-process function hooks | `registry.ts` + `configLoader.ts` (loads JS modules; calls handlers in-process) | `HookRegistry`, `HookHandler`, in-process events listed below | You want to read or transform tool results / lifecycle payloads from inside the agent process. Nuka-only. |

The two are bridged one-way: after every shell-hook execution, the runner fires an in-process `shellHookExecuted` event so observers on the in-process registry can see shell-hook activity. See [Bridge event](#bridge-event-shellhookexecuted).

> Throughout this doc, "hook" means the in-process variety unless explicitly tagged "shell hook".

---

## Event matrix

`IN_PROCESS_HOOK_EVENTS` in `src/core/hooks/events.ts` lists every supported event. Group by purpose:

### Lifecycle events (5)

| Event | Fires from | Payload helper | Cancelable | Notes |
|---|---|---|---|---|
| `sessionStart` | `src/cli.tsx` after the registry, plugins, and user config are wired and the active session is created | `fireSessionStart` (`lifecycle.ts`) — payload type `SessionStartPayload` | No | `resumed: true` when `--resume` was used. `context` is `'main'` / `'subagent'` / `'task'` (defaults to `'main'` when omitted). |
| `sessionEnd` | SIGINT / explicit exit / `dispatchAgent` teardown | `fireSessionEnd` — `SessionEndPayload` | No | `reason` ∈ `'sigint' \| 'exit' \| 'manual' \| 'completed' \| 'aborted'`. |
| `promptSubmit` | Agent loop immediately before the user message is appended to `session.messages` | `firePromptSubmit` — `PromptSubmitPayload` | No (observe-only this iter) | Handlers can in future iters return `additionalContext` to extend the prompt; not yet wired. |
| `afterTurn` | Agent loop when the model emits a stop reason that ends the turn (no further tool calls pending) | `fireAfterTurn` — `AfterTurnPayload` | No | Carries `stopReason` and `toolCalls` count. |
| `beforeAutoCompact` | Agent loop immediately before deciding to run auto-compaction | `fireBeforeAutoCompact` — `BeforeAutoCompactPayload` | **Yes** — return `{ skip: true, reason }` | Returns `{ skipped, reason? }` to the caller; the first handler that votes `skip` wins. |

### Tool-call events (3)

| Event | Fires from | Payload (via `HookContext.payload`) | Cancelable / Mutable |
|---|---|---|---|
| `beforeToolCall` | `wrapTool.ts` before the underlying tool runs | `{ input: <tool input> }` | **Veto** — return `{ skip: true, reason? }`. First successful skip wins; the wrapper returns a synthetic `{ output: "Skipped by hook: <reason>", isError: false }` without invoking the tool. |
| `afterToolCall` | `wrapTool.ts` after the tool returns (or throws) | `{ input, result?: ToolResult, error?: unknown }` | **Mutate** — return `{ data: { replaceResult: <ToolResult> } }`. See [Pipeline semantics](#pipeline-semantics-aftertoolcall). |
| `afterToolCallFailure` | (Reserved — not fired by current `wrapTool.ts`; handlers may register, no current fire site) | n/a | n/a |

### Assistant-output event (1)

| Event | Fires from | Payload helper | Mutable |
|---|---|---|---|
| `afterAssistantMessage` | Agent loop after an assistant message is assembled, BEFORE `appendMessage` | `fireAfterAssistantMessage` — `AfterAssistantMessagePayload` | **Mutate text** — return `{ data: { replaceText: '<new>' } }`. See [afterAssistantMessage rewrite rules](#afterassistantmessage-rewrite-rules). |

### Prompt-render event (1, reserved)

| Event | Fires from | Notes |
|---|---|---|
| `promptRendered` | (Reserved — no current fire site) | Slot exists in the enum so plugin authors can pre-declare a handler; will become live when the prompt-render pass adopts the event. |

### Subagent / notification events (2, reserved)

| Event | Fires from | Notes |
|---|---|---|
| `subagentStart` | (Reserved — `dispatchAgent` fires `sessionStart` with `context: 'subagent'` instead) | Kept in the enum for forward-compat. |
| `notification` | (Reserved) | Slot for the future notifications surface — see `src/core/notifications/`. |

### Bridge event: `shellHookExecuted`

Fired by `src/core/hooks/shellBridge.ts:fireShellHookExecuted` once per shell-hook execution AFTER the shell process exits. Payload shape `ShellHookExecutedPayload`:

| Field | Type | Notes |
|---|---|---|
| `event` | `HookEvent` (shell-hook event name) | The originating shell-hook event. |
| `hookId` | `string` | Built from `event:tool:command-hash` for cross-fire correlation. |
| `command` | `string` | Truncated to 500 chars. |
| `exitCode` | `number` | `-1` if the shell process couldn't be launched. |
| `stdoutPreview` / `stderrPreview` | `string?` | First ~500 chars; omitted on launch failure. |

Handlers are **advisory observers** — they cannot veto, mutate, or otherwise influence the shell hook outcome (the registry's `skip:true` semantics do NOT propagate back to the shell runner). Use this for telemetry, plugin observers, or TUI banners.

## Pipeline semantics (`afterToolCall`)

`afterToolCall` handlers can replace the tool's output by returning `{ data: { replaceResult: <ToolResult> } }`. The wrapper supports TWO dispatch modes — choose at process boot via `NUKA_HOOK_PIPELINE_MODE`:

| Mode | `NUKA_HOOK_PIPELINE_MODE` | Behaviour |
|---|---|---|
| `pipeline` (default since Iter WWW) | unset or `pipeline` | Handlers run in priority order. Each handler's `payload.result` is the **current pipeline state** — either the original tool result, or the previous handler's `replaceResult` if one was returned. Handlers that return `{}` pass state through unchanged. Throwing handlers are isolated; pipeline continues with current state. Multi-stage transformers (jsonFormat → pathDisplay → wordWrap → urlExtract) compose into a single output. |
| `last-write-wins` (legacy opt-out) | `last-write-wins` | Every handler reads the SAME `payload.result` (the tool's original output). The wrapper picks the LAST successful `replaceResult` and discards earlier ones. Matches the Iter III shape. Use if your stack relies on each handler seeing the unmodified original. |

For single-handler registries the two modes are equivalent. Error isolation, `signal.aborted` propagation, and `beforeToolCall` veto semantics are identical across both modes.

### `beforeToolCall` veto

Independent of pipeline mode. The wrapper iterates the `beforeToolCall` invocation results in registration / priority order and returns the synthetic skip result on the **first** `outcome === 'success' && result.skip === true`. Throwing handlers cannot veto (their outcome is `'error'`, not `'success'`).

## `afterAssistantMessage` rewrite rules

`afterAssistantMessage` fires once per assembled assistant message BEFORE `appendMessage`. Handlers can rewrite the text content by returning `{ data: { replaceText: '<new>' } }`. The rules (from `src/core/hooks/events.ts` and `lifecycle.ts:extractReplaceText` / `applyReplaceTextToAssistant`):

| Rule | Detail |
|---|---|
| Resolution | **LAST-WRITE-WINS** — each handler reads the ORIGINAL `payload.text`, not the previous handler's `replaceText`. The wrapper picks the last successful `replaceText` where `typeof replaceText === 'string'`. This is the OPPOSITE of `afterToolCall`'s pipeline default and is intentional. |
| Empty string | `''` is a VALID replacement: the assistant text is rewritten to empty. The message still keeps a single empty text block — the "assistant emitted at least one text block" invariant holds. |
| Non-string | `undefined` / `null` / numbers / objects → "no replacement requested"; original text is preserved. |
| Errors | Throwing handlers' `replaceText` is discarded. |
| Content-block rewrite | All text blocks in `assistant.content` are replaced with a SINGLE text block carrying `replaceText`, inserted at the position of the first pre-existing text block. tool_use blocks are preserved verbatim in their original order. If the message had no text block, a single text block carrying `replaceText` is prepended. |

## Error isolation, abort, and ordering (all events)

From `src/core/hooks/pipeline.ts`:

- **Sequential** — handlers within an event run one after another. Priority order (higher `priority` first; ties broken by insertion order).
- **Error-isolated** — each handler runs inside try/catch. A throw produces `outcome: 'error'` in the results array; sibling handlers always continue.
- **Abort-aware** — `HookRegistry.invoke({ signal })` checks `signal.aborted` between handlers. Once aborted, every remaining handler is recorded as `outcome: 'aborted'` and execution stops.
- **Lifecycle timeout** — lifecycle fire helpers wrap a default 5000ms `AbortSignal.timeout`. Override per-call via `{ timeoutMs }` (pass `0` to disable).

---

## Built-in handlers

All registered from `src/cli.tsx`. Order matches the registration sequence (which becomes priority-tie-broken insertion order at boot, since none of these set an explicit `priority`).

| Handler ID | Event | Factory | Env-var gate | Notes |
|---|---|---|---|---|
| `recentFiles-auto-touch` | `beforeToolCall` | `createRecentFilesTouchHandler` (`src/core/fileSearch/recentFilesHook.ts`) | Always on (off only when `NUKA_RECENT_FILES_NO_PERSIST=1` swaps to in-memory tracker) | Adds tool-input paths to the recent-files store before the tool runs. |
| `auto-truncate-output` | `afterToolCall` | `createAutoTruncateHook` (`src/core/toolResult/autoTruncateHook.ts`) | Always on | Middle-truncates oversized string `output` (default 8000-grapheme budget) before it reaches the agent's context. Error results and `ContentBlock[]` outputs pass through unchanged. |
| `path-display-rewriter` | `afterToolCall` | `createPathDisplayHandler` (`src/core/paths/pathDisplayHook.ts`) | `NUKA_PATH_DISPLAY_HOOK=1` | Humanises absolute paths in successful string output via `displayPath` (tildify + cwd-relativise). |
| `json-format-pretty-printer` | `afterToolCall` | `createJsonFormatHandler` (`src/core/jsonFormat/jsonFormatHook.ts`) | `NUKA_JSON_FORMAT_HOOK=1` | Pretty-prints raw single-line JSON. Conservative: only rewrites on a successful `JSON.parse` round-trip. |
| `word-wrap-rewriter` | `afterToolCall` | `createWordWrapHandler` (`src/core/wordWrap/wordWrapHook.ts`) | `NUKA_WORD_WRAP_HOOK=1` (+ optional `NUKA_WORD_WRAP_WIDTH=<int>`, default 100) | Re-flows successful string output to fit the configured column budget. Outputs that already fit on every line pass through unchanged. |
| `url-extract-annotator` | `afterToolCall` | `createUrlExtractHandler` (`src/core/urlExtract/urlExtractHook.ts`) | `NUKA_URL_EXTRACT_HOOK=1` | Annotates successful string output with an extracted `urls` sibling field. `output` is preserved verbatim. |
| `applyDiff-permission-gate` | `beforeToolCall` | `createApplyDiffPermissionHandler` (`src/core/diff/applyDiffPermissionHook.ts`) | `NUKA_APPLY_DIFF_ALLOWED_ROOTS=<csv>` (comma-separated roots, absolute or cwd-relative) | Vetoes any `ApplyDiff` call whose target escapes the allow-list. Unset → unchanged behaviour. |
| `whitespace-normalize-observer` | `afterAssistantMessage` | `createWhitespaceHookHandler` (`src/core/whitespace/whitespaceHook.ts`) | `NUKA_WHITESPACE_HOOK=1` | Observer-only this iter. Runs `whitespace.normalize` over the assembled assistant text and surfaces the diagnostic via `InvocationResult`. Does NOT rewrite `session.messages` (that requires a future `replaceText` wiring). |

## Environment-variable matrix

| Variable | Default | Effect |
|---|---|---|
| `NUKA_HOOK_PIPELINE_MODE` | `pipeline` | `last-write-wins` reverts `afterToolCall` to the legacy Iter III shape. |
| `NUKA_RECENT_FILES_NO_PERSIST` | unset | `1` swaps the persistent recent-files tracker for an in-memory one (CI / tests). |
| `NUKA_PATH_DISPLAY_HOOK` | unset | `1` registers `path-display-rewriter`. |
| `NUKA_JSON_FORMAT_HOOK` | unset | `1` registers `json-format-pretty-printer`. |
| `NUKA_WORD_WRAP_HOOK` | unset | `1` registers `word-wrap-rewriter`. |
| `NUKA_WORD_WRAP_WIDTH` | `100` | Integer width budget when `NUKA_WORD_WRAP_HOOK=1`. |
| `NUKA_URL_EXTRACT_HOOK` | unset | `1` registers `url-extract-annotator`. |
| `NUKA_APPLY_DIFF_ALLOWED_ROOTS` | unset | Comma-separated allow-list; non-empty value registers `applyDiff-permission-gate`. |
| `NUKA_WHITESPACE_HOOK` | unset | `1` registers `whitespace-normalize-observer`. |

---

## Extension points

### 1. Plugin manifest — `inProcessHooks:` sidecar

A plugin can ship a JS/MJS module that registers handlers against the shared registry. See [`docs/plugin-hooks.md`](plugin-hooks.md) for the full reference; the short form:

```yaml
# plugin.yaml
name: hello-hook
version: "0.1.0"
inProcessHooks: hooks/index.mjs
```

```js
// hooks/index.mjs
export default [
  {
    event: 'afterToolCall',
    id: 'log-tool',
    priority: 0,
    handler: (ctx) => {
      process.stderr.write(`[hello-hook] tool=${ctx.toolName}\n`)
    },
  },
]
```

ID namespacing: plugin handlers are registered as `plugin:<plugin-name>:<entry-id>` (auto-generated `auto-1`, `auto-2`, … if `id` is omitted). See `docs/plugin-hooks.md#id-namespacing`.

### 2. User config — `~/.nuka/hooks.config.{js,mjs}`

Loaded at boot from `defaultHookConfigPaths(cwd, home)` in `src/core/hooks/configLoader.ts`. The default search order is:

1. `${cwd}/.nuka/hooks.config.js`
2. `${cwd}/.nuka/hooks.config.mjs`
3. `${home}/.nuka/hooks.config.js`
4. `${home}/.nuka/hooks.config.mjs`

Each file is independently optional — missing files are a no-op (graceful), files that exist but fail to import or validate produce a `console.warn` at boot without blocking startup.

The module must default-export (or named-export `hooks`) an array of `HookConfigEntry`:

```ts
export interface HookConfigEntry {
  event: InProcessHookEvent
  handler: HookHandler
  id?: string
  priority?: number
}
```

### Example A — Write a custom handler

`~/.nuka/hooks.config.mjs`:

```js
// Log every successful Bash result's first line to stderr.
export default [
  {
    event: 'afterToolCall',
    id: 'bash-first-line-logger',
    priority: 0,
    handler: (ctx) => {
      if (ctx.toolName !== 'Bash') return
      const result = ctx.payload?.result
      if (!result || result.isError !== false) return
      if (typeof result.output !== 'string') return
      const firstLine = result.output.split('\n', 1)[0]
      process.stderr.write(`[bash-log] ${firstLine}\n`)
    },
  },
]
```

### Example B — Plug a handler via a plugin

`~/.nuka/plugins/log-prompts/plugin.json`:

```json
{
  "name": "log-prompts",
  "version": "0.1.0",
  "inProcessHooks": "hooks/index.mjs"
}
```

`~/.nuka/plugins/log-prompts/hooks/index.mjs`:

```js
export default [
  {
    event: 'promptSubmit',
    id: 'log',
    handler: (ctx) => {
      const text = ctx.payload?.text
      if (typeof text !== 'string') return
      process.stderr.write(`[log-prompts] ${text.slice(0, 80)}\n`)
    },
  },
]
```

Boot output will include:

```
[plugin:log-prompts] tools=0 slash=0 skills=0 hooks=0 agents=0 lsp=0 inProcessHooks=1
```

### Example C — Plug a handler via user config (rewrite a tool result)

`~/.nuka/hooks.config.mjs`:

```js
// Strip ANSI escapes from every successful string ToolResult so the agent
// sees a clean transcript.
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g
export default [
  {
    event: 'afterToolCall',
    id: 'strip-ansi',
    priority: 100, // run early so downstream transformers see the clean text
    handler: (ctx) => {
      const result = ctx.payload?.result
      if (!result || result.isError !== false) return
      if (typeof result.output !== 'string') return
      const stripped = result.output.replace(ANSI, '')
      if (stripped === result.output) return
      return { data: { replaceResult: { ...result, output: stripped } } }
    },
  },
]
```

With `NUKA_HOOK_PIPELINE_MODE=pipeline` (default), the cleaned output feeds the next `afterToolCall` handler (e.g. `auto-truncate-output`), so word-wrap and truncate run on stripped text.

---

## Security

In-process handlers run inside the main Nuka process with full Node.js privileges. They can read/write any file the agent can, make arbitrary network requests, mutate `globalThis`, and observe every tool call. There is no sandbox.

- Treat installing a plugin with `inProcessHooks:` the same as running `node third-party-script.mjs`.
- The agent-facing `HookList` tool (`src/core/hooks/hookListTool.ts`) deliberately does NOT expose `register` and does NOT support `clear()` without an event — the agent can list / count / clear-by-event but cannot install handlers or blanket-wipe infrastructure (`recentFiles-auto-touch` etc.).
- Handlers MUST NOT call `console.log` or `process.stdout.write` — the TUI owns `stdout`. Use `console.error` / `process.stderr.write` for diagnostic output.

Shell hooks at least run in a subprocess where the OS can apply standard process isolation. In-process hooks do not — prefer shell hooks for anything that touches the network or filesystem outside the plugin's own directory.

---

## See also

- [`docs/plugin-hooks.md`](plugin-hooks.md) — the `inProcessHooks:` manifest field reference (plugin-author surface).
- [`docs/plugins.md`](plugins.md) — shell-command hooks via `hooks.json`.
- `src/core/hooks/events.ts` — canonical event enum + `HookContext` / `HookResult` types.
- `src/core/hooks/registry.ts` — `HookRegistry` class.
- `src/core/hooks/pipeline.ts` — execution semantics (priority, error isolation, abort).
- `src/core/hooks/lifecycle.ts` — lifecycle fire helpers + payload types.
- `src/core/hooks/wrapTool.ts` — tool-call wrapping + pipeline-vs-last-write-wins logic.
- `src/core/hooks/configLoader.ts` — `~/.nuka/hooks.config.{js,mjs}` loader.
- `examples/plugins/hello-hook/` — runnable plugin example.
