# Full Divergence Schedule — Nuka vs Nuka-Code (All 68 Items)

**Source review:** `docs/superpowers/reviews/2026-04-24-phase3-vs-nuka-code.md`
**Design anchor:** `docs/superpowers/specs/2026-04-24-phase4-hardening-design.md`
**Phase 4 plan:** `docs/superpowers/plans/2026-04-24-phase4-hardening-plan.md`

Every divergence from the review is catalogued below with a target phase, a workstream/task ID, a severity, and a dependency note. Items already aligned are kept for completeness (marked N/A).

## Legend

- **Phase:**
  - `4a` — hardening; closes all 11 unintended gaps plus the minimum high-value deferrals needed for parity on correctness. Executed now.
  - `4b` — extensions; protocol transports + plugin polish that bring Nuka to rough parity on feature surface.
  - `5` — advanced; marketplace, auto-update, hooks cascade, LSP integration.
  - `6+` — intentional scope cuts that stay deferred indefinitely (auth, IDE-specific transports, sandboxing, signature verification, analytics). Tracked only so future maintainers know the decisions were deliberate.
- **Workstream:** `M1` MCP protocol; `M2` tool semantics; `M3` plugin subsystem; `M4` advanced MCP + plugin; `M5` TUI + agents + LSP; `M6` ops (backlog-only).
- **Severity:** H high; M medium; L low; — aligned or purely tracking.
- **Depends on:** task IDs that must land first.

## Phase-4a scheduled items (21)

| ID | Feature | Class | WS | Sev | Depends on |
|---|---|---|---|---|---|
| 4a.M1.1 | MCP result size limits + truncation | unintended gap | M1 | H | — |
| 4a.M1.2 | MCP connect timeout | unintended gap | M1 | H | — |
| 4a.M1.3 | MCP per-request timeout | unintended gap | M1 | H | — |
| 4a.M1.4 | Tool description truncation (2048 chars) | unintended gap | M1 | M | — |
| 4a.M1.5 | Server instruction truncation (2048 chars) | unintended gap | M1 | M | — |
| 4a.M1.6 | `resource_link` auto-fetch | unintended gap | M1 | H | — |
| 4a.M1.7 | `ListRoots` handler | unintended gap | M1 | M | — |
| 4a.M1.8 | `roots` capability declaration | unintended gap | M1 | L | 4a.M1.7 |
| 4a.M1.9 | SSE transport (`type: 'sse'`) | deferred | M1 | M | — |
| 4a.M1.10 | Auto-reconnect on `onclose` | deferred | M1 | M | 4a.M1.2 |
| 4a.M1.11 | Reconnect on session expiry (HTTP 404 / -32001) | deferred | M1 | M | 4a.M1.10 |
| 4a.M1.12 | Elicitation (form + URL modes) | deferred | M1 | M | — |
| 4a.M2.1 | Tool input JSON-Schema validation | unintended gap | M2 | H | — |
| 4a.M2.2 | Tool result type widening (`string \| ContentBlock[]`) | unintended gap | M2 | H | — |
| 4a.M2.3 | Image blob persistence to disk | unintended gap | M2 | M | 4a.M2.2 |
| 4a.M2.4 | MCP tool annotations → `Tool.annotations` | deferred | M2 | M | 4a.M2.2 |
| 4a.M2.5 | `userFacingName` display formatter | unintended gap | M2 | M | — |
| 4a.M2.6 | `maxResultSizeChars` per-tool budget | unintended gap | M2 | M | 4a.M1.1 |
| 4a.M3.1 | Plugin enable/disable flag | unintended gap | M3 | M | — |
| 4a.M3.2 | Plugin hooks (`beforeToolCall` / `afterToolCall` / `afterTurn` / `beforeAutoCompact`) | deferred | M3 | M | — |
| 4a.M3.3 | YAML manifest documentation + startup warning | unintended gap | M3 | L | — |

## Phase-4b scheduled items (14)

