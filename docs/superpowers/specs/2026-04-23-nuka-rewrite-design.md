---
title: Nuka Rewrite — Design Spec
date: 2026-04-23
status: draft
scope: Phase 1–3 (Phase 4+ tracked as TODO)
---

# Nuka Rewrite — Design Spec

A ground-up rewrite of the terminal AI agent, inspired by but independent from the existing `/root/codes/Nuka-Code` fork. The goal is a clean, layered codebase that scales from a minimal usable agent (Phase 1) to an extensible platform with skills, MCP, and plugins (Phase 3), with discipline against the monolithic bloat of the reference project.

The product **brand is NUKA**, tagline **"Avocado Agent"**, accent color **avocado green** (`#A3BE8C`).

---

## 1. Goals and Non-Goals

### Goals

- **Clean layered architecture.** `core/` is pure logic (no Ink, no React); `tui/` is the renderer; they meet at a defined event contract. Everything testable headlessly.
- **Two LLM providers from day one**, unified behind a single interface: Anthropic SDK and OpenAI SDK. All provider details and models are **user-configured**, not hardcoded.
- **Phase-by-phase shippable.** Each phase ends with a runnable product. No dead half-finished features between phases.
- **Extensible by construction.** The Tool / Provider / SlashCommand contracts are stable from Phase 1 so that Phase 2 (skills) and Phase 3 (MCP, plugins) slot in without rewrites.
- **Modern, minimal TUI.** Bottom-fixed input. Avocado-green accent. Rotating playful welcome tips. Two-line status bar with context, cost, and mode.

### Non-Goals

- Feature parity with the reference project. Anything not explicitly listed is deferred.
- Supporting every LLM provider. Two SDKs cover the practical landscape (OpenAI-compatible covers ~all commercial Chinese models plus local runtimes).
- Replacing editor integration, remote control, IDE plugins, or telemetry pipelines in the first three phases.

---

## 2. Architecture Overview

### 2.1 Module layout

```
               ┌──────────────────────────────────────┐
               │                 tui/                 │
               │   App · PromptInput · Messages       │
               │   Logo · Dialogs · StatusBar         │
               └───────────────┬──────────────────────┘
                               │  subscribe events
                               │  invoke callbacks (permission, etc.)
                               ▼
               ┌──────────────────────────────────────┐
               │                core/                 │
               │   agent · provider · tools · session │
               │   permission · config · message      │
               └──────────────────────────────────────┘
```

**Hard rule:** nothing in `core/` may import anything from `tui/`, `ink`, or `react`. Violations are caught by a lint rule.

### 2.2 Module responsibilities

| Module | Responsibility | Key exports |
|---|---|---|
| `core/agent` | Tool-use loop, queue flush, cancellation, system prompt assembly | `runAgent()`, `AgentEvent` |
| `core/provider` | Abstract LLM call; normalize streams into unified events | `LLMProvider`, `AnthropicProvider`, `OpenAIProvider`, `ProviderResolver` |
| `core/tools` | Tool contract; built-in tools; registry that merges builtin + skill + MCP + plugin tools | `Tool`, `ToolRegistry` |
| `core/session` | Session state, branching, queue, manager | `Session`, `SessionManager`, `MessageQueue` |
| `core/permission` | Permission decision: cache lookup + UI callback; glob rules | `PermissionChecker` |
| `core/config` | Layered config loader (global + project + env) | `loadConfig()`, `Config` |
| `core/message` | Internal message format + translation to/from SDK formats | `Message`, `ContentBlock`, `normalize*` |
| `tui/*` | Ink components, theme, hooks | React components |
| `slash/*` | Slash command registry and implementations | `SlashCommand`, `commandRegistry` |

### 2.3 Core data types

**`Message`** — internal normalized format. Neither SDK's shape is stored directly; providers translate on the boundary.

```ts
type Message =
  | { role: 'user';      content: ContentBlock[]; id: string; ts: number }
  | { role: 'assistant'; content: ContentBlock[]; id: string; ts: number; usage?: TokenUsage }
  | { role: 'tool';      toolUseId: string; content: string; isError: boolean; id: string; ts: number }
  | { role: 'system';    content: string }   // internal scaffolding only

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  // future: image, thinking
```

**`AgentEvent`** — what the agent loop yields to the UI.

```ts
type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'turn_end'; usage: TokenUsage; stopReason: StopReason }
  | { type: 'queued_message_flushed'; count: number }
  | { type: 'error'; error: Error }
```

**`Tool`** — one interface for built-in, skill, MCP, and plugin tools.

