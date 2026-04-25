# Nuka Phase 7 — Onboarding & Quality-of-Life Design

**Status:** active. Successor to Phase 6 (LSP). Baseline: `main` HEAD `7baa69f`, 849 tests passing, `dist/cli.js` 237 KB.

**Reference codebase:** `/data/xtzhang/Nuka-Code` — survey indexed in agent transcript on 2026-04-25.

---

## 1. Why Phase 7

User-facing pain points after Phase 6:

1. First-run friction — `nuka` exits with a hard error when no provider is configured. Should boot like `claude` and walk the user through provider selection.
2. No cost visibility — users can't see tokens/$ used per session or per model.
3. No long-term memory consolidation — every session starts cold; learnings don't persist across sessions.
4. Power-user input ergonomics — multi-line edits in the prompt box are painful without modal editing.
5. No status-bar HUD — context-window % and live token counts are hidden until the session is over.
6. No Chinese docs.

Nuka-Code solves all of these. Phase 7 ports the agent-CLI–relevant subset; we skip platform-specific (voice, buddy sprites, upstream proxy, remote control gateway) for plugin-first scope.

## 2. Goals

| ID | Goal | Source |
|---|---|---|
| **7.1** | **Guided onboarding** — first-run wizard for provider + API key + default model. Ships with Anthropic + OpenAI built-in, extensible per-provider. | New (user ask) |
| **7.2** | **Offline-mode startup** — `nuka` launches into TUI even with no providers; emits a banner; `/config` and `/model` open the wizard inline. | New (user ask, partially landed in pre-phase fix) |
| **7.3** | **Cost tracker + `/cost`** — per-session and lifetime token & USD totals; cache-create / cache-read separated; persisted under `~/.nuka/cost.json`; status HUD pulls from this. | Nuka-Code `cost-tracker.ts` |
| **7.4** | **Auto-memory consolidation** — at session end (or `/memdir compact`), summarize the transcript into a structured `MEMORY.md` under `~/.nuka/memory/<project>/`; load relevant entries into next session's system prompt. | Nuka-Code `memdir/`, `services/autoDream/` |
| **7.5** | **Vim-mode input** — modal editing for the prompt box (normal/insert/visual), motions (h/j/k/l/w/b/0/$/G), operators (d/c/y), text-objects (iw/i"/i(), dot-repeat. Toggle via `/vim` slash. | Nuka-Code `vim/` |
| **7.6** | **Status HUD** — bottom status line with: context-window %, tokens this turn, total cost, active provider/model, plugin count. Replaces today's plain footer. | Nuka-Code `commands/status-hub/` |
| **7.7** | **README — Chinese version** — `README.zh-CN.md`, mirrors English README structure. | User ask |

## 3. Non-goals

- Voice input / TTS.
- Buddy / sprite mascot.
- Upstream MITM proxy for sandboxed egress.
- Remote control gateway (Telegram/Feishu).
- Coordinator-mode as a separate concept — Nuka already has agent dispatch from Phase 5; HUD will surface in-flight agents.
- Plan-mode and Rewind — deferred to Phase 8.

## 4. Module layout

### Existing modules touched
- `src/cli.tsx` — already lifted the no-provider gate (commit `core.23541` style); needs to launch onboarding when `--init` or when user runs `/config` from offline mode.
- `src/tui/App.tsx` — wire status HUD; vim-mode prop.
- `src/tui/PromptInput.tsx` (or equivalent) — accept a vim controller.
- `src/slash/config.ts`, `src/slash/model.ts` — when called offline, hand off to the onboarding flow.
- `src/core/agent/loop.ts` — emit `usage` events into cost tracker after every assistant message.
- `src/core/compact/auto.ts` — at session-end / autoCompact, fire a memdir-write side-effect (async, non-blocking).

### New modules
- `src/core/onboarding/` — `wizard.ts` (state machine), `templates.ts` (provider templates: anthropic/openai), `providerProbe.ts` (verify API key with a minimal request).
- `src/tui/Onboarding/` — Ink components for provider list / API-key input / model select / completion screen.
- `src/core/cost/` — `tracker.ts` (Map<model, {input,output,cacheCreate,cacheRead}>; USD math), `persist.ts` (`~/.nuka/cost.json`), `pricing.ts` (per-model rates table — Anthropic + OpenAI seed).
- `src/core/memdir/` — `parser.ts` (frontmatter + body), `index.ts` (load all entries), `synth.ts` (LLM call to summarize transcript), `relevance.ts` (keyword/embedding-free scoring).
- `src/core/vim/` — `mode.ts` (normal/insert/visual), `motions.ts`, `operators.ts`, `textObjects.ts`, `controller.ts` (binds keys to ops over a buffer model).
- `src/tui/Status/` — `Hud.tsx`, `useUsage.ts`.
- `src/slash/cost.ts`, `src/slash/memdir.ts`, `src/slash/vim.ts`.

## 5. Design decisions

### 5.1 Guided onboarding

Single-track wizard (no branching beyond the provider selection):

```
[Welcome to Nuka] → [Choose provider] → [Enter API key] → [Pick default model] → [Verify] → [Save & continue]
```

State machine:
```ts
type WizardState =
  | { kind: 'welcome' }
  | { kind: 'pickProvider'; choices: ProviderTemplate[] }
  | { kind: 'apiKey'; provider: ProviderTemplate; key: string }
  | { kind: 'pickModel'; provider: ProviderTemplate; key: string; models: string[]; selected?: string }
  | { kind: 'verifying'; provider: ProviderTemplate; key: string; model: string }
  | { kind: 'done'; config: ConfigPatch }
  | { kind: 'error'; message: string; retryFrom: WizardState['kind'] }
```

`ProviderTemplate`:
```ts
{ id: 'anthropic'|'openai'|...; type: string; defaultModel: string; defaultModels: string[];
  apiKeyEnvVar?: string; helpUrl: string;
  probe: (key: string) => Promise<{ ok: true; models?: string[] } | { ok: false; reason: string }>; }
```

On launch:
1. If `argv[0] === 'init'` OR no providers configured AND user types `/config` from offline TUI: render wizard.
2. On success, write `~/.nuka/config.yaml` (preserve existing fields), reload config, hot-swap into the live `ProviderResolver`.

Probe: `/v1/models` for OpenAI; for Anthropic, a 1-token `messages.create` with `max_tokens: 1` and `model: claude-haiku`. Cheap enough to not bill meaningfully; surfaces auth errors immediately.

### 5.2 Cost tracker

Hooks into `agent/loop.ts` after each assistant turn, reading `usage` from the provider response. Storage:
```ts
type CostEntry = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  ts: number              // unix ms
  sessionId: string
}
```
- In-memory aggregate per session.
- Flush to `~/.nuka/cost.json` every 30 seconds and on session end.
- Pricing table: hard-coded `pricing.ts` mapping `model → {input, output, cacheCreate, cacheRead}` USD per million tokens. Unknown model → reports tokens only, no USD.

`/cost` slash output:
```
This session    in: 12,432   out: 4,210    cache: 3.1k/0.6k    $0.0721
Today           in: 84,221   out: 28,103   cache: 18k/9k       $0.5142
All-time        in: 1.2M     out: 410k     cache: 240k/120k    $7.81
```

### 5.3 Auto-memory consolidation

`MEMORY.md` lives at `~/.nuka/memory/<sha1(cwd)>/MEMORY.md`. Each entry is a frontmatter-fenced block:
```markdown
---
ts: 2026-04-25T11:30:00Z
sessionId: abc-123
keywords: [auth, bcrypt, login flow]
score: 0.7
---

User cares about constant-time bcrypt comparison in src/auth/login.ts.
Avoid string-equality on hashed passwords.
```

**Synth trigger**: at session-end (SIGINT, `/exit`, autoCompact firing). Spawns a non-blocking task:
1. Take last N=20 turns + system summary.
2. Call provider with a fixed prompt: "extract durable facts the next session should know — user preferences, project conventions, gotchas. Ignore one-off task details. Return YAML frontmatter + 1-paragraph body, ≤200 chars body."
3. Parse YAML; append to `MEMORY.md`.

**Load on next session**: in `systemPromptInput`, call `findRelevantMemories(cwd, recentInput)` — keyword-match scoring (TF-IDF over keywords field), top 5 entries, capped 1 KB. Prepended to system prompt under `## Memory` heading.

`/memdir list` / `/memdir clear` / `/memdir compact` slash commands.

### 5.4 Vim mode

A controller layered over the existing input box. Three modes:

| Mode | Cursor | Keys |
|---|---|---|
| insert (default) | between chars | typing inserts; `Esc` → normal |
| normal | over a char | `h j k l w b 0 $ g G`; `i a o O`; `d c y p`; `x s`; `.` |
| visual | range | `v V`; same operators |

Operator + motion = action. Implement only the universally-used subset; bail to terminal on unknown keys (don't try to re-implement vim-script).

Ops: `d c y` × motions (`w b 0 $` and text-objects `iw i" i(`), plus the simple `dd cc yy`. `p` pastes from a single-slot register. `.` repeats last op.

Toggle via `/vim on|off|toggle`. Persist to `config.vim.enabled` (user scope).

### 5.5 Status HUD

Replace the bottom footer line. Format (Ink JSX `<Box flexDirection="row" justifyContent="space-between">`):

```
[anthropic/claude-opus-4-7]  ctx 12.4% (24.8k/200k)   ▲in 1.2k ▼out 0.4k   $0.0721   plugins 3 · agents 2 in-flight   git:main
```

Pulls from:
- Active session for provider/model.
- `costTracker.currentSession()` for tokens/USD.
- `loop.contextLength()` for ctx%.
- `agentRegistry.inFlight()` for agent count.
- `currentGitBranch(cwd)` for branch.

Re-renders on each agent event; debounced to 60 fps max.

### 5.6 Failure modes

- Onboarding probe fails → show error with help URL + offer retry/back.
- Cost tracker pricing miss → show tokens only, no USD; log a one-time stderr warning.
- Memdir synth fails → drop silently; don't degrade session-exit UX.
- Vim mode unknown key → fall through to default insert behavior.
- HUD render failure → fall back to plain footer (try/catch in component).

## 6. Acceptance

Phase 7 complete when:
- `npm test` — ≥ 920 passing (849 baseline + ~70 new).
- `npm run typecheck` clean.
- `npm run build` — `dist/cli.js` ≤ 320 KB hard ceiling (260 KB target).
- A fresh `~/.nuka` (no config) → `nuka init` walks user through wizard → first prompt works.
- `/cost` reports tokens & USD; persists across sessions.
- `/memdir list` shows entries; new session loads relevant memory into system prompt.
- `/vim on` enables modal editing in the prompt box.
- HUD visible at bottom of every TUI session.
- `README.zh-CN.md` exists and mirrors English structure.

## 7. Out of scope (Phase 8+)

- Plan mode / Rewind checkpoints.
- Coordinator dashboards / multi-team UI.
- Voice input.
- Remote control gateway.
- Buddy mascot.
- LSP completions / hover / code actions (defer indefinitely).
- Pricing auto-fetch from provider APIs.
- Embedding-based memdir relevance.
