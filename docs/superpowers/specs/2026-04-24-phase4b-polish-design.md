# Nuka Phase 4b — Polish & Annotation Follow-through Design Spec

**Status:** active. Follows `2026-04-24-phase4-hardening-design.md`. Phase 4a is complete on `main` at commit `d42aa16`; 383 tests passing; `dist/cli.js` 148.8 KB.

**Reference:** closes the 14 Phase-4b items catalogued in `docs/superpowers/plans/2026-04-24-full-divergence-schedule.md` — operational MCP polish, annotation-driven UX, and long-tail plugin manifest fields that did not land in 4a.

---

## 1. Goals

1. **Cash in on 4a annotations.** `annotations.readOnly` → parallel execution gate + "(read-only)" prompt suffix; `annotations.destructive` → red warning banner; `annotations.openWorld` → "(network)" TUI suffix.
2. **Close operational gaps.** stderr ring buffer on stdio transport, large-output disk persistence, unicode sanitization, LRU connection cache.
3. **Extend the tool model.** `aliases[]`, generic `ToolCallProgress<P>`, `shouldDefer` / `alwaysLoad` scheduling, `_meta.searchHint` keyword-driven lazy loading.
4. **Polish the plugin subsystem.** Manifest `author`/`homepage`/`repository`/`license`/`keywords`; `--plugin-dir` session-only flag; `userConfig` first-enable prompt.

## 2. Non-goals

Deferred to Phase 5:
- Plugin marketplace / git / npm installers and dependency closure.
- Plugin `agents` / `outputStyles` / `channels` / `lspServers`.
- Config scope (local/user/project/enterprise).
- Plugin auto-update, blocklist, signature verification.
- Strict mode API schemas.

## 3. Risks addressed (mapping to schedule items)

| Schedule item | Addressed by |
|---|---|
| 4b.M1.13 stderr capture | M1.13 ring buffer on `StdioClientTransport` |
| 4b.M1.14 large-output persistence | M1.14 disk write past threshold |
| 4b.M1.15 unicode sanitization | M1.15 `sanitizeToolText` step |
| 4b.M1.16 `_meta.searchHint`/`alwaysLoad` | M1.16 `_meta` → Tool mapping |
| 4b.M1.17 LRU connection cache | M1.17 `McpManager` cache |
| 4b.M2.7 parallel tool execution | M2.7 concurrent dispatch for readOnly batches |
| 4b.M2.8 annotation-aware permission prompt | M2.8 prompt suffix + banner + narrow auto-accept |
| 4b.M2.9 `shouldDefer`/`alwaysLoad` scheduling | M2.9 loop filter |
| 4b.M2.10 tool `aliases[]` | M2.10 registry resolution |
| 4b.M2.11 `isOpenWorld` UI | M2.11 "(network)" suffix |
| 4b.M2.12 typed progress events | M2.12 generic `ToolCallProgress<P>` |
| 4b.M3.4 manifest metadata | M3.4 optional manifest fields + `plugin list` CLI |
| 4b.M3.5 `--plugin-dir` | M3.5 CLI flag + session plugin source |
| 4b.M3.6 `userConfig` | M3.6 first-enable dialog + persistence |

## 4. Module layout

### Existing modules modified
- `src/core/mcp/{client,manager,toolAdapter}.ts`
- `src/core/mcp/sdkBridge.ts` (re-export stderr stream accessor)
- `src/core/agent/loop.ts` (parallel dispatch, filter, progress pump widening)
- `src/core/tools/{registry,types}.ts`
- `src/core/permission/bridge.ts` (prompt suffix + banner hooks)
- `src/core/plugin/{manifest,loader,wire,install}.ts`
- `src/core/config/paths.ts`
- `src/cli.tsx` (`plugin list`, `--plugin-dir`)
- `src/tui/Messages/ToolCall.tsx` (openWorld suffix)
- `src/tui/dialogs/{PermissionDialog,ElicitationDialog}.tsx`
- `src/tui/App.tsx` (new dialog kind `'plugin-config'`)

