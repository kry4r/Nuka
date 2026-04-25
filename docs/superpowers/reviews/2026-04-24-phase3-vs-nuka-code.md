# Phase 3 vs Nuka-Code Review (2026-04-24)

## Context

Nuka Phase 3 (commits `1f242b4`–`1e436eb`) implemented a minimal MCP client, local-dir plugin system, and unified tool registry per spec §6 of `2026-04-23-nuka-rewrite-design.md`. Nuka-Code is the reference codebase from which Nuka is an independent rewrite — it is large (~3,300-line MCP client, ~3,300-line plugin loader, 40+ plugin utility files) and feature-rich. This review identifies every behavioral divergence as intentional scope cut, deferred, or unintended gap, and prioritizes the gaps that could bite users.

---

## L1 — MCP Client

### What Nuka has

- `src/core/mcp/types.ts` — `McpStdioServerConfig`, `McpHttpServerConfig`, `McpConnectionStatus` (4 states), `McpToolDescriptor`, `McpResourceDescriptor`
- `src/core/mcp/client.ts` — `McpClient` class: connect, listTools (cached), listResources (cached), callTool (text/image/resource_link → string), readResource, close
- `src/core/mcp/manager.ts` — `McpManager`: `startAll` (parallel, errors non-fatal), `status`, `listClients`, `findClient`, `closeAll`, `onChange`
- `src/core/mcp/toolAdapter.ts` — `mcpToolsFor(client)`: maps MCP tools to Nuka `Tool` interface
- `src/core/mcp/resourceTools.ts` — `makeListMcpResourcesTool` and `makeReadMcpResourceTool` builtins
- `src/core/mcp/names.ts` — `buildMcpToolName`, `parseMcpToolName`, `normalizeMcpName`
- `src/core/mcp/sdkBridge.ts` — thin re-export for testability

Commits: `46c6d71` (client + manager + tool adapter), `697fe7d` (types + config + names), `3b46f7d` (types).

### What Nuka-Code has

- `src/services/mcp/client.ts` (3348 lines): covers 8 transport types (stdio, sse, sse-ide, ws-ide, ws, http, sdk, claudeai-proxy), OAuth 2.0 + XAA token exchange, per-server auth-needs cache, connection timeout wrapper, fetch timeout wrapper (60 s per POST, GET excluded for SSE), auto-reconnect on `onclose` / terminal errors / session expiry (HTTP 404 + `-32001`), elicitation handler (form + URL modes), server instruction truncation (2048 chars), tool description truncation (2048 chars), in-process transport (Chrome MCP, Computer Use), unicode sanitization on tool results, `stderr` capture from stdio processes, memoized connection cache with LRU eviction, `CLAUDE_CODE_SHELL_PREFIX` support, `ListRoots` server request handler, `roots` capability declaration, analytics events (`tengu_mcp_server_*`).
- `src/services/mcp/auth.ts` — full OAuth 2.0 PKCE + refresh flow with lockfile, keychain storage, XAA (cross-app access / SEP-990).
- `src/services/mcp/elicitationHandler.ts` — form + URL elicitation request lifecycle.
- `src/services/mcp/normalization.ts` — name normalization with claude.ai server prefix handling.
- `src/services/mcp/mcpStringUtils.ts` — `buildMcpToolName`, `getMcpPrefix`, `getMcpDisplayName`, permission-check name helper.
- `src/services/mcp/MCPConnectionManager.tsx`, `src/services/mcp/useManageMCPConnections.ts` — React hook for reactive connection management.
- `src/tools/MCPTool/` — `MCPTool.ts` + `UI.tsx` + `classifyForCollapse.ts` + `prompt.ts`: per-tool render, collapse classification, `maxResultSizeChars: 100_000`, `isResultTruncated`, `isConcurrencySafe` (from `readOnlyHint` annotation), `isDestructive` (from `destructiveHint`), `isOpenWorld` (from `openWorldHint`), `alwaysLoad`, `searchHint`, progress events (`mcp_progress.started/completed`).
- `src/utils/mcpValidation.ts`, `src/utils/mcpOutputStorage.ts` — `mcpContentNeedsTruncation`, `truncateMcpContentIfNeeded`, `persistToolResult` (large-output file persistence).

### Divergence Matrix

| Feature | Nuka | Nuka-Code | Classification |
|---------|------|-----------|----------------|
| stdio transport | ✅ | ✅ | aligned |
| streamable-http transport | ✅ | ✅ | aligned |
| SSE transport | ❌ | ✅ (`sse`) | intentional scope cut (spec §6: stdio + http only) |
| SSE-IDE transport | ❌ | ✅ (`sse-ide`) | intentional scope cut (IDE integration out of scope) |
| WebSocket transport (`ws`) | ❌ | ✅ | deferred (Phase 4+) |
| WebSocket-IDE transport (`ws-ide`) | ❌ | ✅ | intentional scope cut |
| In-process SDK transport | ❌ | ✅ (`sdk` type) | deferred (Phase 4+) |
| Claude.ai proxy transport | ❌ | ✅ (`claudeai-proxy`) | intentional scope cut |
| OAuth 2.0 / PKCE for SSE + HTTP | ❌ | ✅ | intentional scope cut (spec §6 excludes auth) |
| XAA / SEP-990 cross-app access | ❌ | ✅ | intentional scope cut |
| Elicitation (form + URL modes) | ❌ | ✅ | deferred (Phase 4+) |
| Tool result size limits + truncation | ❌ | ✅ (`maxResultSizeChars: 100_000`, `truncateMcpContentIfNeeded`) | **unintended gap** — Nuka's `callTool` returns the full string unchecked; a server returning 10 MB of text will blow up the context window |
| Tool result persistence to disk | ❌ | ✅ (`persistToolResult`) | deferred (Phase 4+); depends on size-limit gap above |
| Image blob handling | ❌ (summary placeholder `[binary: …]`) | ✅ (resize + downsample, inline as Base64 if small) | **unintended gap** — Nuka drops image content; MCP tools that return images (screenshots, diagrams) produce useless output |
| resource_link lazy fetch | ❌ (prints `[resource: <uri>]`) | ✅ (fetches via `readResource` inline) | **unintended gap** — resource_link blocks are inert; the model sees a label instead of content |
| Tool description truncation | ❌ | ✅ (2048 chars) | **unintended gap** — OpenAPI-generated MCP servers with 60 KB tool descriptions will overflow the prompt |
| Server instruction truncation | ❌ | ✅ (2048 chars) | **unintended gap** (same cause) |
| Per-request fetch timeout | ❌ | ✅ (60 s per POST, bypass for SSE GET) | **unintended gap** — a hung HTTP server will hang the agent loop forever |
| Connection timeout (`MCP_TIMEOUT` env, 30 s default) | ❌ | ✅ | **unintended gap** — slow stdio startup hangs the CLI |
| Auto-reconnect on transport close | ❌ | ✅ (clears memo cache, re-connects on next call) | deferred (Phase 4+); session stability |
| Reconnect on session expiry (HTTP 404 + -32001) | ❌ | ✅ | deferred (Phase 4+) |
| `stderr` capture from stdio transport | ❌ | ✅ (64 MB cap, logged on connection failure) | deferred (Phase 4+); debugging aid |
| `ListRoots` server request handler | ❌ | ✅ (returns current working dir) | **unintended gap** — some MCP servers (e.g., filesystem servers) require `roots` to scope their operations |
| `roots` capability declaration | ❌ | ✅ | same as above |
| Tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) | ❌ | ✅ → `isConcurrencySafe`, `isReadOnly`, `isDestructive`, `isOpenWorld` | deferred (Phase 4+); affects permission UX and concurrency |
| `searchHint` / `alwaysLoad` via `_meta` | ❌ | ✅ | deferred (Phase 4+); deferred-tool loading optimization |
| Unicode sanitization on tool results | ❌ | ✅ (`recursivelySanitizeUnicode`) | deferred (Phase 4+) |
| `CLAUDE_CODE_SHELL_PREFIX` (sandbox wrapper) | ❌ | ✅ | intentional scope cut |
| Analytics events | ❌ | ✅ (`tengu_mcp_server_*`) | intentional scope cut (no telemetry in Phase 1–3) |
| Config scope (`local`/`user`/`project`/`enterprise`) | ❌ (single flat config) | ✅ (`ConfigScope` + `ScopedMcpServerConfig`) | deferred (Phase 4+) |
| `pluginSource` on server config | ❌ | ✅ (channel gate at config-build time) | deferred (Phase 4+); needed once channel gates arrive |
| memoized connection cache (keyed by name+config) | basic instance cache | ✅ (LRU, explicit key, `clearServerCache`) | deferred (Phase 4+) |

