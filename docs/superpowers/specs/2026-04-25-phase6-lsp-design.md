# Nuka Phase 6 — LSP Integration Design Spec

**Status:** active. Successor to Phase 5. Phase 5 complete on `main` at commit `8106606`; 770 tests passing; `dist/cli.js` 212.4 KB.

**Reference:** closes the 17th Phase-5 item that was deliberately deferred (5.M5.4) — plugin-declared LSP servers feeding diagnostics and code-navigation signals into the agent loop.

---

## 1. Goals

1. **LSP client** — Nuka can spawn and talk to LSP servers (stdio transport) following the LSP 3.17 spec subset: `initialize`, `initialized`, `textDocument/didOpen`, `textDocument/didChange`, `textDocument/didClose`, `textDocument/publishDiagnostics`, `textDocument/definition`, `textDocument/references`, `textDocument/hover`, `shutdown`, `exit`.
2. **Plugin-declared LSP servers** — `manifest.lspServers[]` declares language servers per plugin. On wire, each server is registered with `LspManager`; lazy-spawned on first use.
3. **Agent-facing tools** — three new built-in tools the main agent can use:
   - `lsp_diagnostics(path)` — current diagnostics for a file.
   - `lsp_definition(path, line, character)` — go-to-definition.
   - `lsp_references(path, line, character)` — find references.
4. **Document sync** — when any of the LSP tools is invoked, Nuka opens the file via `didOpen` and tracks document version for the session; subsequent edits via `Write`/`Edit` tools fire `didChange`.

## 2. Non-goals

- Full LSP coverage (no completions, code actions, formatting, semantic tokens, workspace symbols, rename — these require deeper TUI integration than warranted for an agent-driven CLI).
- Multiple workspace folders / multi-root projects — single root (cwd) only.
- LSP push-side diagnostics streaming to TUI — diagnostics are pulled on demand via the tool.
- Network LSP transports (TCP, websocket) — stdio only.
- LSP-spec compliance certification — pragmatic subset.

## 3. Module layout

### Existing modules modified
- `src/core/plugin/manifest.ts` — add `lspServers?: Array<LspServerDef>`.
- `src/core/plugin/wire.ts` — register each LSP server with `LspManager` on wire.
- `src/core/agent/loop.ts` — emit `didChange` notifications when `Write`/`Edit` tools modify tracked files.
- `src/cli.tsx` — wire `LspManager` into runtime; register the three tools when at least one LSP server is configured.

### New modules
- `src/core/lsp/types.ts` — `LspServerDef`, `LspDiagnostic`, `LspLocation`, `LspHover`.
- `src/core/lsp/jsonrpc.ts` — minimal LSP framing (Content-Length headers + JSON body) over a child stdio.
- `src/core/lsp/client.ts` — `LspClient` class (initialize/shutdown lifecycle, request/response via id, notification dispatch, diagnostics buffer).
- `src/core/lsp/manager.ts` — `LspManager` (per-language-id clients, lazy spawn, file→client routing via `documentSelector`).
- `src/core/lsp/documentTracker.ts` — open-document state per client, version counter, sync helpers.
- `src/core/lsp/tools.ts` — `makeLspDiagnosticsTool`, `makeLspDefinitionTool`, `makeLspReferencesTool`.

## 4. Design decisions

### 4.1 LSP server declaration

```ts
export type LspServerDef = {
  name: string                          // unique per plugin; namespaced as <plugin>:<name>
  command: string                       // executable, e.g. "typescript-language-server"
  args?: string[]                       // e.g. ["--stdio"]
  documentSelector: Array<{
    language?: string                   // LSP language id, e.g. "typescript"
    pattern?: string                    // glob; matches absolute file paths
  }>
  initializationOptions?: unknown       // forwarded as-is to the server
  rootUri?: string                      // default: file:// + cwd
  env?: Record<string, string>
}
```