### New modules
- `src/core/mcp/stderrBuffer.ts` — bounded ring buffer.
- `src/core/mcp/outputPersist.ts` — threshold-gated disk write.
- `src/core/mcp/sanitize.ts` — unicode scrub.
- `src/core/mcp/lruCache.ts` — LRU keyed by `name+configHash`.
- `src/core/tools/concurrency.ts` — parallel-safe batcher.
- `src/core/tools/progress.ts` — `ToolCallProgress<P>` generic.
- `src/core/plugin/sessionPlugins.ts` — `--plugin-dir` source.
- `src/core/plugin/userConfig.ts` — config persistence + prompt.
- `src/tui/dialogs/PluginConfigDialog.tsx` — reuses Elicitation form-mode.

## 5. Design decisions

### 5.1 Parallel tool execution (M2.7)

Current: agent loop iterates `calls` serially, awaiting each.

Target: when `calls.length ≥ 2` AND every resolved `tool.annotations?.readOnly === true` AND no two calls share the same tool name (prevents interleaved side effects even on readonly tools that cache), dispatch via `Promise.allSettled` with a concurrency cap of 4 (via a semaphore — see `src/core/tools/concurrency.ts`). Mixed batches (any non-readonly / unannotated tool, or any duplicate name) fall back to the existing serial path. A single-call batch is always serial to preserve stream interleaving with the UI.

Error handling: each parallel call still emits `tool_call` / `tool_result` events in input order; out-of-order completion is re-ordered before emission. If any call throws (not a tool error — an actual exception), that single result becomes `{ output: String(err), isError: true }`; the other calls still complete.

Permission prompts: the loop currently calls `permission.check` serially inside the per-call loop. For parallel batches, permission is resolved serially *before* dispatch so the user sees one prompt at a time; only tool `run()` is parallelized.

### 5.2 Annotation-aware permission prompt (M2.8)

`PermissionChecker.check` returns `PermissionDecision`. Extend the prompt-payload type with optional `annotationBadges: Array<'read-only' | 'destructive' | 'network'>` derived from the tool. `PermissionDialog` renders these as colored badges (read-only cyan, destructive red-on-black, network yellow).

Narrow auto-accept rule: if `tool.needsPermission(input) === 'none'` AND `tool.annotations?.readOnly === true`, skip the prompt entirely (as today). The new behavior: if `needsPermission !== 'none'` but `readOnly === true`, the prompt still appears but defaults the cursor to "Allow" and displays the badge. `destructive === true` moves the default cursor to "Deny" and adds a "⚠ destructive tool" header line.

### 5.3 Plugin userConfig at enable time (M3.6)

Manifest gains optional `userConfig?: { fields: Array<{ name: string; type: 'string' | 'number' | 'boolean'; description?: string; default?: unknown; required?: boolean }> }`. On *first* enable (plugin name newly appears in `config.plugins.enabled` OR first-ever load when `enabled` is undefined), if the plugin has `userConfig.fields.length > 0` and no persisted config exists, open a `'plugin-config'` dialog (reuses `ElicitationDialog` form-mode). User submissions persist to `~/.nuka/plugins/<name>/.userconfig.json`.

Tool `run` context gains `pluginConfig?: Record<string, unknown>` — populated by `wirePlugin` when loading tool modules from a plugin. Non-plugin tools get `undefined`. Type-safe access is a user concern (the plugin author writes their own schema).

Cancel handling: if the user cancels the dialog, the plugin is skipped for this session (not persisted as disabled); next launch re-prompts.

### 5.4 `--plugin-dir` flag (M3.5)

