# Nuka Phase 5 — Marketplace, Agents Swarm & Advanced Manifest Design Spec

**Status:** active. Successor to `2026-04-24-phase4b-polish-design.md`. Phase 4b is complete on `main` at commit `5b056b9`; 518 tests passing; `dist/cli.js` 177.1 KB.

**Reference:** closes 16 of the 17 Phase-5 items catalogued in `docs/superpowers/plans/2026-04-24-full-divergence-schedule.md`. The 17th item — LSP integration (5.M5.4) — is deferred to Phase 6 as a standalone focus.

Phase 5's headline feature is the **agents subsystem**: plugins declare one or more specialist agents, and the main agent can dispatch tasks to them with filtered tool sets, isolated context, and parallel execution. This is Nuka's answer to the multi-expert / task-routing patterns popularized by oh-my-claudecode and Anthropic's own Agent tool.

---

## 1. Goals

1. **Plugin marketplace** — users can search, install, update, and uninstall plugins from URL indexes, git repos, npm packages, and `.mcpb`/`.dxt` bundles. Dependencies resolved automatically. Versions cached on disk. Delisted plugins auto-uninstalled.
2. **Agents swarm** — plugins declare specialist agents with their own system prompts, tool filters, and optional keyword hints. The main agent can dispatch via a first-class `dispatch_agent` tool (one call, or many in parallel). Each sub-agent runs in an isolated session; results come back as a structured tool result.
3. **Author tooling** — `nuka plugin validate <path>` catches manifest errors and broken references before users see them. Interactive `/plugin` slash command in the TUI for search/install/enable/disable.
4. **Advanced manifest surfaces** — `outputStyles` (custom tool render components), `channels` (notification routing with allowlists), config scope cascade (local → project → user → enterprise).

## 2. Non-goals

Deferred to Phase 6+:
- **LSP integration (5.M5.4)** — standalone focus; needs its own phase.
- Marketplace signature verification / package-signing (intentional scope cut — deferred behind a policy toggle).
- Sandboxing for plugin-declared tool code (intentional; Nuka has never sandboxed plugin JS).
- Auto agent-to-agent dispatch (main agent can spawn sub-agents; sub-agents cannot spawn).
- Remote agent execution over the network.

## 3. Scope — 16 items mapped

### M4 — Marketplace + install (12 items)

| ID | Feature | Workstream |
|---|---|---|
| 5.M4.1 | `marketplaces.json` config | M4-install |
| 5.M4.2 | URL index fetch + cache | M4-install |
| 5.M4.3 | `git clone --depth 1` installer | M4-install |
| 5.M4.4 | npm package installer | M4-install |
| 5.M4.5 | Dependency closure (DFS + cycle detection) | M4-install |
| 5.M4.6 | Versioned cache paths | M4-install |
| 5.M4.12 | `.mcpb` / `.dxt` bundle unpacker | M4-install |
| 5.M4.7 | Background auto-update | M4-ops |
| 5.M4.8 | Blocklist / delist auto-uninstall | M4-ops |
| 5.M4.9 | `plugin validate` author CLI | M4-ops |
| 5.M4.10 | Interactive `/plugin` slash command | M4-ops |
| 5.M4.11 | Plugin options storage (userConfig follow-through) | M4-ops |

### M5 — Agents + platform (4 items)

| ID | Feature | Workstream |
|---|---|---|
| 5.M5.1 | `agents[]` multi-expert system | M5-agents (own stream) |
| 5.M5.2 | `outputStyles` custom renderers | M5-platform |
| 5.M5.3 | `channels` notification routing | M5-platform |
| 5.M5.5 | Config scope cascade | M5-platform |

## 4. Module layout

### Existing modules modified
- `src/core/plugin/{manifest,loader,install,wire,deps}.ts`
- `src/core/agent/{loop,events}.ts` (agents dispatch integration)
- `src/core/config/{schema,paths}.ts` (scope cascade, marketplace paths)
- `src/core/tools/registry.ts` (agent dispatch tools registration)
- `src/tui/App.tsx`, `src/tui/Messages/*` (outputStyles injection, agent sub-session rendering)
- `src/cli.tsx` (`plugin validate`, `plugin search`, `plugin install`, `plugin uninstall`, `plugin update`)
- `src/slash/` (new `/plugin` slash commands)

### New modules
- **Marketplace & install (M4-install):**
  - `src/core/plugin/marketplace.ts` — marketplace config reader + URL-index fetch + cache.
  - `src/core/plugin/install/git.ts` — `git clone --depth 1` installer.
  - `src/core/plugin/install/npm.ts` — `npm pack` + extract installer.
  - `src/core/plugin/install/bundle.ts` — `.mcpb` / `.dxt` unpacker.
  - `src/core/plugin/install/dispatch.ts` — source-type router (local | git | npm | bundle | marketplace ref).
  - `src/core/plugin/deps.ts` — DFS dependency closure + cycle detection.
  - `src/core/plugin/versionCache.ts` — versioned cache paths + symlink-to-active.
