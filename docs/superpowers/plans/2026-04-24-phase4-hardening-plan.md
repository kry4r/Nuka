# Nuka Phase 4 — Hardening & Extension Plan

**Spec:** `docs/superpowers/specs/2026-04-24-phase4-hardening-design.md`
**Review closing:** `docs/superpowers/reviews/2026-04-24-phase3-vs-nuka-code.md`
**Baseline:** 272 tests passing, HEAD `74df10d`.

## Conventions (inherited)

- Each task lists: files, contract, tests, acceptance.
- Tests first where feasible. One focused commit per task.
- Minimal comments; commit message style: `type(scope): subject` with HEREDOC body and `Co-Authored-By` trailer.
- Green gate per commit: `npm run typecheck` + `npm test` clean.
- YAML manifests (`plugin.yaml`) preferred; `plugin.json` fallback accepted.

## Parallel execution model

Three **mega-workstreams** run in parallel across isolated git worktrees:

| Mega | Domain | Worktree | Touches |
|---|---|---|---|
| **M1** | MCP client & protocol | `wt-phase4-mcp` | `src/core/mcp/**`, `src/core/permission/bridge.ts`, `src/core/config/schema.ts` |
| **M2** | Tool semantics | `wt-phase4-tools` | `src/core/tools/**`, `src/core/agent/loop.ts`, `src/core/provider/*.ts`, `src/tui/Messages/ToolCall.tsx` |
| **M3** | Plugin subsystem | `wt-phase4-plugin` | `src/core/plugin/**`, `src/core/hooks/**` (new), `src/core/config/schema.ts` |

**Collision points** (both M1 and M3 modify `config/schema.ts`): resolved by making schema additions ADDITIVE ONLY within each worktree. Rebase conflicts on merge will be textual (two new fields in the same object); rebase in order M2 → M1 → M3.

Within each mega, tasks run **sequentially** (subagent-driven-development).

---

## §M1 — MCP Client & Protocol

### M1.1 — Result truncation

**Files:**
- `src/core/mcp/truncate.ts` — new
- `src/core/mcp/client.ts` — apply in `callTool` + `readResource`
- `src/core/config/schema.ts` — extend
- Tests: `test/core/mcp/truncate.test.ts` + update `test/core/mcp/client.test.ts`

**Contract:**
```ts
// truncate.ts
export function truncateMcpResult(
  parts: string[],
  maxChars: number,
): { text: string; truncated: boolean; originalLength: number }
// Joins parts; if total > maxChars, keeps head + adds a truncation notice:
// "...[truncated NNN chars of MMM]..." appended to the last kept part.

// config schema addition:
export const McpConfigSchema = z
  .object({
    servers: z.record(z.string(), McpServerConfigSchema).default({}),
    maxResultChars: z.number().int().positive().default(100_000),
  })
  .optional()
```

**Acceptance:**
1. A `callTool` result with 250_000 chars text is truncated to 100_000 and the truncation notice is present.
2. Below-limit responses pass through unchanged.
3. The limit is configurable via `config.mcp.maxResultChars`.

### M1.2 — Connect + request timeouts

**Files:**
- `src/core/mcp/client.ts` — wrap `sdk.connect` and `sdk.callTool` / `readResource`
- `src/core/config/schema.ts` — add fields
- Tests: extend `test/core/mcp/client.test.ts`

**Contract:**
```ts
// config schema additions (inside McpConfigSchema):
connectTimeoutMs: z.number().int().positive().default(30_000),
requestTimeoutMs: z.number().int().positive().default(600_000),
```

Implementation sketch — a `withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T>` utility that races a rejection. On timeout:
- connect → status `{ kind: 'error', error: 'connect timeout' }`, no throw.
- callTool / readResource → returns `{ output: 'request timeout (<ms>ms)', isError: true }`.

**Acceptance:**
1. Mocked SDK `connect` that never resolves → status transitions to error within the configured timeout.
2. Mocked `callTool` that never resolves → returns an error tool result within the configured timeout.

### M1.3 — Description truncation

**Files:**
- `src/core/mcp/toolAdapter.ts` — cap tool description at 2048 chars
- `src/core/mcp/client.ts` — cap server instructions if surfaced
- Tests: new `test/core/mcp/toolAdapter.test.ts` assertions

