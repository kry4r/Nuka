# Nuka

A **plugin-first**, **agent-swarm-capable** CLI coding assistant. Stream-rendered TUI, MCP servers, plugin marketplace, multi-expert agent dispatch, and LSP-aware tooling — all in one ~240 KB bundle.

> **Status:** active development. 6 phases shipped (4a → 6). 850+ tests passing. Single-file `dist/cli.js` build.

---

## Why Nuka

Most agent CLIs ship as monoliths: vendor-specific, hard-coded toolsets, no story for community extensions. Nuka inverts that:

- **Tools, slash commands, MCP servers, hooks, agents, output renderers, and LSP servers all flow through one plugin manifest.** Add capabilities by dropping a plugin folder under `~/.nuka/plugins/`.
- **Agent dispatch is first-class.** A plugin can declare specialist agents (`reviewer`, `tester`, `architect`...) and the main agent calls them as tools. Sub-sessions are isolated; up to 4 run in parallel.
- **Provider-agnostic.** Anthropic + OpenAI provider adapters today; new ones are ~150 lines.

---

## Features at a glance

### Core agent loop
- Streaming `text_delta` / `tool_use_*` / `tool_result` events.
- Parallel tool execution for read-only batches (concurrency cap 4) — preserves input-order event emission.
- JSON-Schema input validation before every tool call (no silently malformed inputs reaching `run()`).
- Per-tool result-size caps + content-block-aware result type (`string | ContentBlock[]`).
- Auto-compaction with `beforeAutoCompact` hook veto.

### MCP (Model Context Protocol)
- stdio + streamable-HTTP + SSE transports.
- Connection / per-request timeouts (defaults 30 s / 10 min).
- Auto-reconnect with exponential backoff (also handles HTTP 404 / JSON-RPC -32001 session expiry).
- `ListRoots` handler + `roots` capability declaration.
- Tool/server description truncation (2048 chars) and result truncation (100 KB default, configurable).
- Resource link auto-fetch (server returns `resource_link` → client inlines the content).
- Image content blocks persisted to `~/.nuka/tmp/` and surfaced as `ContentBlock` to providers.
- Elicitation (form + URL modes) wired through the permission bridge.
- stderr ring buffer (64 MB) for stdio transports, surfaced on connect failure.
- Large-output disk persistence past 500 KB, returned with a path reference.
- Unicode sanitization (BOM, C0/C1 controls, zero-width chars).
- LRU connection cache.

### Plugin system
- Manifest fields: `tools[]`, `slashCommands[]`, `skills[]`, `mcpServers{}`, `hooks`, `agents[]`, `outputStyles[]`, `channels[]`, `lspServers[]`, `dependencies[]`, `userConfig`, plus author metadata (`author`/`homepage`/`repository`/`license`/`keywords`).
- Discovery: local `~/.nuka/plugins/`, session `--plugin-dir`, marketplace (URL index, git, npm, `.mcpb`/`.dxt` bundles).
- Versioned cache with atomic symlink-to-active.
- Dependency closure resolution (DFS + cycle detection).
- Background auto-update; blocklist + delist auto-uninstall.
- `nuka plugin validate <path>` for authors.
- Interactive `/plugin search|install|uninstall|list|enable|disable|update`.
- `userConfig` first-enable prompt with form dialog; persisted to `~/.nuka/plugins/<name>/.userconfig.json`.
- 3-layer options storage: defaults < marketplace defaults < user values.
- Plugin hooks at agent seams: `beforeToolCall` / `afterToolCall` / `afterTurn` / `beforeAutoCompact` (cancellable hooks via non-zero exit + `{cancel:true}` JSON on stdout).
- YAML manifests supported (Nuka-only) with portability warning; JSON manifests are cross-tool portable.