New CLI flag `--plugin-dir <path>` (repeatable). Plugins in these directories load as an *additional source* alongside `~/.nuka/plugins/`. They:
1. Load even when `config.plugins.enabled` is set (bypass the filter).
2. Are tagged `{ source: 'session', dir: <path> }` on the `LoadedPlugin` type.
3. Are displayed with a `[session]` badge in the TUI status line alongside the existing plugin count.
4. Do NOT appear in `plugin list` output (since they're not installed).

Session-source plugin names never overwrite installed plugin names — collision → warn + skip the session copy.

### 5.5 Mechanical items

| Item | Summary |
|---|---|
| M1.13 stderr | `StdioClientTransport` stderr piped through a ring buffer (`stderrBuffer.ts`, default 64 MB cap, FIFO eviction). Exposed as `McpClient.stderr(): string`. Emitted in the error-status reason when connect fails. |
| M1.14 large-output persist | In `callTool`, if truncated string output length > 500 000 chars (after M1.1 truncation), write the *original untruncated* content to `mcp-out-<ulid>.txt` under `mcpTmpDir()`; returned output is "[first N chars…] (full output at <path>)". `config.mcp.persistThresholdChars` default 500 000. |
| M1.15 unicode sanitize | `sanitizeToolText(s)` strips BOM (U+FEFF), C0 controls except `\t\n\r`, C1 controls (U+0080–U+009F), and zero-width joiners (U+200B–U+200D, U+2060, U+FEFF). Applied in `callTool`/`readResource` to each text block before truncation. |
| M1.16 `_meta` → Tool | MCP tool descriptors with `_meta.searchHint: string[]` and `_meta.alwaysLoad: boolean` mirror into `Tool.searchHint?: string[]` and `Tool.alwaysLoad?: boolean`. |
| M1.17 LRU cache | `McpManager` gains a `connectionCache` (LRU, max 50, key = `name + sha256(config).slice(0,8)`). `clearServerCache(name?)` invalidates one or all. Used to memoize already-connected clients across repeated `startAll` calls. |
| M2.9 shouldDefer/alwaysLoad | Agent loop filters `tools.listSpecs()` before provider call: `alwaysLoad === true` always included; `shouldDefer?(input)` called with `{ text: input.text }` and skipped when returning `true`; otherwise included. Keyword match on `searchHint` + the first user message text un-defers a tool for the remaining session. |
| M2.10 aliases | `Tool.aliases?: string[]`. `ToolRegistry.find(name)` checks `name`, then any `aliases` match. On register: if an alias collides with an existing primary name or alias, warn and skip the alias mapping (but keep the primary registration). |
| M2.11 openWorld UI | `ToolCall.tsx` renders a subtle `(network)` suffix when `source === 'mcp'` AND the ambient registry lookup resolves `annotations.openWorld === true`. Requires `ToolCall` to accept an optional `annotations` prop; populated in `MessageRow`. |
| M2.12 progress generic | `ToolCallProgress<P = string>`: current `onProgress(text: string)` stays the default. A new `onProgressTyped?<P>(payload: P)` can emit structured payloads; tools opt in by declaring `progressType: 'line' \| 'object'`. For 4b only `'line'` is wired end-to-end; `'object'` defines the type but render is a JSON.stringify fallback. |
| M3.4 metadata | Manifest adds optional `author?: string`, `homepage?: string`, `repository?: string`, `license?: string`, `keywords?: string[]`. `nuka plugin list` CLI subcommand prints name, version, and these fields. |

## 6. Phased delivery

Three parallel worktrees. Merge order **M2 → M1 → M3** (same foundation reason: M2's `Tool` interface changes — `aliases`, `alwaysLoad`, `searchHint`, generic progress — are read by M1.16 when mirroring `_meta` fields, and by M3.5 when displaying session plugins).

```
M1 (MCP polish)        │━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
M2 (Tools + annotations)│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
M3 (Plugin polish)      │━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
```

## 7. Acceptance

Phase 4b complete when:
- All 14 items landed on `main` with commit SHAs recorded in the Gap Closure appendix.
- `npm test` ≥ **420 passing** (383 baseline + ~40 new).
- `npm run typecheck` clean.
- `npm run build` — `dist/cli.js` ≤ 250 KB.
- No open items marked `DONE_WITH_CONCERNS` that block Phase 5 design.

## 8. Out of scope (Phase 5+)

- Plugin marketplace config + URL/git/npm installers.
- Plugin dependency resolution + demote-on-missing.
- Plugin manifest: `agents` / `outputStyles` / `channels` / `lspServers`.
- Config scope tiers.
- Plugin auto-update + blocklist + signature verification.
- Tool strict-mode API schemas.
- `getPath` / `toAutoClassifierInput` helpers (cosmetic / auto-mode specific).