**Contract:** constant `MAX_MCP_DESCRIPTION_CHARS = 2048` exported from `src/core/mcp/truncate.ts`; applied via a single helper `truncateDescription(s: string): string` that returns `s.slice(0, N-1) + '…'` when over the limit.

**Acceptance:** a 5_000-char description is truncated to 2048 with `…` suffix; short descriptions unchanged.

### M1.4 — ListRoots handler

**Files:**
- `src/core/mcp/client.ts` — register handler in `connect()` before `sdk.connect(transport)`
- Tests: extend `test/core/mcp/client.test.ts` via mocked SDK `setRequestHandler`

**Contract:**
```ts
sdk.setRequestHandler(ListRootsRequestSchema, async () => ({
  roots: [{ uri: pathToFileURL(process.cwd()).href, name: 'cwd' }],
}))
```

**Acceptance:** a mocked SDK that has a `setRequestHandler` spy receives the `ListRootsRequestSchema` registration exactly once per client.

### M1.5 — `resource_link` auto-fetch

**Files:**
- `src/core/mcp/client.ts` — in `callTool` content handling, if block `type === 'resource_link'`, call `this.readResource(block.uri)` inline and replace with its text
- Tests: extend `test/core/mcp/client.test.ts`

**Acceptance:** a mocked result with one `text` + one `resource_link` block produces an output containing both the text and the resource's text content (not the literal `[resource: uri]` placeholder).

### M1.6 — SSE transport

**Files:**
- `src/core/mcp/types.ts` — add `McpSseServerConfig { type: 'sse'; url; headers? }`
- `src/core/config/schema.ts` — extend discriminator
- `src/core/mcp/client.ts` — third branch in transport selection using `SSEClientTransport` from `@modelcontextprotocol/sdk/client/sse.js`
- `src/core/mcp/sdkBridge.ts` — re-export `SSEClientTransport`
- Tests: `test/core/mcp/client.test.ts` add SSE branch test with mocked `SSEClientTransport`

**Acceptance:** a config with `type: 'sse'` constructs the SSE transport; the rest of the client lifecycle unchanged.

### M1.7 — Auto-reconnect

**Files:**
- `src/core/mcp/reconnect.ts` — new
- `src/core/mcp/client.ts` — wire `onclose` handler
- Tests: `test/core/mcp/reconnect.test.ts`

**Contract:**
```ts
export type ReconnectPolicy = {
  maxAttempts: number       // default 5
  baseDelayMs: number       // default 1000
  maxDelayMs: number        // default 30_000
}
export function nextDelay(attempt: number, policy: ReconnectPolicy): number
// exponential: min(maxDelay, baseDelay * 2^(attempt-1))

export async function reconnectWithBackoff(
  doConnect: () => Promise<void>,
  policy: ReconnectPolicy,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string; attempts: number }>
```

In `McpClient`: when `sdk.onclose` fires, invalidate caches, set status `{ kind: 'error', error: 'disconnected' }`; on next `callTool`/`readResource`, call `reconnectWithBackoff` before retrying the request. After max attempts, stay in error state until `close()` + manual reconnect.

**Acceptance:** a mocked SDK that triggers `onclose` then succeeds on the next connect attempt: the next `callTool` succeeds transparently after the reconnect.

### M1.8 — Elicitation

**Files:**
- `src/core/mcp/elicitation.ts` — new
- `src/core/mcp/client.ts` — register handler in `connect()`
- `src/core/permission/bridge.ts` — add `elicit(payload): Promise<ElicitResult>`
- `src/tui/dialogs/ElicitationDialog.tsx` — new form + URL modes
- `src/tui/App.tsx` — new dialog kind `'elicitation'`
- `src/core/permission/types.ts` — elicitation payload/result types
- Tests: `test/core/mcp/elicitation.test.ts`, `test/tui/elicitationDialog.test.tsx`

**Contract:**
```ts
// elicitation.ts
export type ElicitationPayload = {
  message: string
  requestedSchema: unknown   // JSON Schema from the MCP request
  mode: 'form' | 'url'
  url?: string
}
export type ElicitationResult =
  | { action: 'accept'; content: Record<string, unknown> }
  | { action: 'decline' | 'cancel' }
```

