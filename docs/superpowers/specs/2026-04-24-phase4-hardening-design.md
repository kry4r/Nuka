# Nuka Phase 4 — Hardening & Extension Design Spec

**Status:** active. Expansion of §7 (Future Work) of `2026-04-23-nuka-rewrite-design.md`. Directly addresses the 11 unintended gaps and 17 deferred items catalogued in `docs/superpowers/reviews/2026-04-24-phase3-vs-nuka-code.md`.

**Reference:** `/data/xtzhang/Nuka-Code` is the shape guide, not a blueprint. Keep Nuka minimal — only the features on this page.

---

## 1. Goals

1. **Close correctness gaps** — MCP responses won't blow the context window; hung servers can't freeze the agent loop; invalid tool inputs fail loud; `resource_link` blocks return actual content; images survive as references.
2. **Extend the tool model** — `ToolResult.output` accepts structured content; MCP tool annotations (`readOnlyHint` / `destructiveHint` / `openWorldHint`) reach the `Tool` interface; users see human-friendly tool names.
3. **Deepen the plugin system** — users can enable/disable plugins, install from git + marketplaces, resolve inter-plugin dependencies, and plugins can contribute hooks that fire at agent lifecycle events.
4. **Expand the MCP surface** — add `sse` transport, auto-reconnect on disconnect, and elicitation (interactive parameter prompts) via the existing permission bridge.

## 2. Non-goals

Deferred again (Phase 5+):
- OAuth 2.0 / PKCE / XAA / SEP-990 — enterprise auth not on roadmap yet.
- Chrome / Computer Use / SDK / SSE-IDE / WS-IDE transports — IDE-specific.
- Image resize + downsample — persist path only; model converts with a follow-up tool call.
- Native single-binary distribution.
- Plugin sandboxing.
- Marketplace signature verification (install-time; deferred behind a policy toggle).

## 3. Risks addressed (mapping to review unintended gaps)

| Review gap | Addressed by |
|---|---|
| #1 Unbounded MCP result size | M1.1 result truncation |
| #2 No connect/request timeout | M1.2 timeouts |
| #3 Tool input unvalidated | M2.1 input validation |
| #4 `resource_link` dropped | M1.5 auto-fetch |
| #5 Image blobs unusable | M2.3 image persistence |
| #6 Tool/server description unbounded | M1.3 desc truncation |
| #7 Plugin enable/disable absent | M3.1 enable list |
| #8 Tool output type erased | M2.2 result type widening |
| #9 `userFacingName` absent | M2.5 display formatter |
| #10 YAML-only convention | documented in plan §conventions; no code change |
| #11 `ListRoots` handler absent | M1.4 roots handler |

Review deferrals are all covered across M1–M3.

## 4. Module layout

### Existing modules modified
- `src/core/mcp/{client,toolAdapter,types}.ts`
- `src/core/agent/{loop,events}.ts`
- `src/core/tools/{types,registry}.ts`
- `src/core/plugin/{loader,wire,install,manifest}.ts`
- `src/core/permission/bridge.ts`
- `src/core/config/schema.ts`
- `src/core/provider/{anthropic,openai}.ts`
- `src/tui/Messages/{ToolCall,MessageRow}.tsx`

### New modules
- `src/core/mcp/elicitation.ts` — elicitation handler (form + URL modes).
- `src/core/mcp/reconnect.ts` — reconnect policy (exponential backoff, max attempts).
- `src/core/mcp/truncate.ts` — content truncation helpers.
- `src/core/tools/validate.ts` — JSON Schema validator front-end (Zod-based).
- `src/core/tools/content.ts` — `ContentBlock` union type used in tool results.
- `src/core/hooks/{types,loader,runner}.ts` — plugin hook subsystem.
- `src/core/plugin/marketplace.ts` — marketplace config + remote fetch.
- `src/core/plugin/deps.ts` — dependency graph resolution.
- `src/core/plugin/gitInstall.ts` — `git clone`-based installer.

## 5. Design decisions

### 5.1 Tool result type widening (M2.2)

Current:
```ts
type ToolResult = { output: string; isError: boolean }
```
Target:
```ts
import type { ContentBlock } from './content'

type ToolResult = {
  output: string | ContentBlock[]
  isError: boolean
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; path: string; mimeType: string }   // persisted-to-disk reference
  | { type: 'resource'; uri: string; mimeType?: string; text?: string }
```

Migration: existing tools keep `output: string`. Adapters detect string vs array at provider boundary. No `*.any` casts. Concrete impact: providers (`anthropic.ts`, `openai.ts`) must translate `ContentBlock[]` into their respective API shapes; fallback: join `text` + describe non-text blocks.

### 5.2 Input validation (M2.1)