```ts
interface Tool<I = unknown, O = unknown> {
  name: string
  description: string
  schema: JSONSchema                                     // parameter schema for provider
  source: 'builtin' | 'skill' | 'mcp' | 'plugin'
  needsPermission: (input: I) => PermissionHint          // 'none' | 'write' | 'exec' | 'network'
  run: (input: I, ctx: ToolContext) => Promise<ToolResult<O>>
}
```

### 2.4 Agent loop

```ts
async function* runAgent(input, session, deps, signal): AsyncIterable<AgentEvent> {
  session.messages.push(makeUserMessage(input))

  while (!signal.aborted) {
    const { provider, model } = deps.provider.resolveFor(session)
    const stream = provider.stream({
      model,
      system: buildSystemPrompt(session),
      messages: session.messages,
      tools: deps.tools.listSpecs(session),
    }, signal)

    const assistant = emptyAssistant()
    for await (const ev of stream) {
      yield translate(ev)
      applyToAssistant(assistant, ev)
    }
    session.messages.push(assistant)

    const toolCalls = extractToolCalls(assistant)
    if (toolCalls.length === 0) {
      yield { type: 'turn_end', ... }
      break
    }

    for (const call of toolCalls) {
      const tool = deps.tools.find(call.name)
      const decision = await deps.permission.check(call, tool)   // UI callback
      const result = decision.allowed
        ? await tool.run(call.input, { signal, session })
        : { isError: true, output: `Rejected: ${decision.reason ?? 'user denied'}` }
      session.messages.push(makeToolMessage(call.id, result))
      yield { type: 'tool_result', ... }
    }

    const queued = session.queue.drain()
    if (queued.length > 0) {
      session.messages.push(makeUserMessage({ text: queued.join('\n\n') }))
      yield { type: 'queued_message_flushed', count: queued.length }
    }
  }
}
```

Loop invariants:
- `runAgent` is an async generator. The UI consumes via `for await … of` and setStates.
- One `AbortSignal` threads through provider fetch, tool execution, and sub-child processes.
- `permission.check` returns a Promise; the loop awaits UI decisions without blocking the render thread.
- No hard iteration cap. The only pathological case (infinite tool-use) is interrupted by `esc`.
- `/btw` messages never interrupt a turn; they flush at turn boundaries.

### 2.5 Cross-cutting concerns

- **Error handling.** `ProviderError` (categorized: network / auth / rate limit / server) bubbles up and is rendered as a system message, never crashes the UI. `ToolError` is returned as a tool message with `isError=true`; the model sees it and decides whether to retry.
- **Cost statistics.** `usage` rides on `turn_end`. `core/session/telemetry.ts` accumulates. Pricing table is **user-defined** in config (one rate block per model id). `/cost` renders the pretty breakdown.
- **Cancellation.** `esc` aborts; double-`esc` quits. Abort is cooperative through `AbortSignal`; Bash tool kills the process tree.
- **Testing.** `core/` is all pure-function or DI-injected; vitest covers it. Providers use MSW to mock HTTP. Tools use tmpdir fixtures. TUI uses `ink-testing-library`.

---

## 3. TUI Design

### 3.1 Welcome screen

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│    ⣶⣄⡀          ⢀⣴                                                   │
│   ⣿⣿⣻⣷⣦⡀      ⣾⣿     NUKA  ·  v0.1.0                                 │
│   ⣿⣾ ⠙⢾⣿⡄    ⣿⣷      Avocado Agent                                  │
│   ⣿⣿   ⢸⣷⡇    ⣿⣽                                                     │
│   ⣿⣾   ⢸⣷⡇    ⣿⣻      cwd   /root/codes/Nuka                         │
│   ⠘⣿⣵⣄⠸⣷⣇⢀⣠⣾⣿⠋        git   main · clean                             │
│     ⠈⠙⠽⢧⡹⠾⡿⠻⠓⠁         model claude-sonnet-4-6                       │
│                                                                      │
│  ✦  Which bug are we slicing today?                                  │
│                                                                      │
│    Type  /  for commands,  ?  for help,  esc  to cancel.             │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ ▎                                                                    │
│ ▎ >                                                                  │
│ ▎                                                                    │
├──────────────────────────────────────────────────────────────────────┤
│  ⬢ sonnet-4-6   ·   ~/Nuka   ·   main   ·   0/200k   ·   $0.00       │
│  ✓ no mcp       ·   auto: off   ·   ? shortcuts            ⏎ send    │
└──────────────────────────────────────────────────────────────────────┘
```

- Logo in avocado-green (braille art carried over from the reference project).
- Info block on the right: brand, version, tagline, cwd, git branch + dirty state, active model.
- One rotating playful tip line with `✦` marker.
- Single hint line pointing to `/`, `?`, `esc`.

### 3.2 Welcome tips pool (English)

Rendered once per session start (and on `/new`). User-extensible via `config.welcome.tips`. Defaults:

```
Which bug are we slicing today?
Keyboard ready. Feed me a task.
Coffee. Code. Avocado.
Refactor o'clock. Deep breath.
I won't write tests, but I'll nag you to.
Saving is brave. Committing is braver.
Past-you left a TODO. Want to see it?
Build or break today? Either works.
```

### 3.3 In-conversation layout

- Each message row has a leading speaker accent bar `▎` plus a content continuation bar `│`.
- Speaker colors: `you` — soft gray, `nuka` — avocado-green, `system` — muted yellow.
- Tool calls render as `⏺ <tool> <arg-summary> <duration> <status-icon>`. Status icons: `✓` success / `✗` error / `…` running.
- Markdown rendered via `marked` + custom renderer that outputs chalk-colored strings; code blocks via `cli-highlight`.

### 3.4 Permission dialog

Four-option prompt on write / exec tool calls:

1. Yes, once
2. Yes, always for this permission class in this session (e.g. all writes)
3. Yes, always for a pattern (glob auto-suggested from the call)
4. No, with optional free-text reason

The input is locked while the dialog is up. `↑↓` selects; `⏎` confirms; `esc` rejects.

### 3.5 Status bar (two lines)

```
  ⬢ sonnet-4-6   ·   ~/Nuka   ·   main*   ·   14k/200k   ·   $0.28
  ● 3 mcp        ·   auto: on(2)  ·   ⏳ 2 queued                esc×2