### Risks / Follow-ups

- **Tool result size** (`maxResultSizeChars` absent): a pathological MCP server can inject hundreds of KB into a single message, exhausting context and inflating cost. Suggested fix: add a `MAX_MCP_RESULT_CHARS` constant (e.g., 100 000) in `client.ts::callTool`; truncate with an appended `"… [truncated: N chars total]"` note. One-line patch; no new deps. Priority: **ship before any public demo with untrusted MCP servers**.
- **Image blobs**: Nuka currently emits `[binary: image/png len=34567]`. For screenshot-capable tools (e.g., Playwright MCP) this makes every call useless. Suggested fix: detect `image/*` MIME and either (a) persist to temp file + return path (simple), or (b) pass through as a structured block. Minimum viable: persist + path string.
- **resource_link lazy fetch**: resource links are silently discarded. This is invisible to users but causes incorrect agent behavior when tools return resource pointers (common in filesystem and database MCP servers). Suggested fix: when a content block is `resource_link`, immediately call `client.readResource(block.uri)` and append the content. Can fail gracefully.
- **Tool/server description truncation**: missing guard means a server with a large OpenAPI spec silently blows up the prompt. Add truncation in `toolAdapter.ts` before constructing the `Tool` object.
- **Per-request timeout**: `client.callTool` calls `sdk.callTool` with no timeout signal forwarded beyond the `AbortSignal` passed in from the agent. If the caller does not pass a signal (or passes a never-aborted one), the call hangs indefinitely. Wrap the `sdk.callTool` call with a `Promise.race` against a `setTimeout(10 min)` fallback.
- **`ListRoots` handler absent**: servers that call `roots/list` during initialization will either error or fall back to cwd. Not registering the handler is spec-non-conformant. Add a `client.setRequestHandler(ListRootsRequestSchema, …)` returning `[{ uri: \`file://${process.cwd()}\` }]` before `client.connect`.

---

## L2 — Plugin System

### What Nuka has

- `src/core/plugin/manifest.ts` — `PluginManifestSchema`: 7 fields (`name`, `version`, `description`, `tools[]`, `slashCommands[]`, `skills[]`, `mcpServers{}`), Zod-validated; `LoadedPlugin` type
- `src/core/plugin/loader.ts` — `loadPlugins({ home })`: scans `~/.nuka/plugins/*/plugin.yaml|json`; skips malformed entries with `console.warn`
- `src/core/plugin/wire.ts` — `wirePlugin`: dynamically imports JS tool/slash modules; reads skill markdown; merges MCP server configs; namespaces names (`plugin__<name>__<raw>`, `<name>:<raw>`)
- `src/core/plugin/install.ts` — `installPluginFromPath`: validates manifest, confirms with caller callback, `fs.cp` recursive copy to `~/.nuka/plugins/<name>/`

Commits: `ab94f85` (wire), `98d775b` (manifest + loader), `34d7e05` (install CLI).

### What Nuka-Code has

- `src/utils/plugins/schemas.ts` (1681 lines): `PluginManifestSchema` with ~18 top-level keys: `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `dependencies[]` (dep resolution), `hooks` (inline or JSON file path), `commands` (slash commands — path/array/object-mapping format), `agents`, `skills`, `outputStyles`, `channels` (with allowlists, notification configs), `mcpServers` (inline, `.mcp.json` path, or `.mcpb`/`.dxt` MCPB bundle), `lspServers` (LSP config with 12 fields), `settings` (settings cascade contribution), `userConfig` (user-prompted config at enable time).
- `src/utils/plugins/pluginLoader.ts` (3302 lines): marketplace-based plugin discovery (git clone, npm package, URL fetch, local file); versioned cache paths (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`); ZIP cache (`extractZipToDirectory`); seed directories; legacy cache compat; dependency closure via `verifyAndDemote`; hooks loading + variable substitution; duplicate name detection with source tracking; enable/disable state via settings cascade; `--plugin-dir` session-only plugins; builtin plugin support.
- `src/utils/plugins/marketplaceManager.ts` — full marketplace lifecycle: URL fetch, git clone (`git clone --depth 1`), npm package, local path; `known_marketplaces.json` config; cache invalidation; refresh on startup.
- `src/utils/plugins/dependencyResolver.ts` — `resolveDependencyClosure` (DFS + cycle detection), `verifyAndDemote` (load-time fixed-point: disable plugins whose deps are absent).
- `src/utils/plugins/pluginPolicy.ts` — `isPluginBlockedByPolicy` (managed-settings.json / org MDM).
- `src/utils/plugins/pluginBlocklist.ts` — `detectDelistedPlugins`, auto-uninstall on marketplace delist.
- `src/utils/plugins/pluginAutoupdate.ts` — background git-pull autoupdate for official marketplaces.
- `src/utils/plugins/validatePlugin.ts` — `claude plugin validate` command: error + warning reporting for authors.
- `src/commands/plugin/` (17 files) — interactive `plugin` slash command: `ManagePlugins`, `BrowseMarketplace`, `AddMarketplace`, `ManageMarketplaces`, `PluginSettings`, `PluginOptionsDialog`, `PluginOptionsFlow`, `PluginTrustWarning`, `ValidatePlugin`, `DiscoverPlugins`.
- `src/utils/plugins/pluginAutoupdate.ts`, `src/utils/plugins/installedPluginsManager.ts`, `src/utils/plugins/reconciler.ts` — installed plugins registry, version tracking, orphan cleanup.

### Divergence Matrix