- **Ops (M4-ops):**
  - `src/core/plugin/autoupdate.ts` — background git-pull on official marketplace clones.
  - `src/core/plugin/blocklist.ts` — blocklist fetch + delist detection + auto-uninstall.
  - `src/core/plugin/validate.ts` — manifest + structure + deps validator.
  - `src/core/plugin/optionsStorage.ts` — generalization of 4b.M3.6 userConfig to cover marketplace-delivered runtime config.
  - `src/slash/plugin/*` — TUI commands for search/install/enable/etc.
- **Agents (M5-agents):**
  - `src/core/agents/types.ts` — `AgentDefinition` schema.
  - `src/core/agents/loader.ts` — reads `agents[]` + system-prompt markdown files from plugin dirs.
  - `src/core/agents/registry.ts` — `AgentRegistry.register(def)` / `find(name)` / `list()`.
  - `src/core/agents/dispatch.ts` — `dispatchAgent(name, task, ctx)` — orchestrates a sub-session.
  - `src/core/agents/dispatchTool.ts` — builds the `dispatch_agent` tool that the main agent calls.
  - `src/core/agents/toolFilter.ts` — allowedTools / deniedTools filtering.
  - `src/core/agents/router.ts` — keyword-based suggestion (not auto-invoke).
  - `src/tui/Messages/AgentCall.tsx` — indented sub-session rendering with agent-name badge.
- **Platform (M5-platform):**
  - `src/core/plugin/outputStyles.ts` — render-component registration + lookup by tool name / source.
  - `src/core/notifications/channels.ts` — channel definitions + allowlist filter + dispatch.
  - `src/core/config/scope.ts` — scope cascade reader (`enterprise` → `user` → `project` → `local`).
  - `src/core/config/scopeMerge.ts` — deep-merge with "lower scope wins" semantics.

## 5. Design decisions

### 5.1 Marketplace + URL index (M4.1–M4.2, M4.6)

**`~/.nuka/marketplaces.json`:**
```json
{
  "sources": {
    "official": {
      "type": "url",
      "url": "https://plugins.nuka.dev/index.json",
      "refresh": "24h"
    },
    "mine": {
      "type": "git",
      "git": "https://github.com/me/nuka-plugins.git",
      "branch": "main"
    }
  }
}
```

**Index shape (`index.json`):**
```json
{
  "plugins": [
    {
      "name": "prettier",
      "description": "Code formatter",
      "source": "git+https://github.com/nuka/prettier-plugin.git",
      "version": "1.2.0",
      "keywords": ["format", "style"],
      "license": "MIT"
    }
  ]
}
```

**Source URL scheme** (parsed by `install/dispatch.ts`):
- `git+<url>` or plain `https://github.com/…` → git installer.
- `npm:<package>` or plain package name with version → npm installer.
- `bundle:<url>` → `.mcpb`/`.dxt` bundle download + unpack.
- `path:<abs|rel>` → local copy.
- `<marketplace>:<plugin>` → resolve through marketplace, recurse.

**Cache:** `~/.nuka/plugins/cache/<marketplace>/<plugin>/<version>/` (M4.6). The active version is a symlink `~/.nuka/plugins/<plugin>` → the cache dir. `plugin uninstall` removes the symlink but retains the cache; `plugin purge` deletes the cache too.

### 5.2 Installers (M4.3, M4.4, M4.12)

**Git (M4.3):** `git clone --depth 1 --branch <ref> <url> <cacheDir>`; version = `git rev-parse --short HEAD` at clone time.

**Npm (M4.4):** `npm pack <pkg>@<ver>` into a temp dir, extract `tar -xzf`, locate the `plugin.yaml`/`plugin.json` at package root, copy to cache dir. Reject if `postinstall`/`preinstall`/`install` lifecycle scripts are declared in `package.json` (security guard — no code execution at install time). Log the rejection reason clearly.

**Bundle (M4.12):** `.mcpb` and `.dxt` are zip archives (per the Claude Code ecosystem convention). Unzip into cache dir. Bundle must contain a top-level `plugin.yaml` or `plugin.json`. SHA-256 of the bundle is recorded in the cache metadata for integrity (not signature verification — just change detection).

All three installers dispatch through `install/dispatch.ts` and produce a `LoadedPlugin` with `source: 'installed'` (same shape as local installs today — no source-type leak beyond the installer).

### 5.3 Dependency closure (M4.5)

```ts
export type DepClosure = {
  order: string[]                  // topological install order
  cycles: string[][]               // any detected cycles
  missing: Array<{ name: string; declaredBy: string[] }>  // declared but not resolvable
}
export async function resolveDepClosure(
  root: PluginManifest,
  resolve: (name: string) => Promise<PluginManifest | null>,
): Promise<DepClosure>
```

