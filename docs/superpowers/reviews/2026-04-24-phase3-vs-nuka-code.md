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
