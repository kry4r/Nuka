# Nuka Phase 6 — LSP Integration Plan

**Spec:** `docs/superpowers/specs/2026-04-25-phase6-lsp-design.md`
**Baseline:** 770 tests passing, HEAD `8106606`; `dist/cli.js` 212.4 KB.

## Conventions

- Each task lists: files, contract, acceptance.
- Tests first where feasible. One focused commit per task.
- Commit style: `type(scope): subject` + HEREDOC body + `Co-Authored-By` trailer.
- Green gate per commit: `npm run typecheck` + `npm test` clean.
- No new deps.

## Single workstream — sequential tasks

Phase 6 is small enough (single subsystem, ~6 tasks) to run in a single worktree without parallelism. No merge sequence overhead.

| Task | Subject |
|---|---|
| 6.1 | LSP types + JSON-RPC framing |
| 6.2 | `LspClient` with lifecycle + diagnostics buffer |
| 6.3 | Document tracker (`didOpen` / `didChange` / `didClose`) |
| 6.4 | `LspManager` with documentSelector routing + lazy spawn |
| 6.5 | Manifest `lspServers[]` + wire integration |
| 6.6 | Three agent-facing tools (diagnostics / definition / references) + agent-loop didChange hook |

---

### 6.1 — LSP types + JSON-RPC framing

**Files:**
- `src/core/lsp/types.ts` — new.
- `src/core/lsp/jsonrpc.ts` — new.
- Tests: `test/core/lsp/jsonrpc.test.ts`.

**Contract:**
```ts
export type LspServerDef = {
  name: string
  command: string
  args?: string[]
  documentSelector: Array<{ language?: string; pattern?: string }>
  initializationOptions?: unknown
  rootUri?: string
  env?: Record<string, string>
}

export type LspDiagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: 1 | 2 | 3 | 4   // Error | Warning | Information | Hint
  message: string
  source?: string
}

export type LspLocation = {
  uri: string
  range: LspDiagnostic['range']
}

// jsonrpc.ts
export type JsonRpcRequest = { jsonrpc: '2.0'; id: number; method: string; params?: unknown }
export type JsonRpcResponse = { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string } }
export type JsonRpcNotification = { jsonrpc: '2.0'; method: string; params?: unknown }

export function encodeMessage(msg: unknown): Buffer
// Produces "Content-Length: N\r\n\r\n<body>" buffer.

export class MessageStream {
  push(chunk: Buffer): void
  read(): Array<JsonRpcResponse | JsonRpcNotification>  // returns parsed messages, drains internal buffer
}
```

**Acceptance:**
1. `encodeMessage({jsonrpc:'2.0',id:1,method:'foo'})` produces a buffer with the right Content-Length and body.
2. `MessageStream.push` with a chunk containing two complete framed messages → `read()` returns both, in order.
3. `MessageStream.push` with a partial frame → `read()` returns nothing; another push completing the frame → message is delivered.

### 6.2 — `LspClient` with lifecycle + diagnostics buffer

**Files:**
- `src/core/lsp/client.ts` — new.
- Tests: `test/core/lsp/client.test.ts` (uses a mock child process).

**Contract:**
```ts
export class LspClient {
  constructor(opts: { def: LspServerDef; rootUri?: string })
  async start(): Promise<void>          // spawn + initialize + initialized
  async shutdown(): Promise<void>        // shutdown + exit, SIGKILL after 3s
  async request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  notify(method: string, params?: unknown): void
  diagnosticsFor(uri: string): LspDiagnostic[]
  onDiagnostics(uri: string, cb: (diags: LspDiagnostic[]) => void): () => void  // returns unsubscribe
  status: 'idle' | 'starting' | 'ready' | 'error' | 'closed'
}
```

`start()` flow: spawn child via `child_process.spawn`, pipe stdio, attach `MessageStream` to stdout, send `initialize`, await response (10s timeout), send `initialized` notification. On any failure, set status='error' and the next `request`/`notify` rejects/throws.

Diagnostics: `publishDiagnostics` notification → update internal `Map<uri, LspDiagnostic[]>`; fire subscribers.

**Acceptance:**
1. Mock LSP child returning a successful initialize response → `start()` resolves; status='ready'.
2. Mock child that never responds to initialize → `start()` rejects after 10s; status='error'.
3. Mock pushes `publishDiagnostics` → `diagnosticsFor(uri)` returns the diagnostics; subscribers fire.
4. `shutdown()` sends `shutdown` request + `exit` notification; status='closed' after.

### 6.3 — Document tracker

**Files:**
- `src/core/lsp/documentTracker.ts` — new.
- Tests: `test/core/lsp/documentTracker.test.ts`.

**Contract:**
```ts
export class DocumentTracker {
  constructor(client: LspClient)
  async ensureOpen(uri: string, text: string, languageId: string): Promise<void>
  async applyChange(uri: string, newText: string): Promise<void>
  async close(uri: string): Promise<void>
  isOpen(uri: string): boolean
  versionOf(uri: string): number | undefined
}
```

