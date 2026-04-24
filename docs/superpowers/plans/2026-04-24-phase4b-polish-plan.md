# Nuka Phase 4b — Polish & Annotation Follow-through Plan

**Spec:** `docs/superpowers/specs/2026-04-24-phase4b-polish-design.md`
**Baseline:** 383 tests passing, HEAD `d42aa16` on `main`; `dist/cli.js` 148.8 KB.

## Conventions (inherited from 4a)

- Each task lists: files, contract, acceptance.
- Tests first where feasible. One focused commit per task.
- Minimal comments; commit message style: `type(scope): subject` with HEREDOC body and `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Green gate per commit: `npm run typecheck` + `npm test` clean.
- No new deps.

## Parallel execution model

Three mega-workstreams across isolated git worktrees:

| Mega | Domain | Worktree | Touches |
|---|---|---|---|
| **M1** | MCP operational polish | `wt-phase4b-mcp` | `src/core/mcp/**` |
| **M2** | Tool semantics + annotations | `wt-phase4b-tools` | `src/core/tools/**`, `src/core/agent/loop.ts`, `src/tui/**` |
| **M3** | Plugin polish | `wt-phase4b-plugin` | `src/core/plugin/**`, `src/cli.tsx` |

Collision points: `src/core/tools/types.ts` (M2 adds fields; M1 only adds `Tool.searchHint`/`Tool.alwaysLoad` mirroring which is a subset of M2's additions — **M1 M1.16 depends on M2's types.ts; M2 lands first, M1 imports the types post-rebase**). Merge order: **M2 → M1 → M3**.

Within each mega, tasks run sequentially via `superpowers:subagent-driven-development`.

---

## §M1 — MCP operational polish

### M1.13 — stderr capture (64 MB ring buffer)

**Files:**
- `src/core/mcp/stderrBuffer.ts` — new (ring buffer).
- `src/core/mcp/client.ts` — wire `stderr` into buffer for `stdio` transport.
- `src/core/mcp/sdkBridge.ts` — expose stderr readable stream.
- Tests: `test/core/mcp/stderrBuffer.test.ts`, extend `test/core/mcp/client.test.ts`.

**Contract:**
```ts
export class RingBuffer {
  constructor(maxBytes: number)
  write(chunk: string | Buffer): void
  read(): string
  size(): number
}
export const DEFAULT_STDERR_BUFFER_BYTES = 64 * 1024 * 1024
```

`McpClient.stderr(): string` — returns the current buffer content. Included in the error reason when connect fails on stdio (`error: 'spawn failed\n<stderr tail>'`).

**Acceptance:**
1. A `RingBuffer(100)` written 200 bytes retains the most recent 100 bytes.
2. A mocked stdio transport that emits stderr lines and then fails connect → the client's error status includes a suffix containing the emitted stderr.

### M1.14 — Large-output persistence

**Files:**
- `src/core/mcp/outputPersist.ts` — new.
- `src/core/mcp/client.ts` — in `callTool`, after M1.1 truncation, if original pre-truncation length > `persistThresholdChars`, write the full text to disk.
- `src/core/config/schema.ts` — extend `McpConfigSchema.persistThresholdChars: z.number().int().positive().default(500_000)`.
- Tests: `test/core/mcp/outputPersist.test.ts`.

**Contract:**
```ts
export function persistLargeOutput(opts: {
  home: string
  fullText: string
}): Promise<{ path: string }>
// Writes to ${home}/.nuka/tmp/mcp-out-<id>.txt, returns path.
```

Truncated `output` gains a suffix `\n...[full output at <path>]` when persistence fires. Only activates when `output` is a string (ContentBlock[] path skipped).

**Acceptance:** a `callTool` result with 1_000_000 chars + `persistThresholdChars: 500_000` writes a file containing the full text and includes the file path in the returned output.

### M1.15 — Unicode sanitization

**Files:**
- `src/core/mcp/sanitize.ts` — new.
- `src/core/mcp/client.ts` — apply in `callTool` and `readResource` to each text block before truncation.
- Tests: `test/core/mcp/sanitize.test.ts`, extend `test/core/mcp/client.test.ts`.

**Contract:**
```ts
export function sanitizeToolText(s: string): string
// Strips BOM (U+FEFF), C0 controls except \t \n \r (U+0000-U+0008, U+000B, U+000C, U+000E-U+001F),
// C1 controls (U+0080-U+009F), and zero-width characters (U+200B, U+200C, U+200D, U+2060, U+FEFF).
```

**Acceptance:** given a string containing all four categories of junk, sanitize strips only the listed code points; tabs/newlines/CRs survive.

### M1.16 — `_meta.searchHint` / `alwaysLoad` → Tool

**Files:**
- `src/core/mcp/types.ts` — `McpToolDescriptor._meta?: { searchHint?: string[]; alwaysLoad?: boolean }`.
- `src/core/mcp/client.ts` — carry `_meta` on list-tools.
- `src/core/mcp/toolAdapter.ts` — map `_meta.searchHint` → `Tool.searchHint`, `_meta.alwaysLoad` → `Tool.alwaysLoad`.
- Tests: extend `test/core/mcp/toolAdapter.test.ts`.

**IMPORTANT — depends on M2:** `Tool.searchHint?: string[]` and `Tool.alwaysLoad?: boolean` are added by M2 (M2.9). M1 uses them but does NOT define them. After rebase onto main (which carries M2), the typecheck passes.

**Acceptance:** a descriptor with `_meta: { searchHint: ['git'], alwaysLoad: true }` produces a Tool with matching fields.

### M1.17 — LRU connection cache

**Files:**
- `src/core/mcp/lruCache.ts` — new (simple LRU, O(1) get/set via Map insertion order).
- `src/core/mcp/manager.ts` — cache keyed by `name + configHash`; `startAll` reuses cached live clients; `clearServerCache(name?)` invalidates.
- Tests: `test/core/mcp/lruCache.test.ts`, extend `test/core/mcp/manager.test.ts`.

**Contract:**
```ts
export class LruMap<K, V> {
  constructor(max: number)
  get(k: K): V | undefined
  set(k: K, v: V): void
  delete(k: K): void
  clear(): void
  size(): number
}
export function configHash(cfg: unknown): string   // short hex, e.g. sha256 first 8 chars
```

`McpManager.clearServerCache(name?: string)`: no-arg clears all; named clears one.

**Acceptance:**
1. Manager `startAll` called twice with identical config → second call returns cached client (no new `McpClient` constructed).
2. Config change between calls → cache miss; new client built.
3. `clearServerCache('foo')` removes only `foo`'s entry.

---

## §M2 — Tool semantics + annotations cash-in

### M2.7 — Parallel tool execution for read-only batches

**Files:**
- `src/core/tools/concurrency.ts` — new (`semaphore`, `parallelBatch`).
- `src/core/agent/loop.ts` — conditional branch: when batch qualifies, run in parallel; else serial.
- Tests: `test/core/tools/concurrency.test.ts`, extend `test/core/agent/loop.test.ts`.

**Contract:**
```ts
export function createSemaphore(max: number): { acquire(): Promise<() => void> }
export async function parallelBatch<T>(
  items: T[],
  run: (item: T, index: number) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>,
  concurrency: number,
): Promise<Array<{ ok: true; value: unknown } | { ok: false; error: string }>>
```

Eligibility predicate — `canParallelize(calls, registry)`:
- `calls.length >= 2`
- Every resolved tool has `annotations?.readOnly === true`
- No two calls target the same tool name
- Concurrency cap 4 (hard-coded for this phase)

In the loop: when eligible, resolve all permissions serially FIRST (so the user sees one prompt at a time), then dispatch `tool.run` via `parallelBatch`; results re-ordered to input order before event emission.

**Acceptance:**
1. Two readOnly-tool calls take roughly `max(t1, t2)` wall-time, not `t1 + t2`.
2. Batch with one non-readonly tool falls back to serial.
3. Duplicate tool name in batch falls back to serial.
4. Event order (`tool_call` → `tool_result`) matches input order even when `t2` completes before `t1`.

### M2.8 — Annotation-aware permission prompt

**Files:**
- `src/core/permission/types.ts` — extend `PermissionPayload` (or equivalent input to `PermissionChecker.check`) with `annotationBadges?: Array<'read-only' | 'destructive' | 'network'>`.
- `src/core/permission/checker.ts` — populate badges from tool annotations.
- `src/core/permission/bridge.ts` — pass through.
- `src/tui/dialogs/PermissionDialog.tsx` — render badges (read-only cyan, destructive red-on-black, network yellow) above the action buttons; default cursor: Allow for readOnly+not-destructive; Deny if destructive.
- Tests: extend `test/tui/permissionDialog.test.tsx`.

**Acceptance:**
1. Tool with `annotations.readOnly=true` produces a prompt with a `read-only` badge.
2. Tool with `annotations.destructive=true` renders a red warning banner and the cursor defaults to Deny.
3. Tool with `needsPermission === 'none'` AND `annotations.readOnly=true` bypasses the prompt (regression check).

### M2.9 — `shouldDefer` / `alwaysLoad` scheduling

**Files:**
- `src/core/tools/types.ts` — `Tool.searchHint?: string[]`, `Tool.alwaysLoad?: boolean`, `Tool.shouldDefer?(input: { text: string }): boolean`.
- `src/core/agent/loop.ts` — before each provider call, filter `registry.listSpecs()`:
  - `alwaysLoad === true` → always included.
  - `shouldDefer?(...)` returning true → skip.
  - Otherwise → include.
- Agent-session state: `session.unDeferredToolNames: Set<string>` — once a user-message's text matches any `searchHint` token, that tool is included for the remainder of the session regardless of `shouldDefer`.
- Tests: `test/core/agent/toolSchedule.test.ts`.

**Acceptance:**
1. Tool with `alwaysLoad: true` is in every provider call.
2. Tool with `shouldDefer: () => true` is absent until its `searchHint` matches user text.
3. Once un-deferred, remains available in subsequent turns.

### M2.10 — Tool `aliases[]`

**Files:**
- `src/core/tools/types.ts` — `Tool.aliases?: string[]`.
- `src/core/tools/registry.ts` — `register` builds an alias → name map; `find(name)` checks primary name first, then alias map; on alias collision warn + skip the alias.
- Tests: extend `test/core/tools/registry.test.ts`.

**Acceptance:**
1. A tool `{ name: 'newName', aliases: ['oldName'] }` is findable by both.
2. Registering two tools claiming the same alias → second registration's alias is dropped with a warning; primary name still registers.

### M2.11 — `isOpenWorld` UI suffix

**Files:**
- `src/tui/Messages/ToolCall.tsx` — accept optional `annotations?: Tool['annotations']` prop; when `annotations?.openWorld === true`, append dim `(network)` after the tool name (before any status dot).
- `src/tui/Messages/MessageRow.tsx` — pass the annotations through from the registry lookup.
- Tests: extend `test/tui/toolCall.test.tsx`.

**Acceptance:** a ToolCall with `annotations: { openWorld: true }` renders a `(network)` suffix; without it, no suffix.

### M2.12 — Typed progress (`ToolCallProgress<P>`)

**Files:**
- `src/core/tools/progress.ts` — new.
- `src/core/tools/types.ts` — `Tool.progressType?: 'line' | 'object'`; `ToolRunContext.onProgress: (text: string) => void` stays; NEW `ToolRunContext.onProgressTyped?: <P>(payload: P) => void`.
- `src/core/agent/progressPump.ts` — widen to accept typed payloads; when `progressType === 'object'`, JSON.stringify for the `tool_progress` event `text` field.
- Tests: `test/core/tools/progress.test.ts`.

**Acceptance:**
1. Existing string-progress tools unchanged.
2. A tool declaring `progressType: 'object'` with `onProgressTyped({ pct: 50 })` emits a `tool_progress` event with text `{"pct":50}`.

---

## §M3 — Plugin polish

### M3.4 — Manifest metadata fields

**Files:**
- `src/core/plugin/manifest.ts` — extend `PluginManifestSchema` with optional `author`, `homepage`, `repository`, `license`, `keywords` (string array).
- `src/cli.tsx` — new `plugin list` subcommand: prints `name` version `— <description>` and metadata fields when present.
- Tests: extend `test/core/plugin/manifest.test.ts`; new `test/cli/pluginList.test.ts` (or equivalent location).

**Acceptance:**
1. A manifest with all five fields loads cleanly; a manifest without them (current baseline) still loads.
2. `nuka plugin list` prints each installed plugin with populated metadata shown one field per line (indented).

### M3.5 — `--plugin-dir` session-only flag

**Files:**
- `src/core/plugin/sessionPlugins.ts` — new.
- `src/core/plugin/loader.ts` — extend `loadPlugins({ home, extraDirs? })` to scan `extraDirs` after the home scan; session-source plugins tagged `{ source: 'session', dir: <path> }`; bypass the `enabledPlugins` filter.
- `src/core/plugin/manifest.ts` — extend `LoadedPlugin` with `source: 'installed' | 'session'` and optional `dir?: string`.
- `src/cli.tsx` — `--plugin-dir <path>` (repeatable) on launch; plumbed into `loadPlugins`.
- `src/tui/StatusBar` (or wherever plugin count is displayed) — show `[session: N]` badge when > 0.
- Tests: `test/core/plugin/sessionPlugins.test.ts`, extend `test/core/plugin/loader.test.ts`.

**Collision handling:** if a session plugin shares a name with an installed plugin → warn and skip the session copy (installed wins).

**Acceptance:**
1. `--plugin-dir /tmp/foo` where `/tmp/foo/bar/plugin.yaml` exists → `bar` loads as session plugin.
2. `config.plugins.enabled: ['a']` + session `b` → both `a` (installed) and `b` (session) load.
3. Name collision installed `c` + session `c` → only installed `c` loads; warning emitted.

### M3.6 — `userConfig` prompt at enable time

**Files:**
- `src/core/plugin/manifest.ts` — `PluginManifestSchema.userConfig?: { fields: Array<{ name: string; type: 'string' | 'number' | 'boolean'; description?: string; default?: unknown; required?: boolean }> }`.
- `src/core/plugin/userConfig.ts` — new: `getUserConfigPath`, `readUserConfig`, `writeUserConfig`.
- `src/core/plugin/wire.ts` — on wire, read persisted config; pass to tool run via a new `ToolRunContext.pluginConfig?: Record<string, unknown>`.
- `src/core/plugin/install.ts` / `loader.ts` — on first enable (new name appearing) with non-empty `userConfig.fields` and no persisted config, open the dialog.
- `src/tui/dialogs/PluginConfigDialog.tsx` — new; reuses `ElicitationDialog` form-mode rendering.
- `src/tui/App.tsx` — new dialog kind `'plugin-config'`; routes submit → `writeUserConfig`.
- `src/core/permission/bridge.ts` — or a sibling bridge — add `promptPluginConfig(plugin, fields): Promise<Record<string, unknown> | null>`.
- `src/core/tools/types.ts` — add `pluginConfig?: Record<string, unknown>` to `ToolRunContext`.
- Tests: `test/core/plugin/userConfig.test.ts`, `test/tui/pluginConfigDialog.test.tsx`.

**Cancel semantics:** user cancels → plugin is skipped for this session; NOT persisted as disabled; next launch re-prompts.

**Acceptance:**
1. Plugin with `userConfig.fields: [{ name: 'token', type: 'string', required: true }]` triggers the dialog on first load.
2. Submitted values are persisted to `~/.nuka/plugins/<name>/.userconfig.json`.
3. Second load reads persisted config; no dialog.
4. Cancel → plugin absent from this session; next load re-prompts.
5. Tool `run` called with `ctx.pluginConfig.token === <submitted value>`.

---

## Completion gate

- All 14 items committed on `main` with commit SHAs recorded in the Gap Closure appendix of `docs/superpowers/reviews/2026-04-24-phase3-vs-nuka-code.md`.
- `npm test` ≥ 420 passing (383 baseline + ~40 new).
- `npm run typecheck` clean.
- `npm run build` — `dist/cli.js` ≤ 250 KB.
- Three mega branches merged in order M2 → M1 → M3.
- No `DONE_WITH_CONCERNS` items that block Phase 5.