MCP request handler deserializes the `elicitation/create` payload, calls `bridge.elicit(...)`. TUI opens `ElicitationDialog`. User submits → result bubbles back → client returns to MCP server.

**Acceptance:** a mocked MCP client that calls `sdk.request(ElicitRequestSchema, ...)` gets a deterministic `ElicitationResult` when the bridge handler returns `{ action: 'accept', content: { name: 'value' } }`.

---

## §M2 — Tool Semantics

### M2.1 — Input validation

**Files:**
- `src/core/tools/validate.ts` — new
- `src/core/tools/types.ts` — add optional `validateInput?(input): ValidationResult` to `Tool`
- `src/core/agent/loop.ts` — call validator before `tool.run`; on failure, emit `tool_result` with error, skip run
- Tests: `test/core/tools/validate.test.ts`, extend `test/core/agent/loop.test.ts`

**Contract:**
```ts
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export function validateWithJsonSchema<T>(
  input: unknown,
  parameters: Record<string, unknown>,  // tool.parameters (JSON Schema)
): ValidationResult<T>
// Converts the JSON Schema to Zod internally (OR uses the schema directly via ajv).
// Use zod, since it's already a dep. Map the common JSON Schema keywords: type, required,
// properties, items, enum, minimum, maximum, minLength, maxLength.
// Unknown keywords → ignored (not an error).
```

Agent loop integration:
```ts
const v = tool.validateInput
  ? tool.validateInput(call.input)
  : validateWithJsonSchema(call.input, tool.parameters)
if (!v.ok) {
  const result = { output: `invalid input: ${v.error}`, isError: true }
  session.messages.push(makeToolMessage(call.id, result))
  yield { type: 'tool_result', id: call.id, output: result.output, isError: true }
  continue
}
```

**Acceptance:**
1. A tool with `parameters: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } }` rejects `{}` with an error tool result; valid input passes through.
2. The permission prompt is NOT shown for invalid input.

### M2.2 — Result type widening

**Files:**
- `src/core/tools/content.ts` — new `ContentBlock` union
- `src/core/tools/types.ts` — `ToolResult.output: string | ContentBlock[]`
- `src/core/message/factories.ts` — `makeToolMessage` handles both shapes
- `src/core/message/types.ts` — widen `ToolMessage.content` if needed
- `src/core/provider/anthropic.ts` + `openai.ts` — translate array shape into provider wire format
- `src/core/agent/loop.ts` — pass through; serialize to string for `tool_result` event `output` field (event payload stays string for the UI)
- Tests: `test/core/tools/content.test.ts`, provider tests extended

**Contract:**
```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; path: string; mimeType: string }
  | { type: 'resource'; uri: string; mimeType?: string; text?: string }
```

Providers flatten `ContentBlock[]` into their native shape:
- Anthropic: map to `content: [{ type: 'text' | 'image', ... }]`.
- OpenAI: join text; for images include a note with file path.

Backward compat: if `output` is string, behave exactly as today.

**Acceptance:**
1. A tool returning `{ output: [{ type: 'text', text: 'a' }, { type: 'image', path: '/tmp/x.png', mimeType: 'image/png' }], isError: false }` round-trips through the agent loop and the Anthropic provider emits the expected content list.
2. All existing string-returning tools still work — 272 baseline tests pass.

### M2.3 — Image persistence

**Files:**
- `src/core/mcp/client.ts` — in `callTool`, when a content block is `type: 'image'` with base64 data, write to `${home}/.nuka/tmp/<ulid>.<ext>` and return `{ type: 'image', path, mimeType }` block (leverages M2.2 types)
- `src/core/mcp/paths.ts` — new; `mcpTmpDir(home)`
- Tests: `test/core/mcp/client.test.ts` image handling update

**Contract:**
```ts
export function mcpTmpDir(home: string): string
// returns `${home}/.nuka/tmp`; ensures dir exists on first write
```

MIME → extension mapping: `image/png → .png`, `image/jpeg → .jpg`, `image/gif → .gif`, `image/webp → .webp`, fallback `.bin`.