`ensureOpen`: if already open, no-op. Otherwise sends `textDocument/didOpen` with version 1.
`applyChange`: requires the doc to be open. Sends `textDocument/didChange` with full-document sync (`{ contentChanges: [{ text: newText }] }`); bumps version.
`close`: sends `textDocument/didClose`; removes from map.

**Acceptance:**
1. `ensureOpen` twice for same uri → only one `didOpen` sent.
2. `applyChange` after `ensureOpen` → `didChange` sent with version 2.
3. `close` removes the entry; subsequent `applyChange` throws `"document not open"`.

### 6.4 — `LspManager` with documentSelector routing + lazy spawn

**Files:**
- `src/core/lsp/manager.ts` — new.
- Tests: `test/core/lsp/manager.test.ts`.

**Contract:**
```ts
export class LspManager {
  register(def: LspServerDef): { ok: true } | { ok: false; reason: string }
  // collision policy: first wins; later registrations skipped with reason='already registered for selector'
  async clientFor(filePath: string): Promise<LspClient | null>
  // returns the matching client (lazy-spawning if needed); null if no selector matches
  list(): LspServerDef[]
  async closeAll(): Promise<void>
  trackerFor(client: LspClient): DocumentTracker
}
```

`documentSelector` matching: a def matches a file path if any selector entry matches:
- `language` matches the file's inferred language ID (extension-based map: `.ts` → `typescript`, `.js` → `javascript`, `.py` → `python`, `.go` → `go`, `.rs` → `rust`; fallback to extension itself).
- `pattern` (minimal glob: `*` only) matches the basename or full path.

**Acceptance:**
1. Two registrations for the same selector → second returns `{ok:false}` with reason.
2. `clientFor('/tmp/foo.ts')` with a registered TS server → spawn-on-demand, returns client.
3. `clientFor('/tmp/foo.unknown')` → returns null.
4. `closeAll()` shuts down every spawned client.

### 6.5 — Manifest `lspServers[]` + wire integration

**Files:**
- `src/core/plugin/manifest.ts` — add `lspServers?: Array<LspServerDef>`.
- `src/core/plugin/wire.ts` — register each `lspServers[]` entry with `deps.lsp` (new optional dep on `wirePlugin`).
- Tests: extend `test/core/plugin/manifest.test.ts`, `test/core/plugin/wire.test.ts`.

**Acceptance:**
1. Manifest with `lspServers: [{name:'ts', command:'tsserver', ...}]` parses.
2. `wirePlugin` with `deps.lsp = new LspManager()` calls `register` once per entry; `lspAdded` count returned.
3. Collision (two plugins same selector) → second skipped, error reported in wire result.

### 6.6 — Three agent-facing tools + didChange hook in agent loop

**Files:**
- `src/core/lsp/tools.ts` — `makeLspDiagnosticsTool`, `makeLspDefinitionTool`, `makeLspReferencesTool`.
- `src/cli.tsx` — instantiate `LspManager`, register tools when manager has at least one server.
- `src/core/agent/loop.ts` — after `Write`/`Edit` tool runs successfully and if any LSP client has the file open, fire `applyChange` (non-blocking).
- Tests: `test/core/lsp/tools.test.ts`, extend loop tests.

**Tool contracts:**
```ts
// All three: parameters JSON Schema { type:'object', required:[...], properties:{...} }
// All three: annotations { readOnly: true, destructive: false, openWorld: false }
// All three: parallelSafe: true (eligible for 4b.M2.7 parallel execution)

// lsp_diagnostics({ path: string }): text
//   "<sev> <line>:<col> <message> [<source>]" lines, joined.
//   Empty result: "No diagnostics for <path>".

// lsp_definition({ path, line, character }): text
//   "<file>:<line>:<col>" lines (1-based for human reading).
//   Empty result: "No definition found at <path>:<line>:<col>".

// lsp_references({ path, line, character }): text
//   Same shape as definition.
```

`Write`/`Edit` integration: in agent-loop, after a successful tool run that produces a file path side-effect, call `lspManager.notifyFileChanged(path, newText)` which routes to the matching client's tracker. Add a tiny `notifyFileChanged` helper on `LspManager`.

**Acceptance:**
1. With a mocked client returning a fixed diagnostic, `lsp_diagnostics({path})` returns the formatted line.
2. `lsp_definition` returns the LSP-server-provided locations formatted.
3. After `Write` modifies a tracked file, `applyChange` is called with the new text (verified via spy on the tracker).
4. Three tools registered iff at least one LSP server is configured (otherwise: not registered).

---

## Completion gate

- 6 commits on `main` covering all 6 tasks.
- `npm test` ≥ 800 passing.
- `npm run typecheck` clean.
- `npm run build` — `dist/cli.js` ≤ 300 KB hard ceiling.
- Append "Phase 6 Gap Closure" to the review doc with each task ID → commit SHA.