```

| Segment | Content | Notes |
|---|---|---|
| L1 model | `⬢ <short-id>` | Keystroke opens `/model` picker |
| L1 cwd | Home-folded, mid-ellipsis on long paths | |
| L1 git | Branch + `*` on dirty; warm yellow when dirty | |
| L1 ctx | `<used>/<max>` tokens; > 80% yellow, > 95% red | |
| L1 cost | Running dollar total | Click → `/cost` |
| L2 mcp | `● N mcp` with color by health | Phase 3 activates |
| L2 mode | `auto: off / on(N)` / `plan` / `bypass` | |
| L2 queue | `⏳ N queued` (hidden when zero) | `/btw` queue depth |
| L2 hint | Right-aligned dynamic hint | Idle → `? shortcuts`; running → `esc cancel`; primed-quit → `esc×2` |

Compact mode (< 100 cols): fold to one line, hide MCP and queue segments.

### 3.6 Theme palette

Central in `tui/theme.ts`; overridable from config.

| Token | Hex | Used for |
|---|---|---|
| `primary` | `#A3BE8C` | Logo, NUKA text, input bar, footer separators |
| `accent` | `#6E8759` | Speaker name, tool call bullets |
| `fg` | `#D8DEE9` | Body text |
| `muted` | `#4C566A` | Hints, timestamps, meta |
| `warn` | `#EBCB8B` | Dirty git, permission dialog border, dangerous hints |
| `error` | `#BF616A` | Errors, failed tool `✗` |

---

## 4. Phase 1 — Usable Skeleton

**Goal:** `nuka` runs, connects to user-configured Anthropic or OpenAI-compatible model, edits files, runs commands, tracks cost, supports the core slash commands.

### 4.1 Directory layout at Phase 1 completion