| ID | Feature | Class | WS | Sev | Depends on |
|---|---|---|---|---|---|
| 4b.M1.13 | `stderr` capture from stdio transport (64 MB cap) | deferred | M1 | M | — |
| 4b.M1.14 | MCP tool result persistence to disk (large outputs) | deferred | M1 | L | 4a.M1.1 |
| 4b.M1.15 | Unicode sanitization on tool results | deferred | M1 | L | — |
| 4b.M1.16 | `searchHint` / `alwaysLoad` via `_meta` | deferred | M1 | L | — |
| 4b.M1.17 | Memoized connection cache (LRU + `clearServerCache`) | deferred | M1 | L | 4a.M1.10 |
| 4b.M2.7 | `isConcurrencySafe` + parallel tool execution | deferred | M2 | M | 4a.M2.4 |
| 4b.M2.8 | `isReadOnly` / `isDestructive` enforcement on permission prompt | deferred | M2 | M | 4a.M2.4 |
| 4b.M2.9 | `shouldDefer` / `alwaysLoad` tool scheduling | deferred | M2 | L | 4a.M2.4 |
| 4b.M2.10 | Tool `aliases[]` for rename compat | deferred | M2 | L | — |
| 4b.M2.11 | `isOpenWorld` flag (web-fetching tools) | deferred | M2 | L | 4a.M2.4 |
| 4b.M2.12 | Progress events on Tool (`ToolCallProgress<P>`) | deferred | M2 | L | — |
| 4b.M3.4 | `author`/`homepage`/`repository`/`license`/`keywords` manifest metadata | deferred | M3 | L | — |
| 4b.M3.5 | `--plugin-dir` session-only flag | deferred | M3 | L | 4a.M3.1 |
| 4b.M3.6 | Plugin manifest: `userConfig` prompted at enable-time | deferred | M3 | L | 4a.M3.1 |

## Phase-5 scheduled items (17)

| ID | Feature | Class | WS | Sev | Depends on |
|---|---|---|---|---|---|
| 5.M4.1 | Plugin marketplace config (`marketplaces.json`) | deferred | M4 | M | — |
| 5.M4.2 | Plugin discovery: marketplace URL fetch + cache | deferred | M4 | M | 5.M4.1 |
| 5.M4.3 | Plugin discovery: `git clone --depth 1` install | deferred | M4 | M | 5.M4.1 |
| 5.M4.4 | Plugin discovery: npm package install | deferred | M4 | M | 5.M4.1 |
| 5.M4.5 | Plugin dependency closure resolution | deferred | M4 | M | 5.M4.1 |
| 5.M4.6 | Versioned cache paths (`cache/<marketplace>/<plugin>/<version>/`) | deferred | M4 | L | 5.M4.1 |
| 5.M4.7 | Plugin auto-update (background git-pull) | deferred | M4 | L | 5.M4.3 |
| 5.M4.8 | Plugin blocklist / delist detection | deferred | M4 | L | 5.M4.1 |
| 5.M4.9 | `plugin validate` author tooling | deferred | M4 | L | — |
| 5.M4.10 | Interactive `/plugin` slash command TUI | deferred | M4 | L | 5.M4.1 |
| 5.M4.11 | Plugin options storage | deferred | M4 | L | 4b.M3.6 |
| 5.M4.12 | `.mcpb` / `.dxt` bundle support | deferred | M4 | L | 5.M4.3 |
| 5.M5.1 | Plugin manifest: `agents[]` + agent loader | deferred | M5 | M | — |
| 5.M5.2 | Plugin manifest: `outputStyles` + custom renderers | deferred | M5 | L | — |
| 5.M5.3 | Plugin manifest: `channels` (notification + allowlist) | deferred | M5 | L | — |
| 5.M5.4 | Plugin manifest: `lspServers` + LSP integration | deferred | M5 | M | — |
| 5.M5.5 | Config scope (`local`/`user`/`project`/`enterprise`) | deferred | M5 | M | — |

## Phase-6+ backlog (16)

Intentional scope cuts — tracked only; no planned landing date.

