# Nuka Phase 5 — Marketplace, Agents Swarm & Advanced Manifest Plan

**Spec:** `docs/superpowers/specs/2026-04-24-phase5-marketplace-agents-design.md`
**Baseline:** 518 tests passing, HEAD `5b056b9` on `main`; `dist/cli.js` 177.1 KB.

## Conventions (inherited from 4a/4b)

- Each task lists: files, contract, acceptance.
- Tests first where feasible. One focused commit per task.
- Commit style: `type(scope): subject` + HEREDOC body + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Green gate per commit: `npm run typecheck` + `npm test` clean.
- No new deps unless a task explicitly calls for one (note: `npm` installer may shell out to the system `npm`; `.mcpb` unpacker needs a zip library — we use Node's built-in `zlib`/`tar` if possible else pick a minimal dep; see individual tasks).

## Parallel execution model — **four worktrees**

| Mega | Worktree | Branch | Items |
|---|---|---|---|
| **M4-install** | `wt-phase5-install` | `phase5-m4-install` | 7 |
| **M4-ops** | `wt-phase5-ops` | `phase5-m4-ops` | 5 |
| **M5-agents** | `wt-phase5-agents` | `phase5-m5-agents` | 7 sub-tasks (1 mega) |
| **M5-platform** | `wt-phase5-platform` | `phase5-m5-platform` | 3 |

**Merge order:** M4-install → M5-agents → M5-platform → M4-ops.

**Collision map:**
- `src/core/plugin/manifest.ts` — touched by M4-install (deps field), M5-agents (agents), M5-platform (outputStyles, channels). All additive.
- `src/core/config/schema.ts` — touched by M4-install (marketplace paths) and M5-platform (scope cascade). M5-platform rewrites `loadConfig`; M4-install's additions are field-level.
- `src/core/agent/loop.ts` — touched only by M5-agents (dispatch tool registration). No collision.

---

## §M4-install — Marketplace + all installers + deps + version cache (7 items)

### M4.1 — `marketplaces.json` config

**Files:**
- `src/core/plugin/marketplace.ts` — new.
- `src/core/config/paths.ts` — `marketplacesPath(home)` = `${home}/.nuka/marketplaces.json`.
- Tests: `test/core/plugin/marketplace.test.ts`.

**Contract:**
```ts
export type MarketplaceSource =
  | { type: 'url'; url: string; refresh?: string }
  | { type: 'git'; git: string; branch?: string }
  | { type: 'path'; path: string }

export type MarketplacesConfig = { sources: Record<string, MarketplaceSource> }

export async function loadMarketplaces(home: string): Promise<MarketplacesConfig>
export async function saveMarketplaces(home: string, cfg: MarketplacesConfig): Promise<void>
export async function addMarketplace(home: string, name: string, source: MarketplaceSource): Promise<void>
export async function removeMarketplace(home: string, name: string): Promise<void>
```

Empty config returned when file absent. Atomic write (tmp + rename).

**Acceptance:**
1. `loadMarketplaces` on missing file → `{ sources: {} }`.
2. `addMarketplace` then `loadMarketplaces` → added source appears.
3. Two concurrent `addMarketplace` calls don't corrupt the file.

### M4.2 — URL index fetch + cache

**Files:**
- `src/core/plugin/marketplaceIndex.ts` — new (sibling to `marketplace.ts`).
- Tests: `test/core/plugin/marketplaceIndex.test.ts`.

**Contract:**
```ts
export type MarketplaceIndex = {
  plugins: Array<{
    name: string
    description?: string
    source: string
    version?: string
    keywords?: string[]
    license?: string
  }>
}

export async function fetchIndex(source: MarketplaceSource, cachePath: string): Promise<MarketplaceIndex>
// On success writes to cachePath (atomic). On failure returns cached copy if fresh
// (per source.refresh), else throws.

export async function searchIndex(
  home: string,
  query: string,
): Promise<Array<{ marketplace: string; plugin: MarketplaceIndex['plugins'][number] }>>
```

**Acceptance:**
1. First fetch writes cache; second fetch within refresh window reads cache.
2. Search across multiple marketplaces returns all matches (substring match on name/description/keywords).

### M4.3 — Git installer (`git clone --depth 1`)

**Files:**
- `src/core/plugin/install/git.ts` — new.
- Tests: `test/core/plugin/installGit.test.ts`.

**Contract:**
```ts
export async function installFromGit(opts: {
  gitUrl: string
  branch?: string
  home: string
}): Promise<{ cacheDir: string; version: string }>
```

Shells out to `git` via `execa`. `version = git rev-parse --short HEAD`. Requires `git --version` to work; fails with a clear message otherwise. Clones into `${home}/.nuka/plugins/cache/git/<urlHash>/<version>/`.

**Acceptance:** a local bare-repo test fixture clones successfully; version field is populated with the short SHA.

### M4.4 — Npm installer (`npm pack` + extract)

**Files:**
- `src/core/plugin/install/npm.ts` — new.
- Tests: `test/core/plugin/installNpm.test.ts`.

**Contract:**
```ts
export async function installFromNpm(opts: {
  pkg: string
  version?: string
  home: string
}): Promise<{ cacheDir: string; version: string }>
```

Flow: `npm pack <pkg>@<ver>` (in a temp dir) → parse tarball name → extract `tar.gz` → locate `package/plugin.yaml|json` at package root → copy to cache dir `${home}/.nuka/plugins/cache/npm/<pkg-scoped-name>/<version>/`. Security guard: reject if the package's `package.json` declares `scripts.preinstall`/`install`/`postinstall` — log clearly that Nuka refuses lifecycle-script-bearing packages.

**Acceptance:**
1. A local tarball matching the expected layout installs cleanly.
2. A tarball with `postinstall` script is rejected with the clear message.

### M4.5 — Dependency closure (DFS + cycle detection)

**Files:**
- `src/core/plugin/deps.ts` — new (or extend the 4a scaffold if present — check first).
- `src/core/plugin/manifest.ts` — `dependencies?: Array<{ name: string; version?: string; required?: boolean }>`.
- Tests: `test/core/plugin/deps.test.ts`.

**Contract:**
```ts
export type DepClosure = {
  order: string[]
  cycles: string[][]
  missing: Array<{ name: string; declaredBy: string[] }>
}

export async function resolveDepClosure(
  root: PluginManifest,
  resolve: (name: string) => Promise<PluginManifest | null>,
): Promise<DepClosure>
```

Topological sort: roots first (no deps), leaves later. Cycle detection via DFS with color state (white/gray/black); gray→gray re-encounter = cycle.

**Acceptance:**
1. `A → B → C` yields `order: ['C', 'B', 'A']`.
2. `A → B → A` yields one cycle containing both `A` and `B`.
3. `A → missing-X` yields `missing: [{ name: 'missing-X', declaredBy: ['A'] }]` and `order: ['A']`.

### M4.6 — Versioned cache paths + active-version symlink

**Files:**
- `src/core/plugin/versionCache.ts` — new.
- `src/core/plugin/loader.ts` — prefer the symlink's target over a direct dir.
- Tests: `test/core/plugin/versionCache.test.ts`.

**Contract:**
```ts
export function cacheDirFor(home: string, source: 'git'|'npm'|'bundle'|'path', key: string, version: string): string
// returns ${home}/.nuka/plugins/cache/<source>/<key>/<version>/

export async function activateVersion(home: string, pluginName: string, cacheDir: string): Promise<void>
// creates/replaces symlink ${home}/.nuka/plugins/<pluginName> → cacheDir, atomic.

export async function listInstalledVersions(home: string, pluginName: string): Promise<string[]>
```

Atomic symlink replace: write to a `.tmp` sibling then `fs.rename`.

**Acceptance:**
1. `activateVersion` creates the symlink; calling again with a different cacheDir points the symlink to the new target.
2. `listInstalledVersions` returns all cached versions regardless of active.

### M4.12 — `.mcpb` / `.dxt` bundle unpacker

**Files:**
- `src/core/plugin/install/bundle.ts` — new.
- Tests: `test/core/plugin/installBundle.test.ts`.

**Contract:**
```ts
export async function installFromBundle(opts: {
  bundlePath: string      // local path or downloaded file
  home: string
}): Promise<{ cacheDir: string; version: string; sha256: string }>
```

Implementation: verify `.mcpb` or `.dxt` suffix (both are zip-format by convention). Use Node's `zlib` + a minimal zip reader — if the codebase lacks one, shell out to the system `unzip` command (fail loud if absent). Extract to cache dir. Version = file's mtime formatted as `YYYYMMDD-HHMMSS` unless the manifest carries a `version`.

**IMPORTANT — deps:** **Do NOT install a new npm dep** (no `adm-zip`, no `yauzl`). Either use Node built-ins or shell out to `unzip`. If `unzip` isn't available, this task's acceptance #2 below can fall back to graceful error messaging — document the choice in the commit.

**Acceptance:**
1. A handcrafted `.mcpb` test fixture (zip with a `plugin.yaml` at root) unpacks to the cache dir; sha256 matches.
2. A missing `unzip` binary surface is a clear error, not a crash.

---

## §M4-ops — Auto-update + blocklist + validate + `/plugin` TUI + options (5 items)

### M4.7 — Background auto-update (git-pull on marketplace repos)

**Files:**
- `src/core/plugin/autoupdate.ts` — new.
- Tests: `test/core/plugin/autoupdate.test.ts`.

**Contract:**
```ts
export async function updateMarketplace(home: string, name: string): Promise<{ changed: boolean }>
// git-based source: `git pull --ff-only`; returns changed=true if HEAD moved.
// url-based source: re-fetch + compare hash; changed=true if different.
export async function updateAllMarketplaces(home: string): Promise<Array<{ name: string; changed: boolean }>>
```

Background: on startup, if `config.plugins.autoUpdate === true` (new field), fire `updateAllMarketplaces` without blocking the main loop. Log updates to a ring buffer visible via `/plugin log`.

**Acceptance:**
1. Unchanged marketplace → `{ changed: false }`.
2. Moved HEAD → `{ changed: true }`.
3. autoUpdate disabled in config → updater never runs.

### M4.8 — Blocklist + delist auto-uninstall

**Files:**
- `src/core/plugin/blocklist.ts` — new.
- Tests: `test/core/plugin/blocklist.test.ts`.

**Contract:**
```ts
export type Blocklist = { blocked: Array<{ name: string; reason?: string; sinceVersion?: string }> }
export async function fetchBlocklist(sourceUrl: string, cachePath: string): Promise<Blocklist>
export async function detectDelisted(
  installed: Array<{ name: string; version: string }>,
  blocklist: Blocklist,
): Array<{ name: string; reason: string }>
```

On startup: fetch blocklist from `config.plugins.blocklistUrl` if set. Matching installed plugins are warned about and (if `config.plugins.autoUninstallBlocked === true`) uninstalled via the symlink-removal path (cache retained so user can recover).

**Acceptance:**
1. Installed plugin `foo@1.0` matches a blocklist entry `{ name: 'foo' }` → delisted.
2. `{ name: 'foo', sinceVersion: '2.0' }` with installed `1.0` → NOT delisted.

### M4.9 — `plugin validate` author CLI

**Files:**
- `src/core/plugin/validate.ts` — new.
- `src/cli.tsx` — add `plugin validate <path>` subcommand.
- Tests: `test/core/plugin/validate.test.ts`.

**Contract:**
```ts
export type ValidationReport = {
  errors: Array<{ path: string; message: string }>
  warnings: Array<{ path: string; message: string }>
}
export async function validatePlugin(pluginDir: string): Promise<ValidationReport>
```

Checks:
- `plugin.yaml` or `plugin.json` exists and parses.
- Schema validates (Zod).
- Each referenced `tools[].import` path exists and is importable (dry-run `import()`).
- Each `slashCommands[].path` exists.
- Each `skills[]` markdown exists.
- Each `agents[].systemPromptPath` exists (if present — skips when 5.M5.1 isn't loaded yet, but schema validates).
- Each `outputStyles[].componentPath` exists and default-exports a function.
- `dependencies[]` resolve locally (warning, not error, since author may not have deps installed).

CLI exit code: 0 if no errors, 2 if any errors, 1 on unexpected crash.

**Acceptance:**
1. A valid plugin reports empty errors/warnings.
2. An invalid plugin (missing referenced file) reports specific error paths.
3. `nuka plugin validate` exits non-zero for invalid plugins.

### M4.10 — Interactive `/plugin` slash command

**Files:**
- `src/slash/plugin/search.ts`, `install.ts`, `uninstall.ts`, `list.ts`, `enable.ts`, `disable.ts`, `update.ts` — new; each is a small slash handler.
- `src/slash/registry.ts` — register the `/plugin` namespace.
- Tests: `test/slash/plugin.test.ts`.

**Contract:** each is a function `(args: string) => Promise<SlashResult>` where `SlashResult = { text: string } | { text: string; isError: true }`.

Behavior:
- `/plugin search <q>` — calls `searchIndex`, prints name + marketplace + description per hit.
- `/plugin install <ref>` — dispatches to local/git/npm/bundle/marketplace installer.
- `/plugin uninstall <name>` — removes the symlink, keeps cache.
- `/plugin list` — prints installed + enabled state.
- `/plugin enable <name>` / `/plugin disable <name>` — mutates `config.plugins.enabled` via `saveConfig`.
- `/plugin update [<name>]` — runs update for one or all installed plugins.

**Acceptance:** each slash command returns a user-readable text result in the mocked registry tests.

### M4.11 — Plugin options storage (userConfig generalization)

**Files:**
- `src/core/plugin/optionsStorage.ts` — new. Generalizes 4b.M3.6 `.userconfig.json` to include "marketplace-delivered" defaults + user overrides.
- `src/core/plugin/userConfig.ts` — refactor to read through `optionsStorage` (backward-compatible paths).
- Tests: `test/core/plugin/optionsStorage.test.ts`.

**Contract:**
```ts
export type PluginOptions = {
  defaults: Record<string, unknown>     // from manifest userConfig.default
  userValues: Record<string, unknown>   // from .userconfig.json
  marketplaceDefaults?: Record<string, unknown>  // fetched from marketplace
}

export async function readOptions(home: string, pluginName: string): Promise<PluginOptions>
export async function writeUserValues(home: string, pluginName: string, values: Record<string, unknown>): Promise<void>
export function effectiveValues(opts: PluginOptions): Record<string, unknown>
// merge order: defaults < marketplaceDefaults < userValues
```

**Acceptance:**
1. No `.userconfig.json` → `effectiveValues` returns `defaults ∪ marketplaceDefaults` unchanged.
2. User writes `{ token: 'x' }` → `effectiveValues.token === 'x'` overriding default.

---

## §M5-agents — Agents swarm (7 sub-tasks)

This workstream owns one headline feature split into seven commits.

### M5.1.1 — Manifest schema

**Files:**
- `src/core/plugin/manifest.ts` — add `agents?: Array<AgentDef>` per spec §5.4.1.
- `src/core/agents/types.ts` — new: `AgentDef`, `ResolvedAgentDef` types.
- Tests: extend `test/core/plugin/manifest.test.ts`.

**Acceptance:** manifest with a well-formed `agents` array parses; `systemPrompt` + `systemPromptPath` both present → reject; neither present → reject.

### M5.1.2 — Agent loader + registry

**Files:**
- `src/core/agents/loader.ts` — new. Resolves `systemPromptPath` from disk; produces `ResolvedAgentDef`.
- `src/core/agents/registry.ts` — new. `AgentRegistry { register(def), find(name), list() }`.
- `src/core/plugin/wire.ts` — call the agent loader during wire; register each resolved agent.
- Tests: `test/core/agents/registry.test.ts`, `test/core/agents/loader.test.ts`.

**Acceptance:**
1. A plugin with two agents → both appear in `registry.list()` after wire.
2. Inline systemPrompt returns as-is; file-based resolves + reads the file.
3. Missing systemPromptPath → wire fails with a clear error; other plugins still load.

### M5.1.3 — Tool filter

**Files:**
- `src/core/agents/toolFilter.ts` — new.
- Tests: `test/core/agents/toolFilter.test.ts`.

**Contract:**
```ts
export function filterTools(
  all: Tool[],
  def: { allowedTools?: string[]; deniedTools?: string[] },
): Tool[]
// allowedTools is a whitelist (if present); deniedTools is applied after.
// If neither is set, returns `all`.
```

**Acceptance:**
1. `allowedTools: ['Read']` → only `Read` tool.
2. `deniedTools: ['Bash']` → all except Bash.
3. Both: allow first, then deny within that set.

### M5.1.4 — Dispatch

**Files:**
- `src/core/agents/dispatch.ts` — new.
- Tests: `test/core/agents/dispatch.test.ts`.

**Contract:**
```ts
export async function dispatchAgent(opts: {
  agent: ResolvedAgentDef
  task: string
  context?: string
  registry: ToolRegistry     // from main session — will be filtered
  providerResolver: ProviderResolver
  permission: PermissionChecker
  signal: AbortSignal
  maxTurns?: number
}): Promise<{
  output: string | ContentBlock[]
  isError: boolean
  turns: number
  usage: Usage
}>
```

Builds fresh `Session` with agent's systemPrompt + one user message (`task` + optional `context`). Runs `runAgent` loop to completion or `maxTurns` cap. Collects the final assistant message's text OR a structured ContentBlock[] if any tool produced non-text. Flag `session.allowedAgentDispatch = false` so recursion guard (5.1.6) fires.

**Acceptance:**
1. A mocked provider returning one assistant message → dispatch returns the message's text.
2. A mocked provider looping past `maxTurns` → dispatch returns with `turns === maxTurns` and `isError: true` ("max turns exceeded").
3. Dispatch-within-dispatch (via the flag) → inner dispatch returns error.

### M5.1.5 — `dispatch_agent` tool

**Files:**
- `src/core/agents/dispatchTool.ts` — new. Builds a `Tool` the main registry registers when `AgentRegistry.list().length > 0`.
- `src/core/tools/registry.ts` — register the tool conditionally (call during bootstrap after agent loading completes).
- Tests: `test/core/agents/dispatchTool.test.ts`.

**Contract:**
```ts
export function makeDispatchAgentTool(deps: {
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
}): Tool
```

The tool's description is built dynamically from the agent list so the model sees what's available. Annotations: `{ readOnly: true, destructive: false, openWorld: true }`.

**Acceptance:**
1. With 2 agents, the tool's `description` includes both names + descriptions.
2. Calling the tool with a valid agent name dispatches; invalid name returns an error tool result.

### M5.1.6 — Recursion guard + parallel dispatch wiring

**Files:**
- `src/core/agents/dispatch.ts` — set `session.allowedAgentDispatch = false` on the sub-session.
- `src/core/agents/dispatchTool.ts` — refuse to run when invoked with `ctx` from a session that has `allowedAgentDispatch === false`.
- `src/core/session/types.ts` — add `allowedAgentDispatch?: boolean` (undefined/true = allowed).
- `src/core/agent/loop.ts` — ensure `canParallelize` from 4b.M2.7 recognizes `dispatch_agent` as a parallel-eligible readOnly tool (already the case if annotations are correct, but add a test).
- Tests: `test/core/agents/recursion.test.ts`, extend `test/core/agent/loop.test.ts`.

**Acceptance:**
1. Main session makes 2 parallel `dispatch_agent` calls → both run concurrently (not serial).
2. Sub-agent's session, calling `dispatch_agent` → refused; other tools still work.

### M5.1.7 — TUI rendering

**Files:**
- `src/tui/Messages/AgentCall.tsx` — new. Indented sub-session rendering with agent-name badge.
- `src/tui/Messages/MessageRow.tsx` — detect `dispatch_agent` tool calls and render via `AgentCall` instead of the default `ToolCall`.
- `src/tui/App.tsx` — keyboard handler for Ctrl+A to toggle expansion of the most recent agent call.
- Tests: `test/tui/agentCall.test.tsx`.

**Acceptance:**
1. A `dispatch_agent` call renders with indented sub-session and `[<agent>]` badge.
2. Final result text appears inline in the main transcript with a "(from `<agent>`)" trailer.
3. Ctrl+A toggles expanded/collapsed state.

---

## §M5-platform — outputStyles + channels + config scope (3 items)

### M5.2 — outputStyles custom renderers

**Files:**
- `src/core/plugin/manifest.ts` — `outputStyles?: Array<OutputStyleDef>`.
- `src/core/plugin/outputStyles.ts` — new. Loader + match function.
- `src/core/plugin/wire.ts` — import each component during wire; register into a module-level registry.
- `src/tui/Messages/MessageRow.tsx` — on `tool_result`, look up a style; if match, render via it; on throw, fall back to default + console.warn.
- Tests: `test/core/plugin/outputStyles.test.ts`, `test/tui/outputStylesRender.test.tsx`.

**Contract:**
```ts
export type OutputStyleDef = {
  name: string
  matchToolName?: string       // glob
  matchToolSource?: 'mcp' | 'plugin' | 'skill' | 'builtin'
  componentPath: string
}

export function matchStyle(
  toolName: string,
  source: Tool['source'],
  defs: OutputStyleDef[],
): OutputStyleDef | undefined
// first matching def wins; match order = registration order
```

**Acceptance:**
1. Glob `mcp__github__*` matches `mcp__github__listRepos`; doesn't match `Read`.
2. Throwing component → render falls back to default `ToolCall`, warning printed.

### M5.3 — channels notification routing

**Files:**
- `src/core/plugin/manifest.ts` — `channels?: Array<ChannelDef>`.
- `src/core/notifications/channels.ts` — new: definitions + dispatch (webhook/command).
- `src/core/agent/loop.ts` — emit agent events to the channel dispatcher at each seam (`tool_result`, `turn_end`, `error`). Non-blocking.
- Tests: `test/core/notifications/channels.test.ts`.

**Contract:**
```ts
export type ChannelDef = {
  name: string
  allowlist: Array<'tool_result' | 'turn_end' | 'error' | 'plugin_install' | 'plugin_uninstall' | 'plugin_enable' | 'plugin_disable'>
  dispatch: { type: 'webhook'; url: string } | { type: 'command'; command: string }
}

export async function dispatchToChannels(
  channels: ChannelDef[],
  event: { type: string; payload: unknown },
): Promise<void>  // never throws; failures logged
```

Webhook: HTTP POST JSON body `{ type, payload, ts }`. Command: spawn via `execa`, JSON on stdin. Timeout 10s.

**Acceptance:**
1. Event outside allowlist → no dispatch call.
2. Failing webhook → no propagation; warning logged once.

### M5.5 — Config scope cascade

**Files:**
- `src/core/config/scope.ts` — new. Per-scope readers + resolver.
- `src/core/config/scopeMerge.ts` — new. Deep-merge with lock semantics.
- `src/core/config/loadConfig.ts` (or wherever current load lives) — rewrite `loadConfig()` to cascade through scopes. Backward compat: old callers see the merged result.
- `src/core/config/schema.ts` — extend `AppConfigSchema` to allow an optional `locked?: string[]` at top level (only honored from enterprise scope).
- `src/cli.tsx` — `nuka config show [--scope <name>]` subcommand.
- Tests: `test/core/config/scope.test.ts`.

**Contract:**
```ts
export type ConfigScope = 'enterprise' | 'user' | 'project' | 'local'
export const SCOPE_ORDER: ConfigScope[] = ['enterprise', 'user', 'project', 'local']

export async function loadScopedConfig(): Promise<{
  effective: AppConfig
  perScope: Record<ConfigScope, Partial<AppConfig> | null>
  locked: string[]   // dot-paths
  sources: Record<string, ConfigScope>   // for `config show`
}>
```

Scope discovery:
- enterprise: `/etc/nuka/config.yaml` (Linux) — absent on other platforms = null.
- user: `${home}/.nuka/config.yaml` (current).
- project: walk cwd ancestors for `.nuka/config.yaml` (first hit wins).
- local: `.nuka/config.local.yaml` in cwd only.

Merge: deep merge in SCOPE_ORDER. Locked fields from enterprise cannot be overridden by later scopes (drop the override with a warning).

**Acceptance:**
1. All four scopes present with overlapping keys → effective merged config uses last-wins semantics.
2. Enterprise-locked field → later scopes cannot override (verified by the effective value matching enterprise's).
3. `nuka config show --scope project` prints only project's contribution.

---

## Completion gate

- 16 items landed on `main` with commit SHAs in the Gap Closure appendix.
- `npm test` ≥ 600 passing (518 baseline + ~85).
- `npm run typecheck` clean.
- `npm run build` — `dist/cli.js` ≤ 300 KB hard ceiling; target 250 KB.
- Four mega branches merged in order **M4-install → M5-agents → M5-platform → M4-ops**.
- No open items marked `DONE_WITH_CONCERNS` that block Phase 6.
- Hands-on smoke: a local fixture marketplace + one dummy plugin with `agents[]` demonstrates `/plugin install`, `/plugin list`, and `dispatch_agent` end-to-end (document in the Gap Closure appendix as "demo steps").