```
nuka/
├── package.json                  # bin: "nuka" → dist/cli.js
├── tsconfig.json
├── scripts/build.mjs             # esbuild to ESM single file
├── src/
│   ├── cli.tsx                   # entry: parse argv, load config, mount <App/>
│   │
│   ├── core/
│   │   ├── agent/
│   │   │   ├── loop.ts           # runAgent() async generator
│   │   │   ├── events.ts
│   │   │   └── systemPrompt.ts
│   │   ├── provider/
│   │   │   ├── types.ts          # LLMProvider interface
│   │   │   ├── anthropic.ts      # AnthropicProvider
│   │   │   ├── openai.ts         # OpenAIProvider
│   │   │   ├── resolver.ts       # maps model id → provider instance using config
│   │   │   └── pricing.ts        # reads user-defined rate table from config
│   │   ├── tools/
│   │   │   ├── types.ts
│   │   │   ├── registry.ts       # merges sources (Phase 1: builtin only)
│   │   │   ├── read.ts
│   │   │   ├── write.ts
│   │   │   ├── edit.ts
│   │   │   ├── bash.ts
│   │   │   ├── glob.ts
│   │   │   └── grep.ts
│   │   ├── session/
│   │   │   ├── session.ts
│   │   │   ├── manager.ts
│   │   │   ├── queue.ts          # /btw queue
│   │   │   └── telemetry.ts      # tokens, cost, git watcher
│   │   ├── permission/
│   │   │   ├── types.ts
│   │   │   ├── checker.ts
│   │   │   └── cache.ts
│   │   ├── config/
│   │   │   ├── schema.ts         # zod schema
│   │   │   ├── load.ts
│   │   │   └── paths.ts
│   │   ├── message/
│   │   │   ├── types.ts
│   │   │   └── normalize.ts
│   │   └── compact/
│   │       └── compact.ts        # real LLM-backed summarization
│   │
│   ├── tui/
│   │   ├── App.tsx
│   │   ├── theme.ts
│   │   ├── Welcome/
│   │   │   ├── Welcome.tsx
│   │   │   ├── Logo.tsx
│   │   │   └── tips.ts
│   │   ├── Messages/
│   │   │   ├── Messages.tsx
│   │   │   ├── MessageRow.tsx
│   │   │   ├── ToolCall.tsx
│   │   │   ├── Markdown.tsx
│   │   │   └── Diff.tsx
│   │   ├── PromptInput/
│   │   │   ├── PromptInput.tsx
│   │   │   ├── SlashSuggest.tsx
│   │   │   └── useInputHistory.ts
│   │   ├── StatusBar/
│   │   │   ├── StatusBar.tsx
│   │   │   ├── Segments.tsx
│   │   │   └── HintLine.tsx
│   │   ├── dialogs/
│   │   │   ├── PermissionDialog.tsx
│   │   │   ├── ModelPicker.tsx
│   │   │   └── ConfigEditor.tsx
│   │   └── hooks/
│   │       ├── useSession.ts
│   │       ├── useAgentStream.ts
│   │       └── useTerminalSize.ts
│   │
│   └── slash/
│       ├── types.ts
│       ├── registry.ts
│       ├── exit.ts
│       ├── help.ts
│       ├── clear.ts
│       ├── model.ts
│       ├── config.ts
│       ├── new.ts
│       ├── branch.ts
│       ├── btw.ts
│       ├── compact.ts
│       └── cost.ts
│
└── test/                         # vitest + ink-testing-library
    ├── provider/
    ├── tools/
    ├── agent/
    ├── permission/
    ├── compact/
    └── tui/
```

### 4.2 Provider layer (user-configured, Nuka-Code-style)

The shape mirrors `Nuka-Code`'s `InferenceProviderConfig` and two-level `/model` menu: the user declares **providers** (each with a format, baseUrl, apiKey, and a model list that may be fetched from the remote `/v1/models` endpoint). Each provider has a **`selectedModel`** persisted in config; the session's active model is `(providerId, selectedModel)`.

No hardcoded model map. No bundled model catalog. The user adds providers through `/model` (which doubles as provider config) or by editing `config.yaml`.

**Types:**

```ts
// core/provider/types.ts
export type ProviderFormat = 'anthropic' | 'openai'

export interface ProviderConfig {
  id: string                          // stable uuid
  name: string                        // user-friendly label, e.g. "Anthropic", "DeepSeek", "Ollama local"
  format: ProviderFormat              // which SDK handles this provider
  baseUrl: string                     // e.g. https://api.anthropic.com, http://localhost:11434/v1
  apiKey?: string                     // optional for local runtimes
  models?: string[]                   // list of model ids exposed by this provider
  selectedModel?: string              // per-provider pinned model id
  extraHeaders?: Record<string, string>
}

export interface ActiveSelection {
  providerId: string
  model: string                       // the current provider's selectedModel
}

export interface LLMProvider {
  readonly config: ProviderConfig
  stream(req: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
  listRemoteModels(): Promise<string[]>          // GET <baseUrl>/v1/models (or /models)
  countTokens?(messages: Message[]): Promise<number>
}

export interface LLMRequest {
  model: string
  messages: Message[]
  system: string
  tools: ToolSpec[]
  maxTokens?: number
  temperature?: number
}

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_args_delta'; id: string; delta: string }
  | { type: 'tool_use_stop'; id: string; input: unknown }
  | { type: 'message_stop'; stopReason: StopReason; usage: TokenUsage }
```

**`ProviderResolver`** — central routing built from `config.providers`:

```ts
class ProviderResolver {
  constructor(config: Config)                    // instantiates one LLMProvider per ProviderConfig
  resolveActive(): { provider: LLMProvider; model: string }    // uses config.active
  listProviders(): ProviderConfig[]              // for /model root menu
  listModels(providerId: string): string[]       // for /model sub-menu
  fetchRemoteModels(providerId: string): Promise<string[]>     // refresh models[] by calling /v1/models
  saveSelection(providerId: string, model: string): Promise<void>   // persists to global config
}
```

**Implementations:**