Add a `Tool.validateInput?(input): { ok: true; value: I } | { ok: false; error: string }` method. Default implementation derives from `parameters` using Zod (converted from JSON Schema). Agent loop calls it before `tool.run`; on failure yields a synthetic `tool_result` with `isError: true` and the validation error, never entering `run`.

### 5.3 Annotations (M2.4)

Extend `Tool` interface:
```ts
interface Tool<I = unknown> {
  // ...existing fields
  annotations?: {
    readOnly?: boolean
    destructive?: boolean
    openWorld?: boolean
  }
}
```
`mcpToolsFor` reads `tool.annotations` from the MCP descriptor (MCP 2025-01 spec defines `readOnlyHint`/`destructiveHint`/`openWorldHint`) and carries them over. Agent loop can use `annotations.readOnly === true` to skip the permission prompt if the tool's own `needsPermission` is also `'none'` (defense-in-depth); not automatic trust-upgrade.

### 5.4 Reconnect (M1.7)

`McpClient.connect` now registers an `onclose` handler that:
1. Sets status `{ kind: 'error', error: 'disconnected' }`.
2. Invalidates tool / resource caches.
3. Lazily reconnects on next `callTool` / `readResource` call (exponential backoff: 1s, 2s, 4s, capped at 30s; 5 attempts max; after that stays in error state).

### 5.5 Elicitation (M1.8)

MCP servers can request runtime user input via the `elicitation/create` request. Nuka's handler routes through the `PermissionBridge` extended with an `elicit(payload): Promise<Result>` method. UI adds a dedicated `ElicitationDialog` (form fields + URL elicitation renders a link the user opens). Result shape matches `@modelcontextprotocol/sdk/types.js` `ElicitResult`.

### 5.6 Hooks (M3.2)

Plugins declare `hooks/hooks.json` with entries like:
```json
{
  "beforeToolCall": [{ "tool": "Bash", "command": "audit-log $INPUT" }],
  "afterTurn": [{ "script": "notify.sh" }]
}
```
Supported events (Phase 4 minimum):
- `beforeToolCall(toolName, input)` — can cancel by returning `{ cancel: true, reason }`
- `afterToolCall(toolName, result)` — side-effects only
- `afterTurn(session)` — cleanup
- `beforeAutoCompact(session)` — can veto

Hooks run as shell commands (plugin-declared) with the payload as JSON on stdin. Non-zero exit = cancel. Timeout: 10s each.

### 5.7 Marketplace (M3.3)

`~/.nuka/marketplaces.json`:
```json
{
  "sources": {
    "official": { "url": "https://plugins.nuka.dev/index.json" },
    "mine": { "git": "https://github.com/me/my-nuka-plugins.git" }
  }
}
```
`nuka plugin search <query>` lists matches from all sources. `nuka plugin install <marketplace>:<plugin>` resolves + installs. Git sources cloned shallow into `~/.nuka/cache/marketplaces/<name>/`. No signature verification yet.

### 5.8 Dependencies (M3.4)

`PluginManifestSchema` gains `dependencies?: string[]` — array of plugin names (from any marketplace). On install, resolve DFS; if a dep is missing, prompt to install. Circular deps rejected. At load time, unresolved deps produce a warning and plugin is skipped.

## 6. Phased delivery

Three mega-workstreams M1, M2, M3 that are **safe to run in parallel across git worktrees**. Within each workstream, tasks run sequentially via subagent-driven-development. See `2026-04-24-phase4-hardening-plan.md` for the task decomposition.

```
M1 (MCP client + protocol)  │━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
M2 (Tool semantics)          │━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
M3 (Plugin subsystem)        │━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
```

Merge order post-development: M2 first (enables M1 annotations + M3 hooks event types), then M1 + M3 together.

## 7. Acceptance

Phase 4 is complete when:
- All 11 unintended gaps from the review doc are closed (verify via re-reading the review and ticking each).
- `npm test` ≥ 320 passing (272 + ~50 new).
- `npm run typecheck` clean.
- `npm run build` — `dist/cli.js` ≤ 250 KB.
- Review doc updated with a "Gap Closure" appendix marking each originally-flagged item "closed in <commit>".

## 8. Out of scope (Phase 5+)

- OAuth 2.0 / PKCE / XAA / SEP-990
- IDE-specific transports (`sse-ide`, `ws-ide`)
- In-process SDK transport + Chrome/Computer Use
- Image resize / downsample
- Plugin sandboxing
- Marketplace signature verification
- Plugin auto-update
- Plugin blocklist + policy enforcement
- Native single-binary distribution
- Hooks with more event types (beforeTurn, onError, etc.)

These remain in §M of the rewrite plan's backlog.