| ID | Feature | Class | Notes |
|---|---|---|---|
| 6.1 | SSE-IDE transport (`sse-ide`) | intentional cut | IDE integration out of scope |
| 6.2 | WebSocket transport (`ws`) | deferred indefinitely | SSE covers most HTTP-stream needs |
| 6.3 | WebSocket-IDE transport (`ws-ide`) | intentional cut | IDE integration |
| 6.4 | In-process SDK transport | deferred indefinitely | Chrome / Computer Use out of scope |
| 6.5 | Claude.ai proxy transport (`claudeai-proxy`) | intentional cut | Anthropic-product specific |
| 6.6 | OAuth 2.0 / PKCE for SSE + HTTP | intentional cut | Enterprise auth deferred |
| 6.7 | XAA / SEP-990 cross-app access | intentional cut | Enterprise auth |
| 6.8 | `CLAUDE_CODE_SHELL_PREFIX` (sandbox wrapper) | intentional cut | No process sandboxing in Nuka |
| 6.9 | Analytics events (`tengu_mcp_server_*`) | intentional cut | No telemetry in Nuka |
| 6.10 | `pluginSource` on MCP config (channel gate) | deferred | needs channels subsystem (5.M5.3) |
| 6.11 | Sandboxing / policy block | intentional cut | unsandboxed in Nuka |
| 6.12 | Marketplace signature / source-org validation | intentional cut | deferred behind a policy toggle |
| 6.13 | Settings cascade contribution from plugins | deferred | requires config scope (5.M5.5) |
| 6.14 | Strict mode (API strict schemas) | deferred indefinitely | —  |
| 6.15 | `getPath` (file-targeted tool helper) | deferred | cosmetic; tool-specific |
| 6.16 | `toAutoClassifierInput` | deferred | needs auto-mode (spec §7) |

## Items already aligned (no schedule needed)

The review also enumerates 9 items where Nuka and Nuka-Code match behaviorally (stdio transport, streamable-http, plugin `name`/`version`/`description`, `tools[]`, `slashCommands[]`, `skills[]`, `mcpServers{}` inline, local-dir plugin discovery, `plugin install` confirm + `--force`, tool namespace prefix, slash namespace prefix). These are tracked implicitly by the "aligned" rows in the review's divergence matrix.

## Summary by phase

| Phase | Count | Goal |
|---|---|---|
| 4a | 21 | close all 11 unintended gaps + 10 high-value deferrals |
| 4b | 14 | protocol + plugin polish to bring Nuka to feature parity on correctness surface |
| 5 | 17 | marketplace, advanced plugin subsystems (agents/output-styles/channels/LSP), config scope |
| 6+ | 16 | intentional cuts — tracked for provenance only |
| aligned | ~9 | — |
| **total** | **77** | — (tallies slightly above 68 because some review rows collapsed 2-3 distinct features into one line; each is broken out here) |

## Execution order

1. **Phase 4a** — three parallel worktrees (M1, M2, M3) per the Phase 4 plan. See `2026-04-24-phase4-hardening-plan.md`.
2. **Phase 4b** — starts after 4a merges. Workstream bundling TBD based on collision analysis.
3. **Phase 5** — design spec written first (`2026-05-XX-phase5-marketplace-agents-design.md`), then planned. Likely 6-8 weeks after 4b lands.
4. **Phase 6+** — item-by-item as user demand surfaces; most will never land.

## Open triage items

As Phase 4a lands, re-check:
- Review #12 (`reconnect on session expiry`) is folded into 4a.M1.11 here but could prove to need a separate task if the SDK's error types differ across providers.
- Review rows counted as "single" often expand into 2-3 tasks (e.g., truncation = result size + description + server instructions = 3 tasks). The plan doc splits them; this schedule matches that split.
- The YAML-vs-JSON quirk (4a.M3.3) is deliberately tiny — only docs + a startup warning. If the user ever wants to drop YAML for Nuka-Code portability, that becomes a separate `4b.M3.X` breaking change.