**Acceptance:** a mocked MCP result with one image content block writes the binary to disk and returns a `ContentBlock` with the path; the file contents match the decoded Base64.

### M2.4 — MCP tool annotations

**Files:**
- `src/core/tools/types.ts` — `Tool.annotations?: { readOnly?; destructive?; openWorld? }`
- `src/core/mcp/toolAdapter.ts` — read `descriptor.annotations` (MCP 2025-01 spec field) and map:
  - `annotations.readOnlyHint` → `annotations.readOnly`
  - `annotations.destructiveHint` → `annotations.destructive`
  - `annotations.openWorldHint` → `annotations.openWorld`
- Tests: extend `test/core/mcp/toolAdapter.test.ts`

**Acceptance:** a descriptor with `annotations: { readOnlyHint: true }` produces a Nuka Tool with `annotations.readOnly === true`.

### M2.5 — `userFacingName` display

**Files:**
- `src/core/mcp/names.ts` — new `formatMcpDisplayName(namespaced: string): { server: string; tool: string } | null`
- `src/tui/Messages/ToolCall.tsx` — accept `source?` and when source is `'mcp'`, parse name and render `<server> · <tool>` instead of raw `mcp__server__tool`
- Tests: extend `test/tui/toolCall.test.tsx`

**Acceptance:** a ToolCall with `name="mcp__github__listRepos"` and `source="mcp"` renders `github · listRepos` (not the raw namespaced form); non-MCP names unchanged.

---

## §M3 — Plugin Subsystem

### M3.1 — Enable/disable flag

**Files:**
- `src/core/config/schema.ts` — add `plugins: z.object({ enabled: z.array(z.string()).optional() }).optional()`
- `src/core/plugin/loader.ts` — if `config.plugins?.enabled` is defined, filter returned plugins to those in the list; undefined = load all (backward compat)
- Tests: extend `test/core/plugin/loader.test.ts`

**Contract:** if `enabled: ['foo']` is set, only the `foo` plugin loads even if `bar` is also installed.

**Acceptance:**
1. `enabled: ['a']` with `a` + `b` on disk → only `a` returned.
2. `enabled` unset → both returned (no regression).

### M3.2 — Plugin hooks

**Files:**
- `src/core/hooks/types.ts` — new
- `src/core/hooks/loader.ts` — new
- `src/core/hooks/runner.ts` — new
- `src/core/plugin/manifest.ts` — `hooks?: string` (relative path to `hooks.json`)
- `src/core/plugin/wire.ts` — load hooks, push into hooks registry
- `src/core/agent/loop.ts` — invoke `beforeToolCall` + `afterToolCall` + `afterTurn` at the right seams
- `src/core/compact/auto.ts` — invoke `beforeAutoCompact`; honor veto
- Tests: `test/core/hooks/{loader,runner}.test.ts`, loop integration test

**Contract:**
```ts
// types.ts
export type HookEvent =
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'afterTurn'
  | 'beforeAutoCompact'

export type HookEntry = {
  event: HookEvent
  tool?: string              // filter: only fire for this tool name (beforeToolCall/afterToolCall)
  command: string            // shell command; payload JSON piped to stdin
  timeoutMs?: number         // default 10_000
}

export type HookResult =
  | { ok: true; cancel?: boolean; reason?: string; stdout: string }
  | { ok: false; error: string }
```

`hooks.json` format (loaded per plugin):
```json
{
  "hooks": [
    { "event": "beforeToolCall", "tool": "Bash", "command": "/abs/path/audit.sh" },
    { "event": "afterTurn", "command": "notify-send 'Nuka turn done'" }
  ]
}
```

Runner spawns each hook via `execa` with JSON stdin; non-zero exit + `cancel: true` in stdout JSON → cancels the operation (for cancelable events). Swallowed exceptions log warning.

**Acceptance:**
1. A plugin with a `beforeToolCall` hook that exits 1 → the tool run is skipped with a message explaining the hook cancelled it.
2. An `afterTurn` hook fires once per turn end; non-fatal failures don't interrupt the agent loop.
3. A `beforeAutoCompact` hook returning cancel=true prevents compaction.