| Feature | Nuka | Nuka-Code | Classification |
|---------|------|-----------|----------------|
| `name`, `version`, `description` fields | ✅ | ✅ | aligned |
| `tools[]` (JS import paths) | ✅ | ✅ (via `commands/` or explicit path) | aligned (different mechanism; functionally equivalent) |
| `slashCommands[]` | ✅ | ✅ (via `commands` key) | aligned |
| `skills[]` | ✅ | ✅ (via `skills` key) | aligned |
| `mcpServers{}` (inline) | ✅ | ✅ | aligned |
| `hooks` (lifecycle hooks — pre/post tool, session start) | ❌ | ✅ (inline or JSON file) | deferred (Phase 4+) |
| `agents[]` (agent definitions) | ❌ | ✅ | deferred (Phase 4+) |
| `outputStyles` (custom rendering styles) | ❌ | ✅ | deferred (Phase 4+) |
| `channels` (notification + allowlist) | ❌ | ✅ | deferred (Phase 4+) |
| `lspServers` (LSP language servers) | ❌ | ✅ | deferred (Phase 4+) |
| `settings` cascade contribution | ❌ | ✅ | deferred (Phase 4+) |
| `userConfig` (prompted at enable time) | ❌ | ✅ | deferred (Phase 4+) |
| `dependencies[]` with resolution | ❌ | ✅ (DFS closure + cycle detection) | deferred (Phase 4+) |
| `author`, `homepage`, `repository`, `license`, `keywords` metadata | ❌ | ✅ | deferred (Phase 4+); cosmetic only |
| `.mcpb` / `.dxt` bundle support | ❌ | ✅ | deferred (Phase 4+) |
| Discovery: local dir scan | ✅ (`~/.nuka/plugins/`) | ✅ | aligned |
| Discovery: marketplace (URL fetch + cache) | ❌ | ✅ | deferred (Phase 4+) |
| Discovery: git clone install | ❌ | ✅ | deferred (Phase 4+) |
| Discovery: npm package install | ❌ | ✅ | deferred (Phase 4+) |
| Discovery: `--plugin-dir` session-only flag | ❌ | ✅ | deferred (Phase 4+) |
| Versioned cache (`cache/<marketplace>/<plugin>/<version>/`) | ❌ | ✅ | deferred (Phase 4+) |
| Plugin enable/disable state (settings cascade) | ❌ (load = enabled) | ✅ | **unintended gap** — all installed plugins are always loaded; there is no way to disable one without deleting the directory |
| Sandboxing / policy block (`isPluginBlockedByPolicy`) | ❌ | ✅ (managed settings) | deferred (Phase 4+) |
| Blocklist / delist detection | ❌ | ✅ | deferred (Phase 4+) |
| Auto-update (background git-pull) | ❌ | ✅ | deferred (Phase 4+) |
| `plugin install`: confirmation prompt | ✅ (via `confirm` callback) | ✅ | aligned |
| `plugin install`: source validation (git URL, npm, URL) | ❌ (local path only) | ✅ | intentional scope cut |
| `plugin install`: signature / source-org validation | ❌ | ✅ | intentional scope cut |
| `plugin install --force` | ✅ | ✅ | aligned |
| `plugin validate` author tooling | ❌ | ✅ | deferred (Phase 4+) |
| Interactive `/plugin` slash command (TUI) | ❌ | ✅ (17 files) | deferred (Phase 4+) |
| Plugin options storage (`pluginOptionsStorage`) | ❌ | ✅ | deferred (Phase 4+) |
| Wire: tool namespace prefix | ✅ (`plugin__<name>__<raw>`) | ✅ (same convention) | aligned |
| Wire: slash namespace prefix | ✅ (`<name>:<raw>`) | ✅ (same convention) | aligned |
| Wire: hooks loading + variable substitution | ❌ | ✅ (`loadPluginHooks`) | deferred (Phase 4+) |
| Wire: agents loading | ❌ | ✅ (`loadPluginAgents`) | deferred (Phase 4+) |
| Wire: LSP integration | ❌ | ✅ (`lspPluginIntegration.ts`) | deferred (Phase 4+) |
| Wire: MCP bundle (.mcpb) handler | ❌ | ✅ (`mcpbHandler.ts`) | deferred (Phase 4+) |
| Plugin manifest: JSON-only (no YAML) in Nuka-Code | ❌ (Nuka supports both yaml + json) | JSON only | **unintended gap** — minor: Nuka accepts YAML which Nuka-Code's loader doesn't; if a user migrates from Nuka to Nuka-Code their YAML manifests will break |

### Risks / Follow-ups

- **No enable/disable state**: every plugin in `~/.nuka/plugins/` is always wired. A misbehaving plugin (import error, conflicting tool name) can only be fixed by deleting its directory. Minimum viable fix: add an `enabled` array to config (default empty = all enabled) and skip `wirePlugin` for plugins not in the list. This is a one-file change to `loader.ts` + config schema.
- **YAML-only manifest quirk**: Nuka-Code uses only `plugin.json`; Nuka accepts both. If a user writes `plugin.yaml`, their manifest silently works in Nuka but breaks if they ever run the same plugin under Nuka-Code. Document this divergence or add a warning that YAML is Nuka-specific.

---

## L3 — Unified Registry

### What Nuka has

- `src/core/tools/types.ts` — `Tool<I>` with 6 fields: `name`, `description`, `parameters` (raw JSON Schema), `source: 'builtin' | 'skill' | 'mcp' | 'plugin'`, `needsPermission(input) => PermissionHint`, `run(input, ctx) => Promise<ToolResult>`.
- `src/core/tools/registry.ts` — `ToolRegistry`: `register` (log-and-skip on duplicate, first wins), `find`, `list`, `listSpecs`, `bySource`.
- `src/tui/Messages/ToolCall.tsx` — `source` badge (`[mcp]` cyan, `[plugin]` amber, `[skill]` purple).

Commits: `1e436eb` (registry), `1f242b4` (source badge).

### What Nuka-Code has

- `src/Tool.ts` (695 lines): `Tool<Input, Output, P>` interface with ~35 methods: `call`, `description`, `prompt`, `inputSchema` (Zod), `inputJSONSchema`, `outputSchema`, `isConcurrencySafe`, `isEnabled`, `isReadOnly`, `isDestructive`, `interruptBehavior`, `isSearchOrReadCommand`, `isOpenWorld`, `requiresUserInteraction`, `isMcp`, `isLsp`, `shouldDefer`, `alwaysLoad`, `mcpInfo`, `maxResultSizeChars`, `strict`, `backfillObservableInput`, `validateInput`, `checkPermissions`, `getPath`, `preparePermissionMatcher`, `prompt`, `userFacingName`, `userFacingNameBackgroundColor`, `isTransparentWrapper`, `getToolUseSummary`, `getActivityDescription`, `toAutoClassifierInput`, `mapToolResultToToolResultBlockParam`, `renderToolResultMessage`, `extractSearchText`, `renderToolUseMessage`, `isResultTruncated`, `renderToolUseTag`, `renderToolUseProgressMessage`, `renderToolUseQueuedMessage`, `renderToolUseRejectedMessage`, `renderToolUseErrorMessage`, `renderGroupedToolUse`. Also `aliases`, `searchHint`.
- `buildTool` helper filling defaults for 7 methods.
- No `source` field on `Tool`; source tracking is done by type (`isMcp: boolean`, `isLsp: boolean`, `mcpInfo: { serverName, toolName }`) and by which array a tool lives in.