- `AnthropicProvider` — `@anthropic-ai/sdk` (or raw `fetch` when `baseUrl` is non-standard). Uses `messages.stream()`; translates `content_block_delta` / `content_block_stop` / `message_stop` into `ProviderEvent`. Tool-use JSON is streamed via `input_json_delta` and finalized on `content_block_stop`. `listRemoteModels()` calls `GET <baseUrl>/v1/models` with `x-api-key` + `anthropic-version: 2023-06-01`.
- `OpenAIProvider` — `openai` SDK with `baseURL` from config (covers OpenAI, DeepSeek, Moonshot, Zhipu, Qwen, Ollama, LiteLLM, OpenRouter, and any OpenAI-compatible endpoint). Translates `choices[0].delta` into the same `ProviderEvent` shape. Tool schemas wrap into `{type:'function', function:{...}}`. `listRemoteModels()` calls `GET <baseUrl>/models` (falls back to `/v1/models`) with `Authorization: Bearer <apiKey>`.

Both providers are thin SDK adapters. The agent loop consumes only `ProviderEvent`; it does not know which SDK produced them.

### 4.3 Configuration (user-defined everything)

Three sources, later overrides earlier:

1. Global: `~/.nuka/config.yaml`
2. Project: `<cwd>/.nuka/config.yaml`
3. Env: `NUKA_*`

**Schema (zod-validated) — `providers` is the source of truth for both provider instances and the model catalog:**

```yaml
# --- providers ---
# Each provider has its own model list (fetched from <baseUrl>/v1/models or
# manually maintained) and its own selectedModel. The two-level /model picker
# chooses a provider first, then a model within it. Pattern mirrors
# Nuka-Code's InferenceProviderConfig.
providers:
  - id: 01HWX9M2PSKJ3YN7ZP8BXV6GQA       # stable uuid; generated on add
    name: Anthropic
    format: anthropic
    baseUrl: https://api.anthropic.com
    apiKey: ${env:ANTHROPIC_API_KEY}
    models:
      - claude-sonnet-4-6
      - claude-opus-4-7
    selectedModel: claude-sonnet-4-6
    pricing:                              # optional, keyed by model id
      claude-sonnet-4-6: { input: 3.00, output: 15.00 }
      claude-opus-4-7:   { input: 15.00, output: 75.00 }

  - id: 01HWX9M7PZ8KT5YF4WN2HQX3EB
    name: OpenAI
    format: openai
    baseUrl: https://api.openai.com/v1
    apiKey: ${env:OPENAI_API_KEY}
    models: [ gpt-5, gpt-4o ]
    selectedModel: gpt-5
    pricing:
      gpt-5:  { input: 2.50, output: 10.00 }
      gpt-4o: { input: 2.50, output: 10.00 }

  - id: 01HWX9MC2QJPD6VZ1ND5B7X0RG
    name: DeepSeek
    format: openai                         # OpenAI-compatible
    baseUrl: https://api.deepseek.com
    apiKey: ${env:DEEPSEEK_API_KEY}
    models: [ deepseek-chat, deepseek-reasoner ]
    selectedModel: deepseek-chat

  - id: 01HWX9MGR3NAHTK9C8V2FYE6Y7
    name: Ollama (local)
    format: openai
    baseUrl: http://localhost:11434/v1
    models: [ qwen2.5-coder, llama3.1 ]
    selectedModel: qwen2.5-coder

# --- active selection ---
# Which provider is currently driving the session. The model is implied by
# that provider's selectedModel.
active:
  providerId: 01HWX9M2PSKJ3YN7ZP8BXV6GQA

# --- theme override (optional) ---
theme:
  primary: '#A3BE8C'
  accent: '#6E8759'

# --- welcome tips additions (optional) ---
welcome:
  tips:
    - Let's ship it.
```

**Behavior details (mirrors `Nuka-Code`):**

- `/model` opens a two-level picker:
  - **Root menu** — lists all `providers[]` by `name`, showing `baseUrl` as description; disabled row if the provider has no models. A `[+] Add provider…` row opens a wizard (name, format, baseUrl, apiKey); on save, the wizard calls `listRemoteModels()` to populate `models[]`.
  - **Sub-menu** — lists the chosen provider's `models[]` plus `[↻] Refresh from /v1/models` and a `[← Back]` row. Selecting a model writes it to `provider.selectedModel` and points `active.providerId` at this provider.
- Pricing is per-provider, keyed by model id, because the same model id can appear at different price points across providers (e.g. a proxy vs. first-party).
- If the config contains no providers or the active provider is missing, the startup screen is a config wizard instead of the normal welcome.
- All writes go to the **global** config file (`~/.nuka/config.yaml`); project-level overrides are read-only to `/model` in Phase 1.

### 4.4 Built-in tools