### M3.3 — Marketplace + git install

**Files:**
- `src/core/plugin/marketplace.ts` — new
- `src/core/plugin/gitInstall.ts` — new
- `src/core/plugin/install.ts` — extend to dispatch on source type (local path | git URL | marketplace ref)
- `src/cli.tsx` — extend `plugin install` command; add `plugin search <query>` and `plugin marketplace add/remove/list`
- `src/core/config/paths.ts` — `marketplacesPath(home)` = `${home}/.nuka/marketplaces.json`
- Tests: `test/core/plugin/marketplace.test.ts`, `test/core/plugin/gitInstall.test.ts`

**Contract:**
```ts
// marketplace.ts
export type MarketplaceSource =
  | { type: 'url'; url: string }       // https endpoint returning MarketplaceIndex JSON
  | { type: 'git'; git: string; branch?: string }

export type MarketplaceIndex = {
  plugins: Array<{
    name: string
    description?: string
    source: string                     // path inside the marketplace repo, OR url
    version?: string
  }>
}

export async function loadMarketplaceConfig(home: string): Promise<Record<string, MarketplaceSource>>
export async function fetchMarketplaceIndex(source: MarketplaceSource): Promise<MarketplaceIndex>
export async function resolvePluginRef(
  ref: string,                         // e.g. "official:prettier" or "./local-path"
  home: string,
): Promise<{ source: string; plugin: MarketplaceIndex['plugins'][number] | null }>
```

Git install (`gitInstall.ts`):
```ts
export async function cloneForInstall(opts: {
  gitUrl: string
  branch?: string
  home: string                         // writes to `${home}/.nuka/cache/git/<repoId>/`
}): Promise<string>                    // returns the clone path
```

Use `execa` to shell out to `git`. Require a readable `git --version`; fail with a clear message otherwise.

**CLI:**
- `nuka plugin search <q>` — lists matches from all marketplaces (name contains substring OR description contains).
- `nuka plugin install <ref>` — `ref` is `marketplace:name` OR `path/to/dir` OR `https://github.com/user/repo` (detected as git URL).
- `nuka plugin marketplace add <name> <source-json-literal>` — appends to `marketplaces.json`.
- `nuka plugin marketplace list` — prints configured sources.

**Acceptance:**
1. A marketplace URL returning a fixed JSON is searched; matching plugin installs via the underlying local/git path.
2. A git URL installs via a shallow clone, then copies the resolved plugin dir.
3. `marketplaces.json` is created atomically (tmp + rename).

### M3.4 — Plugin dependencies

**Files:**
- `src/core/plugin/manifest.ts` — add `dependencies: z.array(z.string()).default([])`
- `src/core/plugin/deps.ts` — new
- `src/core/plugin/install.ts` — after install, resolve deps (DFS); prompt user to install each missing
- `src/core/plugin/loader.ts` — at load time, if a declared dep isn't installed, skip the plugin with warn
- Tests: `test/core/plugin/deps.test.ts`

**Contract:**
```ts
// deps.ts
export async function resolveDeps(
  plugin: PluginManifest,
  installed: PluginManifest[],
  index: (name: string) => Promise<PluginManifest | null>,
): Promise<{
  missing: string[]                    // names not installed and not resolvable
  toInstall: string[]                  // resolved order (topological, reverse DFS)
  cycles: string[][]                   // detected cycles (names)
}>
```

**Acceptance:**
1. Plugin A declares `dependencies: ['B']`; B is not installed but available in a marketplace → `toInstall: ['B']`.
2. A declares B, B declares A → cycle detected, install rejected.
3. Load-time: A declares B, B not installed → A skipped with a warning.

---

## Completion gate

- All 11 unintended gaps closed — update the review doc with a "Gap Closure" appendix per item.
- `npm test` ≥ 320 passing (272 baseline + ~50).
- `npm run typecheck` clean.
- `npm run build` — `dist/cli.js` ≤ 250 KB.
- Three mega branches merged into `main` in order M2 → M1 → M3.

## Execution

See `../phase4-parallel-dispatch-prompt.md` (sibling file produced alongside this plan) for the ready-to-paste subagent orchestration prompt.