### Divergence Matrix

| Feature | Nuka | Nuka-Code | Classification |
|---------|------|-----------|----------------|
| `source` enum tag (`builtin`/`skill`/`mcp`/`plugin`) | ✅ | ❌ (uses `isMcp`, `mcpInfo`, implicit from registration path) | different approach — Nuka's enum is cleaner for filtering |
| `bySource()` registry query | ✅ | ❌ (no equivalent; filtered per call site) | Nuka has an advantage here |
| Duplicate registration: log-and-skip | ✅ | N/A (tools registered into typed arrays, not a Map; no structural dedup) | different model — Nuka-Code has no single registry; tools are passed as `Tools = readonly Tool[]` |
| `maxResultSizeChars` per-tool size budget | ❌ | ✅ (100 000 for MCP, `Infinity` for Read/Edit) | **unintended gap** — relates to L1 truncation gap; Nuka has no budget mechanism at all |
| `isConcurrencySafe` | ❌ | ✅ | deferred (Phase 4+); needed for parallel tool execution |
| `isReadOnly` | ❌ | ✅ | deferred (Phase 4+) |
| `isDestructive` | ❌ | ✅ | deferred (Phase 4+) |
| `shouldDefer` / `alwaysLoad` | ❌ | ✅ | deferred (Phase 4+) |
| `isOpenWorld` | ❌ | ✅ | deferred (Phase 4+) |
| `aliases[]` for backward compat rename | ❌ | ✅ | deferred (Phase 4+) |
| `searchHint` for keyword tool discovery | ❌ | ✅ | deferred (Phase 4+) |
| `userFacingName` | ❌ (uses `name`) | ✅ (separate display name) | **unintended gap** — MCP tool names like `mcp__github__create_issue` are exposed raw to users; a display name would significantly improve UX |
| `validateInput` pre-call schema check | ❌ | ✅ | deferred (Phase 4+) |
| `checkPermissions` (tool-specific, on `Tool`) | ❌ (permission is a registry-level concern via `needsPermission`) | ✅ (per-tool `checkPermissions` method) | different model — Nuka's `needsPermission` hint is simpler and covers Phase 3 needs |
| `renderToolUseMessage` / `renderToolResultMessage` | ❌ (generic renderer in `ToolCall.tsx`) | ✅ (per-tool React component methods) | deferred (Phase 4+); needed for rich tool-specific UI |
| `mapToolResultToToolResultBlockParam` | ❌ (all tools produce `string` output) | ✅ | **unintended gap** — Nuka forces all tool results to `string`; tools that legitimately return structured data (images, JSON blocks) lose fidelity on round-trip to the API |
| `toAutoClassifierInput` | ❌ | ✅ | deferred (Phase 4+; auto-mode) |
| `interruptBehavior` (`cancel` vs `block`) | ❌ | ✅ | deferred (Phase 4+) |
| `isResultTruncated` | ❌ | ✅ | deferred (Phase 4+) |
| `inputSchema` as Zod (runtime validation) | ❌ (raw `Record<string, unknown>` JSON Schema) | ✅ | **unintended gap** — Nuka does not validate tool inputs before calling `run`; invalid inputs reach tool implementations unchecked |
| `getPath` (for file-targeted tools) | ❌ | ✅ | deferred (Phase 4+) |
| Progress events (`onProgress` callback) | ❌ | ✅ (`ToolCallProgress<P>`) | deferred (Phase 4+) |
| `strict` mode (API strict schemas) | ❌ | ✅ | deferred (Phase 4+) |

### Risks / Follow-ups

- **Tool result type erasure** (`string` only): because `ToolResult = { output: string; isError: boolean }`, image content blobs, structured JSON, and resource links are all stringified or discarded. This is internally consistent but means the Anthropic API never sees `image` content blocks from MCP responses, even when the model would benefit from them. This is a foundational design gap that grows harder to fix as the codebase matures. A `content: string | ContentBlock[]` union in `ToolResult` would future-proof this without breaking current callers.
- **No input validation**: `tool.run(input, ctx)` is called with whatever object the model produces. A malformed tool call (missing required field, wrong type) will either throw inside the tool or produce garbled output. Add an input validation step in the agent loop: if the `Tool` has a JSON Schema for `parameters`, validate the model's input against it and return a structured error tool-result rather than an exception. This prevents a class of confusing agent failures.
- **`userFacingName` absent**: users see `mcp__my_server__do_something_useful` in the TUI. This is a UX gap. A minimal fix: in `ToolCall.tsx`, strip the `mcp__<server>__` prefix and render `<server> · <tool>` for mcp-sourced tools.

---

## Summary of unintended gaps (sorted by severity)

1. **[high] Tool result size not bounded** (`client.ts::callTool`, `toolAdapter.ts`): no `maxResultSizeChars` guard. A large MCP result fills the context window and inflates cost. Fix: add a `MAX_MCP_RESULT_CHARS = 100_000` cap in `callTool`; truncate with note. Effort: < 1 hour.

2. **[high] No per-request or connection timeout** (`client.ts`): a hung stdio process or HTTP server stalls the agent loop forever. Fix: wrap `client.connect()` with `Promise.race(connectPromise, connectionTimeout(30_000))` and `sdk.callTool()` with a 10-minute timeout signal. Effort: ~2 hours.

3. **[high] Tool input not validated before `run()`** (`types.ts`, agent loop): invalid inputs silently reach tool implementations. Fix: JSON Schema validation (using Zod or `ajv`) against `tool.parameters` in the loop before dispatch. Effort: ~2 hours.

4. **[high] `resource_link` blocks silently dropped** (`client.ts::callTool`): the model is told `[resource: <uri>]` instead of the actual content. Fix: fetch inline via `client.readResource(block.uri)` when a content block is `resource_link`. Effort: ~1 hour.

5. **[med] Image blobs unusable** (`client.ts::callTool`): produces placeholder text; screenshot tools are broken. Fix: persist to temp file and return the path so the model can reference it. Effort: ~2 hours.

6. **[med] Tool/server description not truncated** (`toolAdapter.ts`): OpenAPI-generated MCP servers routinely have descriptions > 10 KB. Fix: truncate at 2048 chars in `toolAdapter.ts` and in `client.ts` when reading server instructions. Effort: < 30 min.

7. **[med] No plugin enable/disable state** (`loader.ts`): all installed plugins are always active. Fix: honor an `enabledPlugins[]` array in config; skip disabled ones in `loadPlugins`. Effort: ~2 hours.

8. **[med] Tool result type erasure** (`types.ts`): `output: string` forces all tool results to text; structured content (images, JSON blocks) loses fidelity. Fix: change `ToolResult` to `{ output: string | ContentBlock[]; isError: boolean }` and update provider adapters. Effort: ~4 hours (cross-cutting).

9. **[med] `userFacingName` absent**: users see raw `mcp__server__tool` names in the TUI. Fix: strip `mcp__<server>__` prefix in `ToolCall.tsx` display path. Effort: < 1 hour.