Multiple plugins can declare LSP servers for overlapping selectors — first registration wins; the rest are skipped with a warning (mirrors MCP server name-collision handling).

### 4.2 Lifecycle

`LspManager.startAll()` does NOT spawn anything — lazy. On first tool invocation matching a server's `documentSelector`:
1. Spawn the child process with stdio piping.
2. Send `initialize` with capabilities advertising `textDocument.synchronization.didOpen/didChange/didClose`, `definition`, `references`, `publishDiagnostics`.
3. Await response, send `initialized`.
4. Track the live client; reuse for subsequent calls.

`shutdown()` — sends `shutdown` request + `exit` notification; gives 3s for the process to die, then SIGKILL.

### 4.3 JSON-RPC framing

LSP uses HTTP-style framing: `Content-Length: N\r\n\r\n<body>`. Implement a minimal stream parser:
- Read bytes from child stdout.
- Parse header section (split on `\r\n\r\n`).
- Read body of declared length.
- Parse JSON; route by `id` (response) or `method` (notification).

Outbound: same framing, written to child stdin.

### 4.4 Document sync

`documentTracker.ts` maintains per-client `Map<uri, { version: number; languageId: string; text: string }>`. APIs:
- `ensureOpen(uri, text, languageId)` — sends `didOpen` if not already; bumps to version 1.
- `applyChange(uri, newText)` — sends `didChange` with full-document sync (LSP allows incremental but full is simpler and Nuka files are small); bumps version.
- `close(uri)` — sends `didClose`; removes from map.

Agent loop integration: after `Write`/`Edit` tool runs successfully, if any LSP client has the touched path open, send `applyChange`.

### 4.5 Diagnostics buffer

Each `LspClient` maintains a `Map<uri, LspDiagnostic[]>`. The `publishDiagnostics` notification updates this map. `lsp_diagnostics` tool reads from it (no fresh request needed — LSP servers push diagnostics on every meaningful change).

If the file hasn't been opened yet: `lsp_diagnostics` opens it, waits up to 2s for the first diagnostics push, then returns whatever is buffered (often empty for clean files).

### 4.6 Tool surface

Three minimal tools:
```ts
// lsp_diagnostics
parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }
// returns: text — formatted diagnostics list (severity, line:col, message)

// lsp_definition
parameters: { ..., required: ['path','line','character'], ... }
// returns: text — list of "<file>:<line>:<char>" hits

// lsp_references
parameters: { ..., required: ['path','line','character'], ... }
// returns: text — list of "<file>:<line>:<char>" hits
```

All three carry annotations:
```ts
{ readOnly: true, destructive: false, openWorld: false }
```
Parallel-safe via 4b.M2.7.

### 4.7 Failure modes

- Server fails to spawn (binary not found): `lsp_*` tools return `isError: true` with a clear message; subsequent calls retry once before giving up for the session.
- `initialize` times out (10s): same as spawn failure.
- Server crashes mid-session: `LspClient` watchdog detects child exit; tools return error until next session restart (no auto-respawn — keep simple).
- File not matched by any `documentSelector`: tools return `"no LSP server registered for <path>"`.

## 5. Acceptance

Phase 6 complete when:
- `npm test` ≥ 800 passing (770 baseline + ~30 new — LSP tests use a mock server fixture, no real `typescript-language-server` requirement).
- `npm run typecheck` clean.
- `npm run build` — `dist/cli.js` ≤ 250 KB target, ≤ 300 KB hard ceiling.
- Manifest `lspServers[]` validates; `wirePlugin` registers servers.
- The three tools work against a mocked LSP child process (stdio + JSON-RPC framing + diagnostics buffer + definition/references).

## 6. Out of scope (Phase 7+)

- LSP completions / hover / formatting / code actions / semantic tokens / rename / workspace symbols.
- Multiple workspace folders.
- Push diagnostics into TUI status line.
- TCP / websocket LSP transports.
- LSP server auto-install (depends on plugin marketplace from Phase 5).