### Agents (multi-expert swarm)
- Plugins declare `agents[]` with name, description, system prompt (inline or markdown file), `allowedTools` / `deniedTools` filter, optional `model` / `temperature` / `maxTurns` / `keywords`.
- Built-in `dispatch_agent(agent, task, context?)` tool — main agent invokes specialist agents.
- Each sub-agent runs in an **isolated session**: empty message history, fresh tool registry filtered by allow/deny, separate usage accounting.
- Up to 4 dispatches run in parallel (opts in via `annotations.parallelSafe`).
- Recursion guard: sub-agents cannot dispatch further sub-agents.
- TUI: indented sub-session block with `[<plugin>:<agent>]` badge; Ctrl+A toggles expansion; final result inlined as `(from <agent>)`.

### Permission system
- Three-tier hint: `none` / `write` / `exec` / `network` (auto-detected via tool annotations).
- Annotation-aware prompts: `read-only` / `destructive` / `network` badges on the dialog; destructive defaults cursor to Deny with a red banner; readOnly defaults to Allow.
- Per-session consent cache (matches against tool name + input pattern).
- Suggested glob patterns for repeated similar prompts.

### Configuration
- Four-scope cascade: **enterprise** (`/etc/nuka/config.yaml`, Linux only) → **user** (`~/.nuka/config.yaml`) → **project** (`.nuka/config.yaml` walks ancestors) → **local** (`.nuka/config.local.yaml`).
- Enterprise-locked dot-paths can't be overridden by lower scopes.
- `nuka config show [--scope <name>]`.

### Notification channels
- Plugins declare `channels[]` with allowlists of event types (`tool_result`, `turn_end`, `error`, `plugin_*`).
- Webhook (HTTP POST JSON) or command (spawn + JSON on stdin) dispatch. 10 s timeout. Fire-and-forget.

### Output styles
- Plugins declare `outputStyles[]` to render specific tools (matched by glob on tool name + source) with custom React components.
- Error boundary falls back to default `ToolCall` render on component throw.

### LSP integration (Phase 6)
- `lspServers[]` manifest field.
- Three agent-facing tools: `lsp_diagnostics(path)`, `lsp_definition(path, line, char)`, `lsp_references(path, line, char)`.
- stdio transport; minimal LSP 3.17 subset (initialize / didOpen / didChange / didClose / publishDiagnostics / definition / references / shutdown).
- Lazy spawn on first matching file. `documentSelector` routes file paths to language servers.
- Document tracker fires `didChange` automatically when `Write`/`Edit` tools modify tracked files.

### TUI
- Ink-based React renderer.
- Slash command suggestions, mention panel, model picker, session picker.
- Bang shell (`!cmd`) for quick shell access.
- Permission dialog with badges + suggested patterns.
- Elicitation dialog (form + URL).
- Plugin config dialog at first enable.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                          src/cli.tsx                           │
│ providers · sessions · permission bridge · slash · LSP · MCP   │
└──────────────┬─────────────────────────────────────────────────┘
               │
   ┌───────────▼──────────┐
   │  src/core/agent/loop │  ← streaming, tool dispatch, parallel batch,
   │                      │    hooks, channels, autocompact, LSP didChange
   └─┬───────┬───────────┬┘
     │       │           │
     │       │           │
┌────▼──┐ ┌──▼────┐ ┌────▼────────┐
│Tools  │ │Skills │ │ Provider    │  Anthropic / OpenAI
│Reg.   │ │Loader │ │ Adapters    │
└──┬────┘ └───────┘ └─────────────┘
   │
   │           ┌─────────────────────────────────────────────────┐
   ├──────────►│ MCP (client/manager/transports/elicitation)     │
   │           │   · stdio · http · sse · timeouts · reconnect    │
   │           │   · resource_link auto-fetch · image persist     │
   │           │   · stderr ring · output persist · LRU cache     │
   │           └─────────────────────────────────────────────────┘
   │
   │           ┌─────────────────────────────────────────────────┐
   ├──────────►│ Plugins (manifest/loader/wire/install/userCfg)   │
   │           │   · marketplace (url/git/npm/bundle)             │
   │           │   · deps closure · version cache · autoupdate    │
   │           │   · blocklist · validate · /plugin TUI           │
   │           │   · hooks · session-only --plugin-dir            │
   │           └────────────┬────────────────────────────────────┘
   │                        │
   │                        │ plugin manifest declares...
   │                        ├─► agents[]      → AgentRegistry → dispatch_agent
   │                        ├─► outputStyles  → MessageRow custom render
   │                        ├─► channels      → Notification dispatch
   │                        ├─► lspServers    → LspManager
   │                        ├─► hooks         → HookRunner
   │                        └─► userConfig    → PluginConfigDialog
   │
   │           ┌─────────────────────────────────────────────────┐
   ├──────────►│ LSP (jsonrpc/client/tracker/manager/tools)       │
   │           │   · stdio JSON-RPC · documentSelector routing    │
   │           │   · didOpen/Change/Close · diagnostics buffer    │
   │           └─────────────────────────────────────────────────┘
   │
   │           ┌─────────────────────────────────────────────────┐
   └──────────►│ Permission (checker/bridge/cache)                │
               │   · annotation badges · pattern matching         │
               └─────────────────────────────────────────────────┘