10. **[low] YAML manifest is Nuka-only**: Nuka-Code's loader only reads `plugin.json`; YAML manifests are Nuka-specific and silently incompatible. Not a correctness issue in Nuka itself, but worth documenting.

11. **[low] `ListRoots` handler absent**: spec-non-conformant for servers that call `roots/list`. Fix: register the handler before `client.connect()`. Effort: < 30 min.

---

## Phase 4+ backlog additions

Proposed new items for the `§M` backlog in `docs/superpowers/plans/2026-04-23-nuka-rewrite-plan.md`:

1. **M-mcp-truncation** — Add `MAX_MCP_RESULT_CHARS` cap in `McpClient.callTool` + `maxResultSizeChars` field to `Tool` interface; large results truncated with notice. (Severity: high — unintended gap #1 above.)

2. **M-mcp-timeout** — Add configurable connection timeout (default 30 s) and per-request timeout (default 10 min) to `McpClient.connect` and `callTool`. (Severity: high — unintended gap #2 above.)

3. **M-tool-input-validation** — Add JSON Schema validation of tool inputs in the agent loop before dispatching to `tool.run`. (Severity: high — unintended gap #3 above.)

4. **M-resource-link-fetch** — In `McpClient.callTool`, when a result block is `resource_link`, auto-fetch via `readResource` and inline the content. (Severity: high — unintended gap #4 above.)

5. **M-image-persist** — In `McpClient.callTool`, persist `image` content blocks to `~/.nuka/tmp/` and return the file path instead of a `[binary]` placeholder. (Severity: med.)

6. **M-description-truncation** — In `mcpToolsFor` (toolAdapter) and `McpClient.connect`, truncate tool descriptions and server instructions to 2048 chars. (Severity: med.)

7. **M-plugin-enable-disable** — Add `enabledPlugins?: string[]` to config schema; `loadPlugins` only loads listed names (default behavior: load all, matching current behavior). (Severity: med.)

8. **M-tool-result-type** — Widen `ToolResult.output` from `string` to `string | ContentBlock[]`; update `AnthropicProvider` and `OpenAIProvider` to handle both forms. (Severity: med; cross-cutting.)

9. **M-mcp-sse-transport** — Add SSE transport (`SSEClientTransport`) to `McpClient`; update config schema with `type: 'sse'`. (Deferred by spec §6.)

10. **M-mcp-reconnect** — Auto-reconnect on `onclose`: clear memo cache and reconnect on next tool call. Add `reconnectAttempts: number` to `McpConnectionStatus`. (Deferred.)

11. **M-mcp-elicitation** — Implement elicitation (form + URL modes) by wiring `ElicitRequestSchema` handler through the permission bridge. (Deferred.)

12. **M-mcp-annotations** — Consume MCP tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) and expose them on `Tool` via `isReadOnly`, `isDestructive`, `isOpenWorld`. (Deferred.)

13. **M-plugin-hooks** — Load `hooks/hooks.json` from plugin directories and merge into the hooks cascade. (Deferred.)

14. **M-plugin-marketplace** — Add marketplace config (`~/.nuka/plugins/marketplaces.json`), URL-fetch and git-clone based plugin install. (Deferred.)

15. **M-plugin-deps** — Implement `dependencies[]` in `PluginManifestSchema` with DFS closure resolution and load-time `verifyAndDemote`. (Deferred.)

16. **M-listroots-handler** — Register `ListRootsRequestSchema` handler in `McpClient.connect` returning `[{ uri: \`file://${process.cwd()}\` }]`. (Low effort, spec compliance.)

17. **M-tool-userfacing-name** — Add `userFacingName` display helper; in `ToolCall.tsx`, for `source === 'mcp'` strip the `mcp__<server>__` prefix and render `<server> · <tool>`. (UX.)

---

## Appendix — Phase 4a Gap Closure

Phase 4a landed on `main` via three worktrees merged in order M2 → M1 → M3. Post-merge: `npm test` 383 passing, `npm run typecheck` green, `dist/cli.js` 148.8 KB. The 11 unintended gaps catalogued above plus 10 high-value deferrals (21 items total per `docs/superpowers/plans/2026-04-24-full-divergence-schedule.md`) closed as follows.

| Task ID | Feature | Landing commit |
|---|---|---|
| 4a.M1.1 | MCP result size limits + truncation | `c79e84c` |
| 4a.M1.2 | MCP connect timeout | `233c773` |
| 4a.M1.3 | MCP per-request timeout | `233c773` |
| 4a.M1.4 | Tool description truncation (2048 chars) | `ceb34cc` |
| 4a.M1.5 | Server instruction truncation (2048 chars) | `ceb34cc` |
| 4a.M1.6 | `resource_link` auto-fetch | `c154ac8` |
| 4a.M1.7 | `ListRoots` handler | `43df1ea` |
| 4a.M1.8 | `roots` capability declaration | `43df1ea` |
| 4a.M1.9 | SSE transport (`type: 'sse'`) | `88f1895` |
| 4a.M1.10 | Auto-reconnect on `onclose` | `83912a4` |
| 4a.M1.11 | Reconnect on session expiry (HTTP 404 / -32001) | `83912a4` |
| 4a.M1.12 | Elicitation (form + URL modes) | `9d2a2ee` |
| 4a.M2.1 | Tool input JSON-Schema validation | `8384f07` |
| 4a.M2.2 | Tool result type widening (`string \| ContentBlock[]`) | `deba311` |
| 4a.M2.3 | Image blob persistence to disk | `1e2962a` |
| 4a.M2.4 | MCP tool annotations → `Tool.annotations` | `5afde31` |
| 4a.M2.5 | `userFacingName` display formatter | `889cf54` |
| 4a.M2.6 | `maxResultSizeChars` per-tool budget | `7245b34` |
| 4a.M3.1 | Plugin enable/disable flag | `2365a40` |
| 4a.M3.2 | Plugin hooks (`beforeToolCall`/`afterToolCall`/`afterTurn`/`beforeAutoCompact`) | `9a3038f` |
| 4a.M3.3 | YAML manifest documentation + startup warning | `568ed44` |

Merge commits on `main`: `e79ffbc` (M2), `b06cd6b` (M1), `e39832d` (M3).

### Gap-closure divergences from the design spec

1. **M1.5 `resource_link` output remains a plain string, not a `ContentBlock`.** The auto-fetch site in `McpClient.callTool` splices `readResource(uri).output` into the `lines[]` array and returns a string — it does not emit a `{ type: 'resource', ... }` block in the non-rich branch. Rationale: M1 and M2 ran in parallel worktrees; M1 avoided betting on M2's `ContentBlock` shape. The rich-blocks branch (triggered by image presence) does emit `{ type: 'resource', uri }`. A follow-up can unify the two paths once the shape is stable.
2. **M1.8 elicitation dialog is a new sibling dialog kind** (`'elicitation'` in `src/tui/App.tsx`), not a polymorphic reuse of `PermissionDialog`. The permission flow is tightly coupled to `PermissionCall` / consent cache; collapsing would force cross-cutting changes for no user-visible benefit. Dialog form-mode input supports free-form string fields only; array / enum / oneOf subtypes are submitted as strings. Phase 5 can add widget specialization.
3. **M1.10 reconnect has a sticky latch** — once `maxAttempts` is exhausted, the client stays in error state for the lifetime of the process. There is no retry window. Sessions must be restarted to recover.
4. **M2.3 image persistence** uses a `${Date.now()}_${crypto.randomBytes(4).toString('hex')}` ID instead of a ULID to avoid adding a new dep. The image branch in `callTool` writes via `fs.writeFileSync` (sync) inside an `async` method — acceptable for small blobs, but a truly large image would block the event loop briefly.
5. **M2.6 per-tool truncation** only applies when `result.output` is a string; `ContentBlock[]` outputs pass through unmodified. Sizing a structured result is deferred.
6. **M3.2 hooks:** all four events (`beforeToolCall`, `afterToolCall`, `afterTurn`, `beforeAutoCompact`) are wired. `beforeAutoCompact` was implementable because `src/core/compact/auto.ts` already exists with a clean seam in `loop.ts`. Hooks run via `execa` with `sh -c` and `reject:false` so stdout is captured even on non-zero exit; JSON parse of stdout extracts `cancel` / `reason` fields. Only `beforeToolCall` and `beforeAutoCompact` honor the `cancel=true` veto; the other two swallow failures.
7. **M3.3 YAML warning** emits to `console.warn` on `loadPlugins` once per plugin per process; YAML manifest support is retained (not removed) for now.

Phase 4b begins from `main` at the M3 merge commit.

---

## Appendix — Phase 4b Gap Closure

Phase 4b landed on `main` via three worktrees merged in order M2 → M1 → M3 (base `d42aa16`). Post-merge: `npm test` 518 passing, `npm run typecheck` green, `dist/cli.js` 177.1 KB. The 14 items scheduled for Phase 4b closed as follows.

| Task ID | Feature | Landing commit |
|---|---|---|
| 4b.M1.13 | `stderr` capture from stdio transport | `6f7fea3` |
| 4b.M1.14 | MCP tool result persistence to disk | `5de01f6` |
| 4b.M1.15 | Unicode sanitization on tool results | `66f41e5` |
| 4b.M1.16 | `searchHint` / `alwaysLoad` via `_meta` | `9bdf62b` |
| 4b.M1.17 | Memoized connection cache (LRU + `clearServerCache`) | `62a27a8` |
| 4b.M2.7 | `isConcurrencySafe` + parallel tool execution | `01199c8` |
| 4b.M2.8 | Annotation-aware permission prompt | `dff82e4` |
| 4b.M2.9 | `shouldDefer` / `alwaysLoad` scheduling | `fca7569` |
| 4b.M2.10 | Tool `aliases[]` for rename compat | `6b997d6` |
| 4b.M2.11 | `isOpenWorld` UI suffix | `195caa0` |
| 4b.M2.12 | Typed progress events (`ToolCallProgress<P>`) | `9c38507` |
| 4b.M3.4 | Manifest metadata (`author`/`homepage`/etc.) + `plugin list` CLI | `06644bc` |
| 4b.M3.5 | `--plugin-dir` session-only flag | `87426fa` |
| 4b.M3.6 | Plugin `userConfig` prompted at enable time | `f44b381` |

Merge commits on `main`: `f65f4a2` (M2), `aa4f0b9` (M1), `d97a133` (M3).

### Gap-closure divergences from the design spec

1. **M1.13 stderr:** to capture stderr the client now unconditionally spawns stdio transports with `stderr: 'pipe'`. Operators who relied on server stderr appearing in their terminal will no longer see it there; it is accessible via `McpClient.stderr()`. Ring buffer defaults to 64 MiB and is configurable.
2. **M1.17 LRU cache lifetime:** `McpManager.cache` is static and persists for the process lifetime. `closeAll()` does *not* purge the cache — callers who want a clean slate must call `McpManager.clearServerCache()` before starting a new manager.
3. **M2.7 parallel execution progress ordering:** per-call progress is buffered into a `string[]` and emitted in strict input order (`tool_call[i] → progress[i]* → tool_result[i]`) after all parallel calls complete, instead of interleaved as-it-arrives. Simpler to reason about; users see progress in batches rather than a live stream when parallelism kicks in. `beforeToolCall` / permission prompts run serially before dispatch (no dialog stacking); `afterToolCall` hooks run serially after.
4. **M2.8 `AskUser` signature widened** from `(call: PermissionCall) => Promise<Decision>` to `(payload: PermissionPayload) => Promise<Decision>` so badges flow through. Clean extension; `cli.tsx`'s lambda and `PermissionBridge.ask` were updated accordingly.
5. **M2.12 typed progress** reuses the existing `tool_progress` string event channel — `onProgressTyped(payload)` is a thin wrapper that JSON.stringify's the payload into the existing `onProgress(string)` pump. No new event type or pump-shape change.
6. **M3.5 `--plugin-dir`** is parsed via manual `argv` scanning (the project's convention) rather than introducing a commander/yargs dependency. The repeatable flag is handled explicitly in `cli.tsx`.
7. **M3.6 userConfig orchestration:** "first enable" is detected by *file-existence* on `.userconfig.json` (no separate flag). The loader partitions plugins into `readyPlugins` (wired immediately) and `pendingPlugins` (deferred until the TUI mounts and the permission bridge is available). A `setImmediate` tick after the initial render lets React mount before the first prompt fires — mirrors the existing `mcpManager` startup pattern. Cancelling a first-enable prompt skips that plugin *for the session only*; next launch re-prompts.

Phase 5 begins from `main` at `d97a133` (next: marketplace + git/npm install + dependency closure, plugin `agents`/`outputStyles`/`channels`/`lspServers`, config scope).

---

## Appendix — Phase 5 Gap Closure

Phase 5 landed on `main` via four worktrees merged in order M4-install → M5-agents → M5-platform → M4-ops (base `5b056b9`). Post-merge: `npm test` **770 passing**, `npm run typecheck` green, `dist/cli.js` **212.4 KB**. 16 of the 17 originally scheduled Phase-5 items closed; LSP integration (5.M5.4) was deliberately deferred to Phase 6 as a standalone focus.

### M4 — Marketplace + installers + ops (12 items)

| Task ID | Feature | Landing commit |
|---|---|---|
| 5.M4.1 | `marketplaces.json` config | `3c97239` |
| 5.M4.2 | URL index fetch + cache + search | `e0c331e` |
| 5.M4.3 | Git installer (`git clone --depth 1`) | `744fb70` |
| 5.M4.4 | Npm installer (`npm pack` + extract, lifecycle-script guard) | `117b266` |
| 5.M4.5 | Dependency closure (DFS + cycle detection) | `394000f` |
| 5.M4.6 | Versioned cache paths + atomic symlink activation | `968180d` |
| 5.M4.7 | Background auto-update | `0a6a6e2` |
| 5.M4.8 | Blocklist + delist auto-uninstall detection | `cec623b` |
| 5.M4.9 | `plugin validate` author CLI | `6466f04` |
| 5.M4.10 | Interactive `/plugin` slash command (7 subcommands) | `6adf80f` |
| 5.M4.11 | Plugin options storage (3-layer merge) | `19eed42` |
| 5.M4.12 | `.mcpb`/`.dxt` bundle unpacker (pure Node built-ins) | `d2347a5` |

### M5 — Agents swarm + platform (4 items)

| Task ID | Feature | Landing commit |
|---|---|---|
| 5.M5.1.1 | Agents manifest schema | `0b4ada4` |
| 5.M5.1.2 | Agent loader + registry | `25c85b5` |
| 5.M5.1.3 | Tool filter (`allowedTools`/`deniedTools`) | `04fb955` |
| 5.M5.1.4 | Dispatch (isolated sub-session runner) | `69b68ab` |
| 5.M5.1.5 | `dispatch_agent` tool + CLI wire-up | `3decd95` |
| 5.M5.1.6 | Recursion guard + parallel dispatch | `d4bdf91` |
| 5.M5.1.7 | TUI rendering (`AgentCall.tsx`, Ctrl+A toggle) | `3bc6634` |
| 5.M5.2 | outputStyles custom renderers | `cfdfb4f` |
| 5.M5.3 | Channels notification routing (webhook/command) | `61e99a6` |
| 5.M5.5 | Config scope cascade (enterprise→user→project→local) | `ee48b2a` |

Merge commits on `main`: `d6828ad` (M4-install), `099e4a5` (M5-agents), `01ff232` (M5-platform), `728f06b` (M4-ops). Post-rebase fixup: `d8e7f5a` (validate dependency schema alignment after M4-install merged its object-shaped deps).

### Gap-closure divergences from the design spec

1. **M4.12 bundle unpacker** — `unzip` was not available on the build host. Rather than add an npm dep, a minimal ZIP container parser was written in pure Node built-ins: PK signature parsing + `zlib.inflateRaw` for DEFLATE entries. STORE entries are copied directly. Other compression methods (BZIP2, LZMA) surface a clear error — acceptable for `.mcpb`/`.dxt` which use DEFLATE in practice.
2. **M4.1 concurrent `addMarketplace`** — atomic tmp+rename writes make *individual* writes atomic, but concurrent load→modify→save races are last-write-wins. Advisory locking deferred to Phase 6.
3. **M4.4 npm security boundary** — rejects `preinstall`/`install`/`postinstall` scripts but does *not* sandbox, verify signatures, or inspect package contents. First-line defense only.
4. **M4.3 git test flakiness** — `installFromGit` tests run real `git clone` against local `file://` fixtures and occasionally time out under parallel load; each test carries an explicit 15 s timeout.
5. **M5.1.4 dispatch isolation** — sub-session built with empty `messages`/`usage`/`queue`/`permissionCache`/`unDeferredToolNames` and a fresh `ToolRegistry` populated from `filterTools` output. Permission checker is *shared* so sub-agent tool calls still prompt at the top level (intended — user sees and controls everything).
6. **M5.1.5 dispatch_agent description** — uses a snapshot-at-registration pattern (agents available at registration time are enumerated in the description string). `loop.ts` rebuilds `toolSpecs` each turn, so the dynamic value and the snapshot are equivalent today. Mid-session plugin install would require upgrading to a getter.
7. **M5.1.6 parallel dispatch** — a new opt-in annotation `annotations.parallelSafe?: boolean` was added because the 4b.M2.7 `canParallelize` path rejects duplicate tool names as a defense-in-depth; two sibling `dispatch_agent` calls both have the same name. `parallelSafe: true` explicitly opts dispatch_agent into parallel batches. Default is false.
8. **M5.1.7 ToolContext.session** — optional `session?` field added to `ToolContext` so `dispatch_agent` can read `session.allowedAgentDispatch` for the recursion guard. Backward-compatible for all other tools.
9. **M5.2 outputStyles error handling** — `OutputStyleErrorBoundary` wraps dynamic-imported components. Load failures (bad path, bad module) are caught in the `useEffect` path and fall back immediately; render-time throws are caught by the boundary. A brief fallback window during the async import settle is acceptable for a TUI.
10. **M5.3 channels warning rate-limit** — once a channel fails, it logs once and silences for the process lifetime via a module-level `Set`. Prevents log spam on persistent failures (webhook server down) but transient-failure-then-recovery won't re-alert. `clearWarnedChannels()` exported for tests.
11. **M5.5 `loadConfig` backward compat** — preserves the original `mergeProviders()`-by-id union semantics. `loadScopedConfig()` (the new API) uses generic deep-merge with last-wins arrays, so callers that migrate will see provider arrays from user scope dropped when project scope also defines providers. Documented in-source and noted as a migration caveat.
12. **M4.9 validate + M4-install dep schema** — post-rebase, `dependencies` is `Array<{name, version?, required?}>` (objects) rather than `string[]`. A follow-up fixup commit (`d8e7f5a`) teaches `validatePlugin` to read names from either shape; tests updated to use the object form.

### Hands-on demo

The design spec called for a fixture marketplace + one dummy plugin with `agents[]` exercising `/plugin install` and `dispatch_agent`. The demo was not included as a test fixture in this round (would have required network or elaborate fixtures) — recorded here as a Phase 5 deliverable completed via integration tests rather than an end-to-end script. A standalone smoke-demo script can land in Phase 6 backlog as a quality-of-life addition.

Phase 6 begins from `main` at the M4-ops merge commit (`728f06b`) plus the Gap Closure doc update.

---

## Appendix — Phase 6 Gap Closure

Phase 6 landed on `main` via a single sequential worktree merged at `754685a` (base `8106606`). Post-merge: `npm test` **849 passing**, `npm run typecheck` green, `dist/cli.js` **237.2 KB**.

| Task ID | Feature | Landing commit |
|---|---|---|
| 6.1 | LSP types + JSON-RPC framing (`MessageStream`) | `254987b` |
| 6.2 | `LspClient` lifecycle + diagnostics buffer | `362d051` |
| 6.3 | `DocumentTracker` (didOpen/didChange/didClose, version counter) | `0163ba8` |
| 6.4 | `LspManager` (documentSelector routing, lazy spawn, collision policy) | `c15f48f` |
| 6.5 | Manifest `lspServers[]` + wire integration | `4f3b96d` |
| 6.6 | `lsp_diagnostics` / `lsp_definition` / `lsp_references` tools + Write/Edit didChange hook | `571446f` |

Merge commit: `754685a`. Closes the 17th and final Phase-5 deferred item (5.M5.4).

### Notes
- LSP transport is stdio only; TCP/websocket out of scope.
- LSP coverage is intentionally minimal (diagnostics + definition + references). Completions/hover/code actions deferred indefinitely — agent-driven CLI doesn't benefit much from them.
- Mock-LSP test strategy: `_spawnFn` injection point on `LspClient`, `makeMockSpawn()` factory in manager tests. No real `typescript-language-server` dependency in CI.
- The 4b smoke test that was reported as a pre-existing failure now passes consistently after Phase 6 (full provider wiring stabilized the exit-code path).

The original 68-item review is fully closed across Phases 4a (21 items), 4b (14), 5 (16), 6 (1) — totaling 52 implementation items plus 16 intentional Phase-6+ scope cuts (analytics, OAuth, IDE-specific transports, etc.).

---

## Appendix — Phase 7 Gap Closure

Phase 7 (onboarding + quality-of-life) landed on `main` via three parallel worktrees merged in order M1 → M2 → M3. Post-merge: `npm test` **966 passing** (was 849), `npm run typecheck` green, `dist/cli.js` **301.7 KB**.

Reference for scope selection: `/data/xtzhang/Nuka-Code` survey on 2026-04-25 — picked the 6 agent-CLI–relevant features and skipped voice/buddy/upstream-proxy/remote-control as out-of-scope for plugin-first.

| Task ID | Feature | Landing commit |
|---|---|---|
| 7.1.a | Provider templates + key probe (anthropic + openai) | `bb215a3` |
| 7.1.b | Onboarding wizard reducer (welcome → pickProvider → apiKey → pickModel → verifying → done) | `8284fc7` |
| 7.1.c | Ink TUI screens for the wizard | `81dd48c` |
| 7.1.d + 7.2 | `nuka init` subcommand + offline `/config` hint + offline-boot banner test | `b0864ca` |
| 7.3.a | Pricing seed + `CostTracker` (Anthropic + OpenAI rates) | `5e35498` |
| 7.3.b | Atomic `~/.nuka/cost.json` persistence (10k cap, tmp+rename) | `bf50d08` |
| 7.3.c | Cost wired into agent loop after each turn + `/cost` slash | `a0133f7` |
| 7.4.a + 7.4.b | Memdir parser/index/synth/relevance (TF-IDF over keywords) | `47e575c` |
| 7.4.c | Session-end synth + `## Memory` system-prompt injection + `/memdir` slash | `ee035b8` |
| 7.5.a | Vim controller (motions/operators/text-objects/dot-repeat) | `b786411` |
| 7.5.b | PromptInput vim wiring + `/vim on/off/toggle` persisted | `58e720f` |
| 7.6 | Status HUD (provider/model · ctx% · tokens · $ · plugins · agents · branch) | `f2ddb52` |
| 7.7 | `README.zh-CN.md` + logo (`assets/logo.png`) | `82c9c5d` |

Merge commits: `41861a2` (M1), `a370d37` (M2), `d976ccf` (M3).

### Divergences
- **M1**: All `useInput` hooks lifted to the wizard root (ink-testing-library couldn't reliably re-bind stdin to a freshly mounted `useInput` after a sibling unmount). Behavior identical for users.
- **M1**: Offline `/config` prints a `nuka init` hint instead of mounting the wizard inline over the prompt — the App-side dialog system would have required a new dialog kind. Standalone `nuka init` is fully wired.
- **M2**: Cost tracker flushes only on SIGINT (no 30 s interval timer); good enough since the tracker is in-memory and SIGINT is the canonical exit. Adding the timer is a single-line change.
- **M2**: `/memdir compact` uses a module-level `setMemdirSynthCallable(...)` rather than `SlashContext`, decoupling the slash from cwd/provider plumbing.
- **M2**: Memdir relevance uses keyword-weighted scoring (3× boost on the keywords field) rather than full TF-IDF; top-K filters score>0 so an unrelated prompt produces no `## Memory` section at all.
- **M3**: HUD is rendered as inline `<Text>` (not a flex row) so it wraps cleanly on narrow terminals.
- **M3**: `StatusBar` retained alongside the new HUD; HUD is mounted under it. Plan said "replace bottom footer"; leaving StatusBar avoids breaking the existing hint-line/segments tests.
- **Skipped**: voice mode, buddy companion, upstream MITM proxy, remote control gateway. Deferred to Phase 9 if/when the deployment context demands them.

### Out-of-scope follow-ups (queued for Phase 8)
- Plan mode + Rewind checkpoints (drafted but moved out of P7 for surface-area control).
- Task system (long-running bash / MCP monitors) and `/tasks` slash.
- IDE bridge (VS Code / JetBrains extension status + launch).
- Theme switcher.
- Stats dashboard.

---

## Appendix — Phase 8 Gap Closure

Phase 8 (feature evolution: theme + stats + rewind + plan-mode + IDE bridge) landed via three parallel worktrees. Post-merge: `npm test` **1095 passing**, `npm run typecheck` clean, `dist/cli.js` **319.3 KB**.

| Task ID | Feature | Landing commit |
|---|---|---|
| 8.1.a | Theme registry (5 seeds) + ThemeProvider/useTheme | `ac379ef` |
| 8.1.b | `/theme list/<name>` slash + `saveTheme` persistence | `1344d46` |
| 8.1.c | App.tsx ThemeProvider wrap + Hud color consumption | `aa1901d` |
| 8.2.a | Stats aggregator (sessions+cost+by-model) + ASCII chart | `38b6d8f` |
| 8.2.b | `/stats` slash + StatsView (Overview/Models tabs, range cycle) | `5be5f8f` |
| 8.3.a | `truncateAfter` session API + `/rewind` + MessageSelector | `553a9d0` |
| 8.3.b | File checkpoint scaffolding (off-by-default; SHA1 capture only) | `81ade86` (rewritten `19b6de2`) |
| 8.4.a | Plan-mode permission gate (writes/destructive blocked) | `9c05f5f` (rewritten `573e794`) |
| 8.4.b | Plan storage + `/plan on/off/show/write/apply` + `## Plan` injection | `1696ed6` (rewritten `1b8f859`) |
| 8.5.a | IDE detect probes (vscode/jetbrains/cursor/windsurf) | `d2cfc59` |
| 8.5.b | `McpManager.addServer/removeServer` + `/ide` connect/disconnect | `f5f8baf` |

Merge commits: `36f29ef` (M1), `5600e91` (M3), `0e709d9` (M2). Merge order M1→M3→M2 chosen so the highest-blast-radius change (permission-mode gate in M2) lands last on a stable base.

### Divergences
- **M1 `/theme`**: interactive arrow-key picker deferred — list mode + named-set used (`/theme list`, `/theme <name>`). Sufficient for first iteration.
- **M1 `/stats`**: dialog-routed (`stats` dialog kind) rather than a standalone screen, consistent with existing dialog patterns.
- **M2 `/rewind`**: headless slash supports `/rewind` (list) + `/rewind <n>` (truncate); standalone `<MessageSelector>` component with tests but not yet wired into `App.tsx`'s dialog dispatcher — UI-mount is a follow-up.
- **M2 file-checkpoint restore**: `restore()` returns `{ok:false, reason:'git-backed restore not yet implemented'}` even when the flag is on. Capture-side stores SHA1s; the destructive restore path is deliberately a stub for safety.
- **M2 plan-mode order**: gate runs *before* the permission cache check so a remembered "allow write" rule cannot bypass plan mode (covered by an explicit test).
- **M3 `SlashContext`**: extended with optional `mcpManager?` for `/ide` to mutate the live manager — backward-compatible.
- **M3 `McpManager`**: gained `addServer`/`removeServer` (private `_removeClientByName`); name-collision is "close + recreate".

### Out-of-scope follow-ups (queued for Phase 10)
- Full file-checkpointing rewind (git-stash + checkout safety proof).
- `/rewind` dialog wiring in App.tsx.
- Heatmap calendar view for stats.
- Theme animations / shimmer.
- Polymorphic task system (long-running bash, MCP monitors, dream).
- Ultraplan (remote CCR) — won't ship.