- DFS with visited set; re-encountering an in-progress node → cycle detected, recorded, traversal short-circuits for that path.
- Missing deps don't abort — they're reported; `install` prompts the user to proceed without them or abort.
- Load-time: if a required dep (marked via `dependencies[].required: true`) is missing, the plugin is skipped with a warning (matches Nuka-Code's `verifyAndDemote`).

Manifest schema extension:
```ts
dependencies?: Array<{
  name: string
  version?: string       // semver range, optional
  required?: boolean     // default true
}>
```

### 5.4 Agents swarm (M5.1) — **the headline feature**

This is the largest single feature in Phase 5. It is broken into seven sub-items executed sequentially by the M5-agents workstream subagent.

#### 5.4.1 Manifest schema

```ts
agents?: Array<{
  name: string                      // unique within plugin
  description: string               // shown to main agent in dispatch_agent tool description
  model?: string                    // default: inherit main agent's model
  systemPrompt?: string             // inline
  systemPromptPath?: string         // path relative to plugin dir (markdown file)
  // exactly one of systemPrompt / systemPromptPath
  allowedTools?: string[]           // whitelist; if absent, inherits main's tools
  deniedTools?: string[]            // blacklist; applied after allowedTools
  keywords?: string[]               // router hints (non-auto-invoke)
  maxTurns?: number                 // default 20
  maxTokens?: number                // default: model's max
  temperature?: number              // default: inherit
}>
```

The `name` is namespaced on load as `<plugin>:<agent>` to avoid collisions (mirrors slash-command namespacing).

#### 5.4.2 Agent loader

On plugin wire, read each agent definition, resolve the system prompt (inline or from disk), register with `AgentRegistry`. Fails loudly on: missing system prompt file, both inline + path specified, tool in `allowedTools` that doesn't exist at load time (warn and continue — tool may be registered later by MCP).

#### 5.4.3 Dispatch tool

A single built-in tool `dispatch_agent` is registered in the main tool registry when any agent exists:

```ts
// tool parameters:
{
  agent: string       // <plugin>:<agent> name
  task: string        // the task description — becomes the sub-session's first user message
  context?: string    // optional additional context appended to the task
}
```

The tool's description enumerates available agents dynamically: "Dispatch a task to one of the following specialist agents: <plugin>:<agent> — <description>; …".

`dispatch_agent.run`:
1. Resolve the agent definition; error if not found.
2. Build a filtered tool registry per `allowedTools`/`deniedTools`.
3. Create a fresh `Session` with the agent's system prompt + the first user message `task` (plus `context` if present). **The sub-session does NOT see the main session's message history.**
4. Run `runAgent` loop with a bound turn limit (`maxTurns`, default 20).
5. Collect all `tool_result` events + the final assistant message, serialize as text (or `ContentBlock[]` if any tool produced non-text), return as the dispatch tool's result.
6. Accumulate sub-session usage into the main session's `totalUsage` under a new `session.subSessionUsage` (breakdown by agent name).

#### 5.4.4 Parallel dispatch

Main agent can call `dispatch_agent` multiple times in one turn. Since `dispatch_agent` is a readOnly-from-main-agent's-perspective operation, 4b.M2.7's parallel path handles it automatically — multiple dispatches run concurrently up to the existing cap of 4.

Annotations on `dispatch_agent`:
```ts
annotations: {
  readOnly: true,      // safe to parallelize
  destructive: false,
  openWorld: true,     // may call tools that hit the network
}
```

#### 5.4.5 Router (keyword suggestion)

When the main agent's first user message contains a keyword declared by any agent, the `dispatch_agent` tool's description *appends* a suggestion line: "Hint: user message contains keyword '<kw>' — consider `<plugin>:<agent>`." This is advisory; the model still chooses whether to invoke. **No automatic dispatch.**

#### 5.4.6 Recursion guard

A sub-agent's session context sets `session.allowedAgentDispatch = false`. The `dispatch_agent` tool refuses to run when this flag is set, returning "Sub-agents cannot dispatch further sub-agents." This prevents unbounded recursion and keeps the graph a simple main → leaf tree.

#### 5.4.7 TUI rendering

`AgentCall.tsx` wraps a sub-session's streamed output with:
- Indented block (2 spaces).
- Top-right badge: `[<agent-name>]`.
- Collapsed by default once the sub-session returns; user toggles with `Ctrl+A` (expansion). Expansion shows the sub-session's tool calls and final message.
- The final result text is inlined back into the main transcript at the `tool_result` position, with a subtle "(from `<agent>`)" trailer.

### 5.5 outputStyles (M5.2)

Plugins declare:
```ts
outputStyles?: Array<{
  name: string
  matchToolName?: string            // glob; e.g., "mcp__github__*"
  matchToolSource?: 'mcp' | 'plugin' | 'skill' | 'builtin'
  componentPath: string             // JS module exporting default React component
}>
```

On render of a `tool_result`, `MessageRow` looks up matching styles (first match wins) and renders the custom component in place of the default. The component signature is:
```ts
type OutputStyleProps = {
  toolName: string
  input: unknown
  output: string | ContentBlock[]
  isError: boolean
}
export default function MyStyle(props: OutputStyleProps): JSX.Element
```

If the component throws, render falls back to the default and logs a warning (no user-facing crash).

### 5.6 channels (M5.3)

```ts
channels?: Array<{
  name: string
  allowlist: Array<'tool_result' | 'turn_end' | 'error' | 'plugin_*'>   // event types
  dispatch: {
    type: 'webhook' | 'command'
    url?: string                    // for webhook
    command?: string                // for command
  }
}>
```

On each matching agent event, the channel's dispatch fires asynchronously (non-blocking). Webhook = HTTP POST with JSON body (event type + payload). Command = spawn the command with JSON payload on stdin (mirrors 4a.M3.2 hook runner). Failures are logged but never interrupt the agent loop. Timeout 10s.

Allowlist is strict: events not listed are dropped. `plugin_*` covers plugin-scoped events (install/uninstall/enable/disable).

### 5.7 Config scope cascade (M5.5)

Four scopes in merge order (lowest wins — user overrides defaults, enterprise overrides user for locked fields):
```
enterprise  ← /etc/nuka/config.yaml          (lockable fields)
user        ← ~/.nuka/config.yaml            (current location)
project     ← .nuka/config.yaml              (in cwd or any ancestor)
local       ← .nuka/config.local.yaml        (gitignored by convention)
```

`loadConfig()` reads each existing file, validates each independently against `AppConfigSchema`, deep-merges (later scopes override earlier, except "locked" enterprise fields). Schema additions:
```ts
// in enterprise scope only:
locked?: string[]   // e.g., ["providers.openai.apiKey"] — later scopes cannot override these
```

`nuka config show --scope <name>` prints per-scope contribution; `nuka config show` prints the effective merged config with source annotations.

## 6. Phased delivery

**Four parallel worktrees** — 3 would undersize the agents stream which is by itself larger than any 4a/4b workstream:

| Mega | Domain | Worktree | Items | Rough effort |
|---|---|---|---|---|
| M4-install | marketplace + all installers + deps + version cache + bundles | `wt-phase5-install` | 7 (M4.1–M4.6, M4.12) | Large |
| M4-ops | auto-update + blocklist + validate + `/plugin` TUI + options | `wt-phase5-ops` | 5 (M4.7–M4.11) | Medium |
| M5-agents | agents swarm (7 sub-items) | `wt-phase5-agents` | 1 mega-feature | Largest |
| M5-platform | outputStyles + channels + config scope | `wt-phase5-platform` | 3 (M5.2, M5.3, M5.5) | Medium |

**Merge order (to minimize conflicts):**

1. **M4-install** — foundation. Adds marketplace + installers + deps. Other streams don't touch these files heavily.
2. **M5-agents** — foundation for platform features. Registers built-in `dispatch_agent` tool and new `src/core/agents/` tree. Touches `manifest.ts` (adds `agents?`) and `agent/loop.ts` (dispatch tool wiring).
3. **M5-platform** — adds `manifest.outputStyles`, `manifest.channels`, and config scope. `manifest.ts` additions are additive; scope cascade rewrites `loadConfig` with backward compat.
4. **M4-ops** last — depends on M4-install (marketplace context) and M5-platform (scope-aware config for autoupdate intervals).

Within each mega, tasks run sequentially via `superpowers:subagent-driven-development`.

## 7. Acceptance

Phase 5 complete when:
- All 16 scheduled items landed on `main` with commit SHAs recorded in the Gap Closure appendix.
- `npm test` ≥ **600 passing** (518 baseline + ~85 new).
- `npm run typecheck` clean.
- `npm run build` — `dist/cli.js` ≤ **250 KB** target, ≤ 300 KB hard ceiling. Agents + marketplace + scope cascade will push size meaningfully; 250 KB is aspirational, 300 KB is a fail gate.
- Hands-on demo works: `nuka plugin install official:prettier` succeeds; `dispatch_agent(agent: 'example:reviewer', task: 'review src/foo.ts')` returns a structured review.

## 8. Out of scope (Phase 6+)

- **LSP integration (5.M5.4)** — standalone phase.
- Marketplace signature verification / package signing.
- Plugin JS sandboxing.
- Recursive agent dispatch (sub-agents spawning sub-agents).
- Remote agent execution.
- Strict-mode API schemas.
- `--plugin-dir` dynamic discovery (already in 4b).