```

### Module map

```
src/core/
  agent/      loop, events, system prompt, progress pump
  agents/     specialist-agent dispatch (M5)
  config/     scope cascade, schema, paths
  hooks/      lifecycle hook loader + execa runner
  lsp/        Phase 6 — jsonrpc, client, tracker, manager, tools
  mcp/        client, manager, transports, elicitation, reconnect
  message/    factories, content block types
  notifications/ channels (webhook/command dispatch)
  permission/ checker, bridge, cache, suggested patterns
  plugin/     manifest schema, loader, wire, install (git/npm/bundle/marketplace),
              deps, version cache, autoupdate, blocklist, validate,
              userConfig, optionsStorage, outputStyles
  provider/   Anthropic / OpenAI adapters, resolver, remote models
  session/    store, store-debounced meta writer, queue, telemetry
  skill/      loader, activator, skill tool
  tools/      registry, types, content blocks, validate, concurrency, progress

src/slash/    slash command registry + plugin/* subcommands
src/tui/      Ink-based renderer; dialogs (permission/elicitation/pluginConfig);
              messages (ToolCall/AgentCall/MessageRow); promptInput; modelPicker
test/         400+ tests mirroring the src tree
docs/superpowers/   reviews + design specs + plans for each phase
```

---

## Implementation highlights

### Provider adapters (~150 lines each)
A provider is a function returning an async iterator of `ProviderEvent` (`text_delta`, `tool_use_start`, `tool_use_stop`, `message_stop`). Anthropic and OpenAI adapters live in `src/core/provider/`. Adding a new provider means matching that signature; no other module changes.

### MCP client (`src/core/mcp/client.ts`)
A single class wraps the `@modelcontextprotocol/sdk` client. `connect()` declares roots capability, registers `ListRootsRequestSchema` / `ElicitRequestSchema` handlers, and times out at 30 s. `callTool` truncates results, persists oversize output to disk, sanitizes Unicode, auto-fetches resource links, persists image blocks, and rejects timeouts. `onclose` triggers reconnect with exponential backoff (1 s→30 s, 5 attempts).

### Agent dispatch (`src/core/agents/dispatch.ts`)
Each dispatch builds a fresh `Session`, a fresh `ToolRegistry` filtered by `allowedTools`/`deniedTools`, sets `session.allowedAgentDispatch=false`, and runs the standard `runAgent` loop with a turn cap (default 20). Failures (provider throw, timeout, max-turns) become structured error tool results.

### Parallel batches (`src/core/tools/concurrency.ts`)
A semaphore-capped (n=4) batcher; eligibility predicate requires every call's tool to have `annotations.readOnly === true` (and no duplicate names, unless `parallelSafe` is opted in). Results re-ordered to input order before event emission. Permission prompts resolve serially before dispatch (no dialog stacking).

### Plugin marketplace (`src/core/plugin/install/`)
Source URL scheme: `git+<url>` | `npm:<pkg>@<ver>` | `bundle:<url>` | `path:<dir>` | `<marketplace>:<plugin>`. Each installer writes to a versioned cache dir; `activateVersion` swaps an atomic symlink. Npm installer rejects `preinstall`/`install`/`postinstall` lifecycle scripts. Bundle unpacker is pure Node (PK header parsing + `zlib.inflateRaw`) — no `unzip` binary required.

### LSP (`src/core/lsp/`)
`MessageStream` parses the LSP HTTP-style framing (`Content-Length: N\r\n\r\n<body>`) handling partial chunks. `LspClient` spawns the child process, exchanges initialize, dispatches notifications/responses by id, and buffers `publishDiagnostics`. `LspManager` lazy-spawns the right server per file (via `documentSelector`). `DocumentTracker` keeps version counters per opened URI. The agent loop hooks `Write`/`Edit` → `applyChange` so diagnostics stay fresh.

---

## Quickstart

### Install (from source)

```bash
git clone https://github.com/kry4r/Nuka.git
cd Nuka
npm install
npm run build      # produces dist/cli.js
npm link           # makes `nuka` available globally
```

### Configure a provider

`~/.nuka/config.yaml`:
```yaml
providers:
  - id: anthropic
    type: anthropic
    apiKey: sk-ant-...
    model: claude-opus-4-7
defaultProvider: anthropic
```

Or for OpenAI:
```yaml
providers:
  - id: openai
    type: openai
    apiKey: sk-...
    model: gpt-4o
defaultProvider: openai
```

### Run

```bash
nuka              # interactive TUI
```

In the TUI:
- Type a prompt and hit Enter.
- `/help` for slash command list.
- `/plugin list` to see installed plugins.
- `Ctrl+C` to interrupt; second `Ctrl+C` exits.

---

## Manual test flow

After cloning and building, walk through these in order. Each step is independently verifiable; you can stop after any one.

### 0. Sanity

```bash
npm run typecheck     # expect: no errors
npm test              # expect: 850+ passing
npm run build         # expect: dist/cli.js ~240 KB
node dist/cli.js      # expect: "No providers configured" + exit 2
```

### 1. Provider wired, basic chat

Create `~/.nuka/config.yaml` with your Anthropic or OpenAI key (see Quickstart). Run `nuka`. Send a prompt like `what is 2+2?`. Expect a streaming response, no tool calls.

### 2. Built-in tools

Send: `read package.json and tell me the name`. Expect a `Read` tool call (with `(read-only)` badge in any permission prompt) and the package name in the reply.

### 3. Bash tool with permission

Send: `run "echo hello world" in bash`. Expect a permission dialog with **destructive** badge, cursor on Deny by default. Allow once → `hello world` appears in output.

### 4. MCP server

Add a stdio MCP server to `~/.nuka/config.yaml`:
```yaml
mcp:
  servers:
    fs:
      type: stdio
      command: npx
      args: [-y, "@modelcontextprotocol/server-filesystem", "/tmp"]
```

Restart. Send: `list files in /tmp`. Expect an `mcp__fs__*` tool call rendered as `fs · listDirectory`. Run with a real binary file in `/tmp` to verify image persistence — image blobs land in `~/.nuka/tmp/`.

### 5. Plugin with tool + slash command

Create `~/.nuka/plugins/hello/plugin.yaml`:
```yaml
name: hello
version: 0.1.0
tools:
  - tools/greet.js
slashCommands:
  - slash/wave.js
```

`~/.nuka/plugins/hello/tools/greet.js`:
```js
export default {
  name: 'greet',
  description: 'Greet someone',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  needsPermission: () => 'none',
  async run(input) {
    return { output: `Hello, ${input.name}!`, isError: false }
  },
}
```

`~/.nuka/plugins/hello/slash/wave.js`:
```js
export default { name: 'wave', async run() { return { text: '👋' } } }
```

Restart `nuka`. Confirm via `/plugin list` that `hello` is installed. Type `/hello:wave` → see `👋`. Send `greet me as Alice` → Alice greeting via the tool (rendered with `[plugin]` source badge).

### 6. Plugin validate

```bash
nuka plugin validate ~/.nuka/plugins/hello   # expect: clean report, exit 0
```

Break the manifest (e.g. point `tools[0]` at a missing path). Re-run → exit 2 with the specific error.

### 7. Plugin config show

```bash
nuka config show              # effective merged config
nuka config show --scope user # just user-scope
```

### 8. Hooks

Add to your hello plugin:
```yaml
hooks: hooks.json
```

`~/.nuka/plugins/hello/hooks.json`:
```json
{ "hooks": [{ "event": "afterTurn", "command": "echo turn-ended >> /tmp/nuka-hook.log" }] }
```

Restart, send any prompt. After the turn ends, `cat /tmp/nuka-hook.log` should contain `turn-ended`.

### 9. Agent swarm

Add to the hello plugin:
```yaml
agents:
  - name: reviewer
    description: Reviews code for style issues.
    systemPrompt: |
      You are a strict code reviewer. Look at any provided code and return
      bullet-point feedback only.
    allowedTools: ['Read', 'Grep', 'Glob']
    keywords: ['review']
```

Restart. Send: `dispatch the reviewer to look at src/cli.tsx`. The main agent should call `dispatch_agent`; in the TUI you'll see an indented `[hello:reviewer]` block. The result is inlined with `(from hello:reviewer)`. Verify isolation: the sub-agent cannot use `Bash` or `Write` (filtered out).

### 10. LSP

Install a TypeScript language server:
```bash
npm install -g typescript-language-server
```

Add to your hello plugin:
```yaml
lspServers:
  - name: ts
    command: typescript-language-server
    args: ['--stdio']
    documentSelector:
      - language: typescript
      - pattern: '*.ts'
```

Restart. Send: `lsp_diagnostics for src/cli.tsx`. The server lazy-spawns; expect a list of diagnostics (or `No diagnostics for ...`).

### 11. `/plugin` interactive flow

In the TUI:
- `/plugin list` — see hello plugin.
- `/plugin disable hello` then `/plugin list` — hello marked disabled.
- `/plugin enable hello` — re-enable.

### 12. Marketplace (optional, requires network)

```yaml
# ~/.nuka/marketplaces.json
{
  "sources": {
    "official": { "type": "url", "url": "https://plugins.nuka.dev/index.json" }
  }
}
```

Run `nuka plugin search prettier` then `nuka plugin install official:prettier` (will fail gracefully if the URL doesn't exist yet — the local fixture path is the unit-tested route).

### 13. Cleanup

```bash
rm -rf ~/.nuka/plugins/hello
rm /tmp/nuka-hook.log
```

---

## Phase history

- **Phases 1–3**: foundation — agent loop, providers, sessions, MCP minimum, basic plugins.
- **Phase 4a** (21 items): correctness gaps closed — MCP timeouts, result truncation, listRoots, resource_link auto-fetch, image persistence, tool input validation, ContentBlock-shaped results, plugin enable/disable, hooks, YAML warnings, plus elicitation, SSE, reconnect.
- **Phase 4b** (14): annotation cash-in — parallel readOnly batches, badge-aware prompts, shouldDefer/alwaysLoad scheduling, aliases, openWorld UI, typed progress; manifest metadata, `--plugin-dir`, userConfig prompt; stderr buffer, large-output persist, unicode sanitize, _meta mirror, LRU cache.
- **Phase 5** (16): marketplace + agents swarm — `marketplaces.json`, URL/git/npm/bundle install, deps closure, version cache, auto-update, blocklist, plugin validate, interactive `/plugin` TUI, options storage; agents manifest schema + loader + registry + tool filter + dispatch + dispatch_agent tool + recursion guard + parallel + TUI; outputStyles, channels, four-scope config cascade.
- **Phase 6** (1): LSP integration — JSON-RPC framing, LspClient, DocumentTracker, LspManager, manifest `lspServers[]`, three agent tools.

Each phase ships a design spec (`docs/superpowers/specs/`) + plan (`docs/superpowers/plans/`) + Gap Closure entry in `docs/superpowers/reviews/2026-04-24-phase3-vs-nuka-code.md`.

---

## License

To be decided. The codebase currently ships without an OSS license declaration — treat as all-rights-reserved by the maintainer until that changes.

## Contributing

Bug reports and design questions welcome via GitHub issues. PRs that follow the existing phase-spec / phase-plan / Gap-Closure documentation pattern are easier to review.