| Tool | Input schema | Permission | Notes |
|---|---|---|---|
| `Read` | `{path, offset?, limit?}` | `none` | Returns `cat -n` formatted text; paginated on large files; binary files rejected |
| `Write` | `{path, content}` | `write` | Parent dir must exist; atomic write via tmp + rename |
| `Edit` | `{path, old_string, new_string, replace_all?}` | `write` | `old_string` uniqueness enforced unless `replace_all` |
| `Bash` | `{command, timeout?, cwd?}` | `exec` | Run via `execa`; default 120s; cascades SIGKILL on abort |
| `Glob` | `{pattern, path?}` | `none` | `picomatch` + fs walk; sorted by mtime desc |
| `Grep` | `{pattern, path?, glob?, type?, output_mode?}` | `none` | Shells out to ripgrep; falls back to `@vscode/ripgrep` vendored bin |

**`ToolContext`:**

```ts
interface ToolContext {
  signal: AbortSignal
  session: Session
  cwd: string
  onProgress?: (msg: string) => void          // Phase 2: streaming tool output
}
```

### 4.5 System prompt (Phase 1 — minimal)

Assembled in `core/agent/systemPrompt.ts` from fixed sections:

- Identity line: `You are Nuka, a terminal coding agent. Be concise, act, ask before destructive changes.`
- Environment: cwd, OS, shell, Node version.
- Git: current branch, dirty file count, last commit summary.
- Tool usage conventions: one short paragraph on calling tools, reporting back, asking before destructive operations.
- Safety reminder: never run destructive shell without announcing intent.

No CLAUDE.md / skills / custom prompts in Phase 1.

### 4.6 Permission system

```ts
type PermissionHint = 'none' | 'write' | 'exec' | 'network'

interface PermissionRule {
  scope: 'once' | 'session' | 'pattern'
  hint: PermissionHint
  pattern?: string                 // glob, e.g. "src/provider/**" or "npm *"
}

interface PermissionDecision {
  allowed: boolean
  reason?: string
  remember?: PermissionRule
}
```

Flow:

1. `hint === 'none'` → allow, no prompt.
2. Cache lookup: scope=session (by hint), scope=pattern (glob match vs `input.path` or command head).
3. Prompt UI via callback. Await decision.
4. If `remember` is set, push into `session.permissionCache`.

**Pattern auto-suggestion:** write/edit → first path segment glob (e.g. `src/provider/openai.ts` → `src/provider/**`); bash → first command word (e.g. `npm test` → `npm *`).

Phase 1 stores decisions in memory only; no persistence.

### 4.7 Session model

```ts
interface Session {
  id: string                          // ulid
  parentId?: string                   // set when created via /branch
  providerId: string                  // snapshot of active.providerId at session start
  model: string                       // snapshot of that provider's selectedModel
  messages: Message[]
  totalUsage: TokenUsage
  permissionCache: PermissionRule[]
  queue: MessageQueue                 // /btw queue
  mode: 'normal' | 'plan' | 'bypass'  // Phase 1: always 'normal'
  createdAt: number
  updatedAt: number
}
```

The session snapshots `(providerId, model)` at creation so that a `/model` switch mid-conversation only affects new sessions unless the user explicitly wants to migrate. `ProviderResolver.resolveFor(session)` looks up the provider instance by `session.providerId` and returns `{provider, model: session.model}`.

`SessionManager`:

- `new()` — fresh session, no parent.
- `branch(from)` — deep-clone messages, cache, totalUsage; new id; `parentId = from.id`.
- `list()` — in-memory array (Phase 1); Phase 2 reads from disk.
- `active()` / `switch(id)`.

`MessageQueue`:

- `push(text)` — O(1); UI immediately shows "queued" confirmation.
- `drain()` — agent loop calls at turn boundary.

### 4.8 `/compact` — real summarization (Phase 1)

Phase 1 implements a **real LLM-backed compact**. Not the naive "drop old messages" shortcut.

**Trigger:** User runs `/compact` manually. (Automatic threshold-triggered compact is Phase 2.)

**Procedure:**

1. Freeze the session's current message list.
2. Choose a "keep window" — the most recent `N` turns verbatim (default `N=3`; user-configurable in `config.compact.keepTurns`).
3. The older messages go to a summarization call:
   - Run a single non-streaming completion against the same provider/model as the session.
   - System prompt: a dedicated compact-summarizer prompt that asks for a structured summary covering: goals, decisions, file paths touched, tools used and outcomes, open questions, pending TODOs. Capped at ~500 tokens output.
4. Replace the older-messages region with a single synthetic assistant message tagged `kind: 'compact-summary'` containing the summary text.
5. Preserve the system message and the keep-window unchanged.
6. Emit a UI event so the messages view shows a collapsed `── compacted (23 messages → summary) ──` divider where the old region used to be.

**Failure mode:** If the summarization call errors, the session is left unchanged and a visible error is shown; no partial replacement.

**Implementation location:** `core/compact/compact.ts`, consumed by `slash/compact.ts`. Unit-tested with a stub provider.

