# Nuka Plugin In-Process Hooks

This guide documents the `inProcessHooks:` manifest field, which lets a plugin
register **in-process** (function-based) hook handlers against the shared
`HookRegistry`. It is the sibling of `hooks:` — that field loads
**shell-command** hooks from a `hooks.json` file, while `inProcessHooks:` loads
JavaScript functions from a module.

> Nuka-only feature. The `inProcessHooks` field is not recognized by
> Nuka-Code. See [Portability](#portability).

---

## When to use this

| You want… | Use |
|---|---|
| Run an external shell command on a lifecycle event | `hooks:` (`hooks.json`) — see [`docs/plugins.md`](plugins.md) |
| Read or transform tool results inside the agent process | `inProcessHooks:` (this guide) |
| Add user-level handlers in your own `~/.nuka/` config | `~/.nuka/hooks.config.{js,mjs}` |

In-process handlers can do anything a Node.js function can: rewrite tool
results, veto tool calls, annotate prompts, mutate global state. They are
strictly more powerful — and strictly less portable — than shell hooks.

---

## Manifest field

In a plugin manifest (`plugin.yaml` or `plugin.json`):

```yaml
name: hello-hook
version: "0.1.0"
description: Example in-process-hook plugin
inProcessHooks: hooks/index.mjs
```

```json
{
  "name": "hello-hook",
  "version": "0.1.0",
  "description": "Example in-process-hook plugin",
  "inProcessHooks": "hooks/index.mjs"
}
```

The value is a **relative path** (from the plugin root) to a JS/MJS module that
default-exports an array of hook entries.

---

## Handler module contract

The module must export an array as either `default` or `hooks`:

```js
// hooks/index.mjs
export default [
  {
    event: 'afterToolCall',
    handler: (ctx) => {
      process.stderr.write(`[hello-hook] tool=${ctx.toolName}\n`)
    },
    id: 'log-tool',     // optional — see ID namespacing below
    priority: 0,        // optional — higher runs earlier; defaults to 0
  },
]
```

Each entry is a `HookConfigEntry` (see `src/core/hooks/configLoader.ts`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `event` | `InProcessHookEvent` (string enum) | yes | Non-empty. See [Events](#events). |
| `handler` | `(ctx: HookContext) => HookResult \| void \| Promise<...>` | yes | Must be a function. |
| `id` | `string` | no | Stable handler ID. See [ID namespacing](#id-namespacing). |
| `priority` | `number` | no | Higher runs earlier. Default `0`. |

Imports for the typed shapes (TypeScript plugin authors only — `.mjs` plugins
are duck-typed at load time):

```ts
import type {
  InProcessHookEvent,
  HookContext,
  HookHandler,
  HookResult,
} from 'nuka/core/hooks/events'
import type { HookConfigEntry } from 'nuka/core/hooks/configLoader'
```

---

## Events

The full list of supported events (see `src/core/hooks/events.ts`):

| Event | Payload highlights | Cancelable |
|---|---|---|
| `beforeToolCall` | `toolName`, tool input via `payload` | Yes — return `{ skip: true, reason }` |
| `afterToolCall` | `toolName`, `payload.result` (the `ToolResult`) | No (but can replace result, see below) |
| `afterToolCallFailure` | `toolName`, error payload | No |
| `afterTurn` | `sessionId`, `stopReason`, `toolCalls` | No |
| `beforeAutoCompact` | `sessionId`, `tokensBefore`, `threshold`, `contextWindow` | Yes — return `{ skip: true }` |
| `promptSubmit` | `sessionId`, `text` | No |
| `promptRendered` | rendered prompt body | No |
| `sessionStart` | `sessionId`, `providerId`, `model`, `cwd`, `resumed`, `context`, `agentName` | No |
| `sessionEnd` | `sessionId`, `reason`, `context`, `agentName` | No |
| `subagentStart` | subagent name, params | No |
| `notification` | notification payload | No |
| `shellHookExecuted` | bridge event after a shell hook runs | No (advisory) |

`HookContext` always carries `{ event, toolName?, payload?, signal? }` —
inspect `payload` for event-specific fields (the registry does not enforce
their shape).

### Return values (`HookResult`)

```ts
type HookResult = {
  skip?: boolean              // veto / cancel (where supported by the event)
  reason?: string             // user-visible reason for skipping
  additionalContext?: string  // text the caller may attach to the conversation
  data?: Readonly<Record<string, unknown>>  // opaque pass-through
}
```

`data.replaceResult` is the convention `afterToolCall` consumers use to
overwrite the tool output. The agent loop reads `replaceResult` and substitutes
it for the original `ToolResult`. By default `afterToolCall` is
**last-write-wins**; set `NUKA_HOOK_PIPELINE_MODE=pipeline` so each handler
sees the previous handler's substituted result.

---

## ID namespacing

Every plugin-registered handler is given an ID of the form:

```
plugin:<plugin-name>:<entry-id>
```

- `<plugin-name>` comes from the manifest `name` field.
- `<entry-id>` is the entry's `id` if provided, otherwise auto-generated as
  `auto-1`, `auto-2`, … in declaration order.

Examples:

| Manifest | Entry | Resulting ID |
|---|---|---|
| `name: hello-hook` | `{ event: 'afterTurn', id: 'log' }` | `plugin:hello-hook:log` |
| `name: hello-hook` | `{ event: 'afterTurn' }` (no id) | `plugin:hello-hook:auto-1` |
| `name: my-plugin` | `{ event: 'afterTurn', id: 'log' }` | `plugin:my-plugin:log` |

The namespace prefix prevents collisions between plugins that happen to pick
the same entry ID, and lets operators inspect or clear a single plugin's
handlers without touching others (`HookRegistry.list()` / `.unregister()`).

---

## Error handling

The loader is permissive on the outside and strict on the inside.

| Condition | Behaviour |
|---|---|
| `inProcessHooks` not declared | No-op. |
| Declared path does not exist | No-op, no error (graceful — matches `~/.nuka/hooks.config.js` semantics). |
| Module fails to import or validate | Error is collected in `wirePlugin().errors`; surfaced via `console.warn`. Does not block startup. |
| Individual entry fails validation (missing `event`, non-function `handler`) | Error collected; other entries continue. |
| Handler throws at invoke time | Caught by `HookRegistry.invoke`; reported as `InvocationResult.outcome = 'error'`. Sibling handlers still run. |
| `hookRegistry` dep not provided to `wirePlugin` | Field is silently skipped (backward-compat for older callers). |

The total `inProcessHooksAdded` count is logged at startup, e.g.:

```
[plugin:hello-hook] tools=0 slash=0 skills=0 hooks=0 agents=0 lsp=0 inProcessHooks=1
```

---

## Security

> **In-process hook handlers run inside the main Nuka process with full
> Node.js privileges.** They can read/write any file the agent can, make
> arbitrary network requests, mutate `globalThis`, and observe every tool
> call. There is no sandbox.
>
> Treat installing a plugin with `inProcessHooks:` the same as running
> `node third-party-script.mjs` on your machine. Do **not** install plugins
> from untrusted sources. Audit the handler module before installing.

Shell hooks (`hooks:` / `hooks.json`) at least run in a subprocess where the
host OS can apply standard process isolation. In-process hooks do not — that
is the trade-off for the ability to mutate tool results directly.

When in doubt, prefer shell hooks for anything that touches the network or
the filesystem outside the plugin's own directory.

---

## Output and TUI

Nuka's TUI owns `stdout`. Handlers MUST NOT call `console.log` or
`process.stdout.write` — that corrupts the rendered UI. Use
`console.error` or `process.stderr.write` for diagnostic output; Nuka
already streams plugin status lines to `stderr`.

---

## Portability

| Feature | Nuka | Nuka-Code |
|---|---|---|
| `inProcessHooks:` manifest field | Yes | **No** |
| `hooks:` (shell-command hooks) | Yes | No |
| `tools:` / `slashCommands:` / `skills:` / `agents:` | Yes | Yes |

If your plugin must run under Nuka-Code, ship the same logic as a shell hook
in `hooks.json`. The two are not interchangeable — in-process handlers can
mutate live tool results, shell hooks cannot.

---

## Validating a plugin

Run the built-in author validator before shipping:

```bash
nuka plugin validate path/to/plugin/dir
```

This validates the manifest schema (including that `inProcessHooks` is a
string if present). It does **not** currently `import()` the handler module —
catch import-time errors by installing into a scratch `~/.nuka/plugins/` and
launching Nuka.

---

## Example

See [`examples/plugins/hello-hook/`](../examples/plugins/hello-hook/) for a
runnable example with installation instructions. It registers a single
`afterToolCall` handler that prints the tool name to `stderr` whenever any
tool runs.