### 4.9 Slash commands (Phase 1 — ten)

| Command | Effect |
|---|---|
| `/exit` | Quit the process (returns 0). |
| `/help` | List all commands, keybindings, short how-tos. |
| `/clear` | Clear the rendered messages (does not reset session state). |
| `/new` | Create a fresh session; previous session retained in the manager. |
| `/branch` | Fork the current session; switch to the fork. |
| `/model` | Two-level picker (provider → model) modeled on `Nuka-Code`'s `InferenceProviderConfig` flow. Root lists providers with `[+] Add provider…`; sub-menu lists the provider's `models[]` with `[↻] Refresh from /v1/models` and `[← Back]`. Selecting a model persists `selectedModel` and points `active.providerId` at the provider. |
| `/config` | Open the config editor: read-only preview + launch `$EDITOR` for edits; live reload on save. |
| `/btw <text>` | Enqueue `text` as a non-blocking message to be appended at the next turn boundary. Also: pressing `⏎` while the agent is running routes through this command. |
| `/compact` | Real LLM-backed summarization per §4.8. |
| `/cost` | Render a detailed cost breakdown: per-provider × per-model × (input/output/cache-read/cache-write) × rate × tokens. |

Common contract:

```ts
interface SlashCommand {
  name: string
  description: string
  usage?: string
  run(args: string, ctx: SlashContext): Promise<SlashResult>
}

type SlashResult =
  | { type: 'text'; text: string }
  | { type: 'dialog'; dialog: DialogDescriptor }
  | { type: 'effect'; effect: SessionEffect }
  | { type: 'exit' }
```

### 4.10 TUI wiring

```tsx
<Box flexDirection="column" height={terminalHeight}>
  <Box flexGrow={1} flexDirection="column">
    {messages.length === 0 ? <Welcome /> : <Messages items={messages} />}
  </Box>
  {activeDialog && <DialogOverlay dialog={activeDialog} />}
  <PromptInput disabled={!!activeDialog || (agentRunning && !allowBtw)} />
  <StatusBar />
</Box>
```

- Bottom-fixed: `PromptInput` and `StatusBar` are the last two children; the middle region flex-grows.
- Resize: `useTerminalSize` re-renders on SIGWINCH.
- History is rendered via Ink's `<Static>` for efficient scrollback; only the streaming row updates.
- Markdown: `marked` + chalk-based renderer; code via `cli-highlight`.
- Diffs (for Write/Edit previews in permission dialog and tool results): `diff` package.

### 4.11 Build and test

- **Build.** `scripts/build.mjs` runs esbuild to a single ESM `dist/cli.js`; `package.json.bin = nuka`.
- **Dev.** `tsx src/cli.tsx` for live runs.
- **Tests.**
  - `test/provider/` — MSW-mocked HTTP; covers SSE parsing and event translation for both SDKs.
  - `test/tools/` — per-tool tmpdir fixtures; assertions on filesystem state.
  - `test/agent/loop.test.ts` — stub provider emits a pre-recorded event script; asserts produced events and message list.
  - `test/permission/` — decision-cache rules, glob matching.
  - `test/compact/` — stub provider for summarizer; asserts message-list transformation and preserved regions.
  - `test/tui/` — `ink-testing-library` snapshots on welcome, mid-conversation, permission dialog.
- **CI.** `typecheck → lint → test → build`.

### 4.12 Phase 1 completion criteria

Phase 1 is done when **all** of the following pass:

1. `nuka` starts and renders welcome screen with logo, random tip, status bar.
2. With a populated config, the agent successfully calls a user-configured Anthropic provider and a user-configured OpenAI-compatible provider in different sessions.
3. `/model` two-level picker works end-to-end: adding a new provider via the wizard, fetching its `models[]` from `/v1/models`, selecting one, and persisting `selectedModel` + `active.providerId` to `~/.nuka/config.yaml`.
4. All six built-in tools (Read / Write / Edit / Bash / Glob / Grep) function and route through permission.
5. All three permission scopes (once / session / pattern) are selectable and take effect for subsequent calls.
6. All ten slash commands function per §4.9.
7. `/btw` enqueues during a running turn and flushes at the boundary without interruption.
8. `/branch` produces an independent session; both sessions evolve independently from that point.
9. `/compact` produces a real summary via an LLM call and replaces the old-messages region.
10. `esc` aborts provider streams and running bash processes cleanly; no zombie processes.
11. Test suite passes.

### 4.13 Explicitly deferred from Phase 1

- Skills, MCP, plugins (Phase 2 / 3).
- Session persistence and resume (Phase 2).
- Automatic threshold-triggered compact (Phase 2).
- Streaming tool output (Phase 2).
- Images / attachments (Phase 2+).
- Hooks, IDE integration, remote control (Phase 4+ TODO).

---

## 5. Phase 2 — Extensions (high-level)

**Goal:** make the agent stateful across runs, context-aware of curated knowledge, and more pleasant for long-running tasks. Detailed design deferred to a separate Phase 2 spec.

Scope:

- **Skill system.** Markdown files with YAML frontmatter under `~/.nuka/skills/` and `<cwd>/.nuka/skills/`. Always-on skills concatenate into the system prompt; triggered skills (by keyword / lifecycle event) inject as transient system messages. A built-in `Skill` tool lets the agent load a skill by name on demand.
- **Session persistence.** Append-only JSONL per session plus a `.meta.json` sidecar; new slash commands `/resume`, `/history`, `/delete-session`; startup `--resume` flag.
- **Streaming tool output.** `ToolContext.onProgress` becomes live; Bash pipes stdout/stderr line-by-line; UI renders incrementally under the tool-call row.
- **Auto-compact.** Threshold-triggered version of §4.8, fires when `tokens > contextWindow × 0.80`; configurable.
- **More built-in tools.** `TodoWrite`, `WebFetch`, `WebSearch`.
- **Input niceties.** `@path` file mentions, `!cmd` inline shell capture, input history navigation.

---

## 6. Phase 3 — External Integrations (high-level)

**Goal:** open the system to external tool providers so third parties can extend Nuka without modifying core. Detailed design deferred to a separate Phase 3 spec.

Scope:

- **MCP client.** `@modelcontextprotocol/sdk` with `stdio` and `sse`/`streamable-http` transports; servers declared in `config.mcp.servers`; MCP tools merged into the same `ToolRegistry` with namespaced names and unchanged permission routing.
- **Plugin system.** A plugin is a local directory or npm package with a manifest that can contribute skills, tools, slash commands, and MCP servers. Install via `nuka plugin install <path-or-url>`. Namespaced; unsandboxed in Phase 3 (users warned at install).
- **Unified tool registry.** `builtin + skill + mcp + plugin` merged, deduplicated, namespaced, passed to the provider as a single tool list.
- **Status bar.** `● N mcp` segment reflects real connection health.

---

## 7. Phase 4+ — Future Work (TODO backlog)

Not designed. Listed so they are not forgotten:

- Plan Mode and Bypass Mode (session-level gating).
- Sub-agents / Task tool (isolated agent tasks with summary return).
- Hooks (lifecycle shell commands).
- Remote control (Telegram / Feishu / Discord).
- IDE integration (VS Code, JetBrains).
- OAuth login flows.
- Voice input.
- Images / attachments in prompts.
- Smarter context management (collapse, relevance-based eviction, memory prefetch).
- Plugin marketplace.
- Telemetry and cost dashboards.
- Native single-binary distribution.

---

## 8. Risks and Open Questions

- **OpenAI / Anthropic tool-use semantic drift.** Tool-use on Anthropic carries richer semantics (content blocks, thinking interleaved). Our internal `Message` type is expressive enough, but Phase 1 OpenAI path may lose nuances (e.g. multi-tool parallel). Acceptable for Phase 1; revisit if users hit it.
- **Ripgrep distribution.** Relying on `@vscode/ripgrep` vendored binary adds ~10 MB to the package. Alternative: require system ripgrep; fallback to a slower JS implementation.
- **Compact quality.** Summarization quality depends on the model; a cheap model set as default could produce poor summaries. Mitigation: config option `compact.model` to pin the summarizer to a stronger model regardless of the session's active model.
- **Plugin trust.** Phase 3 plugins run unsandboxed. The install-confirmation flow is the only protection. Revisit in Phase 4+ (process isolation or VM).
- **Terminal compatibility.** Braille logo rendering depends on font support; fallback to a simpler ASCII logo needs testing on Windows Terminal / older xterm.

---

## 9. Phase Sequencing Summary

```
Phase 1  ──►  usable skeleton
             • Ink TUI (welcome, messages, prompt, status bar, permission dialog)
             • LLMProvider + Anthropic + OpenAI (user-configured)
             • Agent loop + abort + queue flush
             • 6 built-in tools + permission (3 scopes)
             • 10 slash commands
             • Real /compact

Phase 2  ──►  extensions
             • Skills (markdown + frontmatter, auto / triggered)
             • Session persistence (/resume, /history)
             • Streaming tool output
             • Auto-compact at threshold
             • TodoWrite / WebFetch / WebSearch
             • @path mention, !cmd prefix, input history

Phase 3  ──►  external integrations
             • MCP client (stdio + sse)
             • Plugin system (dir + npm)
             • Unified tool registry (builtin + skill + mcp + plugin)

Phase 4+ ──►  see §7 TODO
```
