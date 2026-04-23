# Nuka Rewrite Implementation Plan (Phase 1–3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable terminal AI agent (Nuka) with Ink TUI, two LLM providers (Anthropic + OpenAI), agent tool-use loop, six built-in tools, permission approval, ten slash commands including real LLM-backed `/compact`, per the Phase 1 section (§4) of `docs/superpowers/specs/2026-04-23-nuka-rewrite-design.md`. Phase 2 and Phase 3 are included at **milestone-level granularity** (to be expanded into bite-sized tasks once their sections of the spec are written out in the same detail as Phase 1). Phase 4+ tracked in spec §7 as backlog.

**Architecture:** Layered single-package TypeScript project. `src/core/` contains all pure logic (no Ink, no React) and is the testable contract surface; `src/tui/` is the Ink renderer; `src/slash/` holds slash commands. Bottom-fixed input, avocado-green theme, two-level `/model` picker following Nuka-Code's `InferenceProviderConfig` pattern. Internal normalized `Message` / `AgentEvent` shapes decouple provider SDK differences.

**Tech Stack:** Node 18+, TypeScript, Ink 6, React 19, `@anthropic-ai/sdk`, `openai`, `zod`, `execa`, `picomatch`, `marked`, `cli-highlight`, `diff`, `ulid`, `yaml`. Vitest + `ink-testing-library` + `msw` for tests. Esbuild for production build, `tsx` for dev.

**Reference spec:** `docs/superpowers/specs/2026-04-23-nuka-rewrite-design.md` — every task cross-references the relevant spec section.

---

## Conventions

- **TDD discipline:** Every behavior-carrying unit in `core/` has a failing test written first. TUI components test with `ink-testing-library`. Pure type files (`types.ts`) do not require tests — they are verified by the type checker and by the tests of consumers.
- **One responsibility per file.** If a file starts to exceed ~250 lines, split.
- **Commit cadence:** each task ends with one commit. Messages follow conventional commit format (`feat:` / `test:` / `chore:` / `refactor:`).
- **No hand-wavy tests.** Assertions name concrete behavior, not "works correctly."
- **Run command shorthand:** `pnpm` is the assumed package manager (swap to `npm` if preferred; commands are interchangeable).
- **Test file naming:** mirror source tree — `src/core/foo/bar.ts` → `test/core/foo/bar.test.ts`.

---

## File Structure (Phase 1 complete)

```
nuka/
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── scripts/
│   └── build.mjs                         # esbuild bundle → dist/cli.js
├── src/
│   ├── cli.tsx                           # entry; parse argv; load config; mount <App/>
│   │
│   ├── core/
│   │   ├── message/
│   │   │   ├── types.ts                  # Message, ContentBlock, TokenUsage
│   │   │   └── factories.ts              # makeUserMessage, makeToolMessage, emptyAssistant
│   │   ├── config/
│   │   │   ├── schema.ts                 # zod schema for Config, ProviderConfig
│   │   │   ├── paths.ts                  # ~/.nuka, <cwd>/.nuka resolution
│   │   │   └── load.ts                   # loadConfig(): merge global + project + env
│   │   ├── provider/
│   │   │   ├── types.ts                  # LLMProvider, ProviderEvent, LLMRequest, ToolSpec
│   │   │   ├── events.ts                 # event helpers
│   │   │   ├── anthropic.ts              # AnthropicProvider
│   │   │   ├── openai.ts                 # OpenAIProvider
│   │   │   ├── resolver.ts               # ProviderResolver
│   │   │   └── remoteModels.ts           # fetch /v1/models from baseUrl
│   │   ├── tools/
│   │   │   ├── types.ts                  # Tool, ToolContext, ToolResult, ToolSpec, PermissionHint
│   │   │   ├── registry.ts               # ToolRegistry
│   │   │   ├── read.ts                   # Read tool
│   │   │   ├── write.ts                  # Write tool
│   │   │   ├── edit.ts                   # Edit tool
│   │   │   ├── bash.ts                   # Bash tool
│   │   │   ├── glob.ts                   # Glob tool
│   │   │   └── grep.ts                   # Grep tool
│   │   ├── permission/
│   │   │   ├── types.ts                  # PermissionRule, PermissionDecision
│   │   │   ├── cache.ts                  # PermissionCache
│   │   │   └── checker.ts                # PermissionChecker
│   │   ├── session/
│   │   │   ├── types.ts                  # Session
│   │   │   ├── queue.ts                  # MessageQueue
│   │   │   ├── session.ts                # Session factory / helpers
│   │   │   ├── manager.ts                # SessionManager
│   │   │   └── telemetry.ts              # cost / git-branch / token tracking
│   │   ├── agent/
│   │   │   ├── events.ts                 # AgentEvent type
│   │   │   ├── systemPrompt.ts           # buildSystemPrompt
│   │   │   └── loop.ts                   # runAgent async generator
│   │   └── compact/
│   │       └── compact.ts                # real LLM-backed summarization
│   │
│   ├── tui/
│   │   ├── App.tsx                       # root component
│   │   ├── theme.ts                      # palette + helpers
│   │   ├── Welcome/
│   │   │   ├── Welcome.tsx
│   │   │   ├── Logo.tsx
│   │   │   └── tips.ts                   # welcome tip pool
│   │   ├── Messages/
│   │   │   ├── Messages.tsx
│   │   │   ├── MessageRow.tsx
│   │   │   ├── ToolCall.tsx
│   │   │   ├── Markdown.tsx
│   │   │   └── Diff.tsx
│   │   ├── PromptInput/
│   │   │   ├── PromptInput.tsx           # bottom-fixed input
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
│       ├── types.ts                      # SlashCommand, SlashResult
│       ├── registry.ts
│       ├── exit.ts
│       ├── help.ts
│       ├── clear.ts
│       ├── new.ts
│       ├── branch.ts
│       ├── btw.ts
│       ├── cost.ts
│       ├── model.ts                      # two-level picker launcher
│       ├── config.ts
│       └── compact.ts
│
└── test/                                 # mirrors src/ layout
    ├── core/…
    ├── tui/…
    └── slash/…
```

---

## Task Overview

The plan is grouped into 10 sections. Sections are orderable dependencies: do them in numerical order.

1. §A **Scaffolding** (Tasks 1–3) — package, tsconfig, test runner, build script.
2. §B **Message layer** (Tasks 4–5) — normalized message types and factories.
3. §C **Config** (Tasks 6–8) — schema, paths, loader.
4. §D **Provider layer** (Tasks 9–13) — types, Anthropic, OpenAI, remote model fetch, resolver.
5. §E **Tools** (Tasks 14–20) — registry + 6 built-in tools.
6. §F **Permission** (Tasks 21–23) — types, cache, checker.
7. §G **Session** (Tasks 24–27) — session, queue, manager, telemetry.
8. §H **Agent loop + compact** (Tasks 28–30) — system prompt, loop, summarizer.
9. §I **Slash commands** (Tasks 31–35) — types, simple commands, `/model`, `/compact`, `/config`.
10. §J **TUI + wire-up** (Tasks 36–46) — theme, components, hooks, dialogs, App, cli entry, smoke test.

---

## §A · Scaffolding

### Task 1: Initialize package.json and directory skeleton

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `src/` (empty at first)
- Create: `test/` (empty at first)

- [ ] **Step 1: Write `.gitignore`**

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "nuka",
  "version": "0.1.0",
  "private": true,
  "description": "Avocado Agent — terminal AI coding assistant",
  "type": "module",
  "bin": {
    "nuka": "dist/cli.js"
  },
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "dev": "tsx src/cli.tsx",
    "build": "node scripts/build.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src test --ext .ts,.tsx"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.80.0",
    "openai": "^4.90.0",
    "ink": "^6.8.0",
    "react": "^19.2.0",
    "zod": "^4.3.0",
    "yaml": "^2.8.0",
    "execa": "^9.6.0",
    "picomatch": "^4.0.4",
    "marked": "^17.0.0",
    "cli-highlight": "^2.1.11",
    "diff": "^8.0.0",
    "ulid": "^2.3.0",
    "chalk": "^5.6.0",
    "strip-ansi": "^7.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/diff": "^7.0.0",
    "@types/picomatch": "^4.0.0",
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "esbuild": "^0.27.0",
    "vitest": "^2.1.0",
    "ink-testing-library": "^4.0.0",
    "msw": "^2.7.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "outDir": "dist",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "test/**/*", "scripts/**/*"]
}
```

- [ ] **Step 4: Install dependencies and typecheck**

Run: `pnpm install && pnpm typecheck`
Expected: install succeeds; typecheck passes with zero errors (no source files yet).

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json tsconfig.json
git commit -m "chore: initialize package.json and tsconfig"
```

---

### Task 2: Set up vitest and smoke test

**Files:**
- Create: `vitest.config.ts`
- Create: `test/smoke.test.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: { reporter: ['text', 'html'] },
  },
})
```

- [ ] **Step 2: Write smoke test**

```ts
// test/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('arithmetic still works', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `pnpm test`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts test/smoke.test.ts
git commit -m "test: wire up vitest with smoke test"
```

---

### Task 3: Esbuild production build script

**Files:**
- Create: `scripts/build.mjs`
- Create: `src/cli.tsx` (placeholder; will be filled in Task 46)

- [ ] **Step 1: Write placeholder entry**

```tsx
// src/cli.tsx
// Placeholder entry. Real wiring lives in Task 46.
console.log('Nuka — placeholder entry; implement in Task 46.')
```

- [ ] **Step 2: Write `scripts/build.mjs`**

```js
// scripts/build.mjs
import { build } from 'esbuild'
import { chmod } from 'node:fs/promises'

await build({
  entryPoints: ['src/cli.tsx'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  jsx: 'automatic',
  banner: { js: '#!/usr/bin/env node' },
  external: [
    // Native / optional deps that should resolve at runtime.
    'fsevents',
  ],
  logLevel: 'info',
})

await chmod('dist/cli.js', 0o755)
```

- [ ] **Step 3: Run the build**

Run: `pnpm build && node dist/cli.js`
Expected: build succeeds; running prints `Nuka — placeholder entry; implement in Task 46.`

- [ ] **Step 4: Commit**

```bash
git add scripts/build.mjs src/cli.tsx
git commit -m "chore: add esbuild production build script"
```

---
## §B · Message Layer

### Task 4: Message types

**Files:**
- Create: `src/core/message/types.ts`

- [ ] **Step 1: Write types**

```ts
// src/core/message/types.ts
export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'error'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }

export type UserMessage = {
  role: 'user'
  content: ContentBlock[]
  id: string
  ts: number
}

export type AssistantMessage = {
  role: 'assistant'
  content: ContentBlock[]
  id: string
  ts: number
  usage?: TokenUsage
  stopReason?: StopReason
}

export type ToolMessage = {
  role: 'tool'
  toolUseId: string
  content: string
  isError: boolean
  id: string
  ts: number
}

export type SystemMessage = {
  role: 'system'
  content: string
}

export type Message = UserMessage | AssistantMessage | ToolMessage | SystemMessage
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/message/types.ts
git commit -m "feat(core/message): define normalized Message types"
```

---

### Task 5: Message factories with tests

**Files:**
- Create: `src/core/message/factories.ts`
- Create: `test/core/message/factories.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/message/factories.test.ts
import { describe, it, expect } from 'vitest'
import {
  makeUserMessage,
  makeToolMessage,
  emptyAssistant,
} from '../../../src/core/message/factories'

describe('message factories', () => {
  it('makeUserMessage wraps text as a single text block', () => {
    const m = makeUserMessage({ text: 'hi' })
    expect(m.role).toBe('user')
    expect(m.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(typeof m.id).toBe('string')
    expect(m.id.length).toBeGreaterThan(0)
    expect(m.ts).toBeGreaterThan(0)
  })

  it('makeToolMessage records result + error flag', () => {
    const m = makeToolMessage('call-123', { output: 'ok', isError: false })
    expect(m.role).toBe('tool')
    expect(m.toolUseId).toBe('call-123')
    expect(m.content).toBe('ok')
    expect(m.isError).toBe(false)
  })

  it('emptyAssistant starts with empty content array', () => {
    const a = emptyAssistant()
    expect(a.role).toBe('assistant')
    expect(a.content).toEqual([])
  })
})
```

- [ ] **Step 2: Run test and watch it fail**

Run: `pnpm test test/core/message/factories.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement factories**

```ts
// src/core/message/factories.ts
import { ulid } from 'ulid'
import type {
  UserMessage,
  AssistantMessage,
  ToolMessage,
} from './types'

export function makeUserMessage(input: { text: string }): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: input.text }],
    id: ulid(),
    ts: Date.now(),
  }
}

export function makeToolMessage(
  toolUseId: string,
  result: { output: string; isError: boolean },
): ToolMessage {
  return {
    role: 'tool',
    toolUseId,
    content: result.output,
    isError: result.isError,
    id: ulid(),
    ts: Date.now(),
  }
}

export function emptyAssistant(): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    id: ulid(),
    ts: Date.now(),
  }
}
```

- [ ] **Step 4: Run test and watch it pass**

Run: `pnpm test test/core/message/factories.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/message/factories.ts test/core/message/factories.test.ts
git commit -m "feat(core/message): add message factories"
```

---

## §C · Config

### Task 6: Config paths

**Files:**
- Create: `src/core/config/paths.ts`
- Create: `test/core/config/paths.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/config/paths.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { globalConfigPath, projectConfigPath } from '../../../src/core/config/paths'

describe('config paths', () => {
  const origHome = os.homedir()
  beforeEach(() => { process.env.HOME = '/tmp/nuka-home' })
  afterEach(() => { process.env.HOME = origHome })

  it('globalConfigPath resolves under $HOME/.nuka/', () => {
    expect(globalConfigPath()).toBe(path.join('/tmp/nuka-home', '.nuka', 'config.yaml'))
  })

  it('projectConfigPath resolves under given cwd/.nuka/', () => {
    expect(projectConfigPath('/workspace/foo')).toBe(
      path.join('/workspace/foo', '.nuka', 'config.yaml'),
    )
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/config/paths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/config/paths.ts
import os from 'node:os'
import path from 'node:path'

export function globalConfigDir(): string {
  return path.join(os.homedir(), '.nuka')
}

export function globalConfigPath(): string {
  return path.join(globalConfigDir(), 'config.yaml')
}

export function projectConfigPath(cwd: string): string {
  return path.join(cwd, '.nuka', 'config.yaml')
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/config/paths.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/paths.ts test/core/config/paths.test.ts
git commit -m "feat(core/config): add config path helpers"
```

---

### Task 7: Config zod schema

**Files:**
- Create: `src/core/config/schema.ts`
- Create: `test/core/config/schema.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/config/schema.test.ts
import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../../../src/core/config/schema'

describe('ConfigSchema', () => {
  it('accepts a minimal providers-only config', () => {
    const parsed = ConfigSchema.parse({
      providers: [
        {
          id: 'p1',
          name: 'Anthropic',
          format: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-x',
          models: ['claude-sonnet-4-6'],
          selectedModel: 'claude-sonnet-4-6',
        },
      ],
      active: { providerId: 'p1' },
    })
    expect(parsed.providers).toHaveLength(1)
    expect(parsed.active.providerId).toBe('p1')
  })

  it('rejects unknown provider format', () => {
    expect(() =>
      ConfigSchema.parse({
        providers: [
          { id: 'p1', name: 'x', format: 'gemini', baseUrl: 'https://x', models: [] },
        ],
        active: { providerId: 'p1' },
      }),
    ).toThrow()
  })

  it('supports optional pricing per model', () => {
    const parsed = ConfigSchema.parse({
      providers: [
        {
          id: 'p1',
          name: 'x',
          format: 'openai',
          baseUrl: 'https://x',
          models: ['gpt-5'],
          pricing: { 'gpt-5': { input: 2.5, output: 10 } },
        },
      ],
      active: { providerId: 'p1' },
    })
    expect(parsed.providers[0].pricing?.['gpt-5'].input).toBe(2.5)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/config/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/config/schema.ts
import { z } from 'zod'

export const ProviderFormatSchema = z.enum(['anthropic', 'openai'])
export type ProviderFormat = z.infer<typeof ProviderFormatSchema>

export const PricingSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
})

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  format: ProviderFormatSchema,
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  models: z.array(z.string()).default([]),
  selectedModel: z.string().optional(),
  extraHeaders: z.record(z.string(), z.string()).optional(),
  pricing: z.record(z.string(), PricingSchema).optional(),
})
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

export const ActiveSelectionSchema = z.object({
  providerId: z.string().min(1),
})

export const ThemeSchema = z
  .object({
    primary: z.string().optional(),
    accent: z.string().optional(),
    fg: z.string().optional(),
    muted: z.string().optional(),
    warn: z.string().optional(),
    error: z.string().optional(),
  })
  .optional()

export const WelcomeSchema = z
  .object({
    tips: z.array(z.string()).optional(),
  })
  .optional()

export const CompactSchema = z
  .object({
    keepTurns: z.number().int().positive().default(3),
    model: z.string().optional(),
  })
  .optional()

export const ConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).default([]),
  active: ActiveSelectionSchema,
  theme: ThemeSchema,
  welcome: WelcomeSchema,
  compact: CompactSchema,
})
export type Config = z.infer<typeof ConfigSchema>
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/config/schema.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/schema.ts test/core/config/schema.test.ts
git commit -m "feat(core/config): add zod schema for Config"
```

---

### Task 8: Config loader (global + project + env merge)

**Files:**
- Create: `src/core/config/load.ts`
- Create: `test/core/config/load.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/config/load.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { loadConfig } from '../../../src/core/config/load'

function tmp(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-cfg-'))
}

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.NUKA_ACTIVE_PROVIDER_ID
  })

  it('returns default empty config when no files exist', async () => {
    const home = tmp()
    const cwd = tmp()
    const cfg = await loadConfig({ home, cwd })
    expect(cfg.providers).toEqual([])
    expect(cfg.active.providerId).toBe('')
  })

  it('reads a global yaml file', async () => {
    const home = tmp()
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'config.yaml'),
      `providers:
  - id: p1
    name: A
    format: anthropic
    baseUrl: https://api.anthropic.com
    apiKey: sk-x
    models: [claude-sonnet-4-6]
active:
  providerId: p1
`,
    )
    const cfg = await loadConfig({ home, cwd: tmp() })
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.active.providerId).toBe('p1')
  })

  it('project config overrides global', async () => {
    const home = tmp()
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'config.yaml'),
      `providers:
  - id: p1
    name: Global
    format: anthropic
    baseUrl: https://api.anthropic.com
    models: []
active: { providerId: p1 }
`,
    )
    const cwd = tmp()
    mkdirSync(join(cwd, '.nuka'))
    writeFileSync(
      join(cwd, '.nuka', 'config.yaml'),
      `providers:
  - id: p2
    name: Project
    format: openai
    baseUrl: https://api.openai.com/v1
    models: []
active: { providerId: p2 }
`,
    )
    const cfg = await loadConfig({ home, cwd })
    expect(cfg.active.providerId).toBe('p2')
    expect(cfg.providers.map(p => p.name).sort()).toEqual(['Global', 'Project'])
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/config/load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/config/load.ts
import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import path from 'node:path'
import type { Config, ProviderConfig } from './schema'
import { ConfigSchema } from './schema'

const EMPTY: Config = {
  providers: [],
  active: { providerId: '' },
}

async function readYaml(p: string): Promise<unknown | null> {
  try {
    const text = await readFile(p, 'utf8')
    return parseYaml(text)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function expandEnv(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return value.replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? '')
}

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) out[k] = walk(v)
    return out
  }
  return expandEnv(node)
}

function mergeProviders(a: ProviderConfig[], b: ProviderConfig[]): ProviderConfig[] {
  const byId = new Map<string, ProviderConfig>()
  for (const p of a) byId.set(p.id, p)
  for (const p of b) byId.set(p.id, p)
  return [...byId.values()]
}

export async function loadConfig(opts: {
  home: string
  cwd: string
}): Promise<Config> {
  const globalRaw = await readYaml(path.join(opts.home, '.nuka', 'config.yaml'))
  const projectRaw = await readYaml(path.join(opts.cwd, '.nuka', 'config.yaml'))

  const globalCfg = globalRaw ? ConfigSchema.parse(walk(globalRaw)) : EMPTY
  const projectCfg = projectRaw ? ConfigSchema.parse(walk(projectRaw)) : EMPTY

  const merged: Config = {
    providers: mergeProviders(globalCfg.providers, projectCfg.providers),
    active: projectCfg.active.providerId
      ? projectCfg.active
      : globalCfg.active,
    theme: projectCfg.theme ?? globalCfg.theme,
    welcome: projectCfg.welcome ?? globalCfg.welcome,
    compact: projectCfg.compact ?? globalCfg.compact,
  }

  const envActive = process.env.NUKA_ACTIVE_PROVIDER_ID
  if (envActive) merged.active = { providerId: envActive }

  return merged
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/config/load.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/load.ts test/core/config/load.test.ts
git commit -m "feat(core/config): add layered config loader"
```

---
## §D · Provider Layer

### Task 9: Provider types and ToolSpec

**Files:**
- Create: `src/core/provider/types.ts`

- [ ] **Step 1: Write types**

```ts
// src/core/provider/types.ts
import type { Message, StopReason, TokenUsage } from '../message/types'

export type ProviderFormat = 'anthropic' | 'openai'

export type ToolSpec = {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
}

export type LLMRequest = {
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
  | {
      type: 'message_stop'
      stopReason: StopReason
      usage: TokenUsage
    }

export interface LLMProvider {
  readonly id: string
  readonly format: ProviderFormat
  stream(req: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
  listRemoteModels(): Promise<string[]>
  countTokens?(messages: Message[]): Promise<number>
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/provider/types.ts
git commit -m "feat(core/provider): add provider types and ProviderEvent"
```

---

### Task 10: Anthropic provider (streaming + translation)

**Files:**
- Create: `src/core/provider/anthropic.ts`
- Create: `test/core/provider/anthropic.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/provider/anthropic.test.ts
import { describe, it, expect } from 'vitest'
import { AnthropicProvider } from '../../../src/core/provider/anthropic'
import type { ProviderEvent } from '../../../src/core/provider/types'

/**
 * Mock Anthropic SDK stream. We hand-roll an async iterable that yields
 * SDK events in the same shape the real SDK emits so the translator can
 * be tested in isolation from real HTTP.
 */
function makeFakeSdkStream(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
  }
}

describe('AnthropicProvider.translate', () => {
  it('translates content_block_delta text into text_delta events', async () => {
    const provider = new AnthropicProvider({
      id: 'p',
      apiKey: 'sk',
      baseUrl: 'https://api.anthropic.com',
    })
    const sdkEvents = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' there' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 10, output_tokens: 4 },
      },
      { type: 'message_stop' },
    ]
    const out: ProviderEvent[] = []
    for await (const ev of provider.translateStream(makeFakeSdkStream(sdkEvents))) {
      out.push(ev)
    }
    expect(out).toEqual([
      { type: 'text_delta', text: 'hi' },
      { type: 'text_delta', text: ' there' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 4 },
      },
    ])
  })

  it('translates tool_use blocks with streamed JSON input', async () => {
    const provider = new AnthropicProvider({
      id: 'p',
      apiKey: 'sk',
      baseUrl: 'https://api.anthropic.com',
    })
    const sdkEvents = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"path":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"a.ts"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { input_tokens: 5, output_tokens: 8 },
      },
      { type: 'message_stop' },
    ]
    const out: ProviderEvent[] = []
    for await (const ev of provider.translateStream(makeFakeSdkStream(sdkEvents))) {
      out.push(ev)
    }
    expect(out).toEqual([
      { type: 'tool_use_start', id: 'tu_1', name: 'Read' },
      { type: 'tool_use_args_delta', id: 'tu_1', delta: '{"path":' },
      { type: 'tool_use_args_delta', id: 'tu_1', delta: '"a.ts"}' },
      { type: 'tool_use_stop', id: 'tu_1', input: { path: 'a.ts' } },
      {
        type: 'message_stop',
        stopReason: 'tool_use',
        usage: { inputTokens: 5, outputTokens: 8 },
      },
    ])
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/provider/anthropic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/provider/anthropic.ts
import Anthropic from '@anthropic-ai/sdk'
import type {
  LLMProvider,
  LLMRequest,
  ProviderEvent,
  ToolSpec,
} from './types'
import type { Message, StopReason } from '../message/types'
import { fetchRemoteModels } from './remoteModels'

type AnthropicOpts = {
  id: string
  apiKey: string
  baseUrl: string
  extraHeaders?: Record<string, string>
}

export class AnthropicProvider implements LLMProvider {
  readonly id: string
  readonly format = 'anthropic' as const
  private client: Anthropic
  private baseUrl: string
  private apiKey: string
  private extraHeaders: Record<string, string>

  constructor(opts: AnthropicOpts) {
    this.id = opts.id
    this.baseUrl = opts.baseUrl
    this.apiKey = opts.apiKey
    this.extraHeaders = opts.extraHeaders ?? {}
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      defaultHeaders: this.extraHeaders,
    })
  }

  async *stream(
    req: LLMRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const sdkStream = this.client.messages.stream(
      {
        model: req.model,
        system: req.system,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature,
        messages: toAnthropicMessages(req.messages),
        tools: req.tools.map(toAnthropicTool),
      },
      { signal },
    )
    for await (const ev of this.translateStream(sdkStream)) {
      yield ev
    }
  }

  /** Exposed for unit testing with a fake SDK stream. */
  async *translateStream(
    sdkStream: AsyncIterable<unknown>,
  ): AsyncIterable<ProviderEvent> {
    const toolInputBuffers = new Map<string, string>()
    const blockMeta = new Map<number, { kind: 'text' | 'tool_use'; id?: string }>()

    for await (const raw of sdkStream) {
      const ev = raw as any

      if (ev.type === 'content_block_start') {
        if (ev.content_block.type === 'tool_use') {
          blockMeta.set(ev.index, { kind: 'tool_use', id: ev.content_block.id })
          toolInputBuffers.set(ev.content_block.id, '')
          yield {
            type: 'tool_use_start',
            id: ev.content_block.id,
            name: ev.content_block.name,
          }
        } else {
          blockMeta.set(ev.index, { kind: 'text' })
        }
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: ev.delta.text }
        } else if (ev.delta.type === 'input_json_delta') {
          const meta = blockMeta.get(ev.index)
          if (meta?.kind === 'tool_use' && meta.id) {
            const buf = toolInputBuffers.get(meta.id) ?? ''
            toolInputBuffers.set(meta.id, buf + ev.delta.partial_json)
            yield {
              type: 'tool_use_args_delta',
              id: meta.id,
              delta: ev.delta.partial_json,
            }
          }
        }
      } else if (ev.type === 'content_block_stop') {
        const meta = blockMeta.get(ev.index)
        if (meta?.kind === 'tool_use' && meta.id) {
          const buf = toolInputBuffers.get(meta.id) ?? '{}'
          let parsed: unknown = {}
          try { parsed = JSON.parse(buf || '{}') } catch { /* empty */ }
          yield { type: 'tool_use_stop', id: meta.id, input: parsed }
        }
      } else if (ev.type === 'message_delta') {
        // capture usage + stop_reason for the final message_stop
        ;(this as any)._lastDelta = ev
      } else if (ev.type === 'message_stop') {
        const last = (this as any)._lastDelta
        const stopReason: StopReason = normalizeStop(
          last?.delta?.stop_reason ?? 'end_turn',
        )
        yield {
          type: 'message_stop',
          stopReason,
          usage: {
            inputTokens: last?.usage?.input_tokens ?? 0,
            outputTokens: last?.usage?.output_tokens ?? 0,
            cacheReadTokens: last?.usage?.cache_read_input_tokens,
            cacheWriteTokens: last?.usage?.cache_creation_input_tokens,
          },
        }
      }
    }
  }

  async listRemoteModels(): Promise<string[]> {
    return fetchRemoteModels({
      format: 'anthropic',
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      extraHeaders: this.extraHeaders,
    })
  }
}

function normalizeStop(r: string): StopReason {
  switch (r) {
    case 'end_turn': return 'end_turn'
    case 'tool_use': return 'tool_use'
    case 'max_tokens': return 'max_tokens'
    case 'stop_sequence': return 'stop_sequence'
    default: return 'end_turn'
  }
}

function toAnthropicMessages(messages: Message[]): unknown[] {
  const out: any[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      out.push({ role: 'user', content: blocksToAnthropic(m.content) })
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: blocksToAnthropic(m.content) })
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolUseId,
            content: m.content,
            is_error: m.isError || undefined,
          },
        ],
      })
    }
  }
  return out
}

function blocksToAnthropic(blocks: Message['content'] extends ReadonlyArray<infer _> ? any[] : never): unknown[] {
  return (blocks as any[]).map(b => {
    if (b.type === 'text') return { type: 'text', text: b.text }
    if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
    return b
  })
}

function toAnthropicTool(spec: ToolSpec): unknown {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.parameters,
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/provider/anthropic.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/provider/anthropic.ts test/core/provider/anthropic.test.ts
git commit -m "feat(core/provider): add AnthropicProvider with event translation"
```

---

### Task 11: OpenAI provider (streaming + translation)

**Files:**
- Create: `src/core/provider/openai.ts`
- Create: `test/core/provider/openai.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/provider/openai.test.ts
import { describe, it, expect } from 'vitest'
import { OpenAIProvider } from '../../../src/core/provider/openai'
import type { ProviderEvent } from '../../../src/core/provider/types'

function fakeStream(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  }
}

describe('OpenAIProvider.translate', () => {
  it('translates content deltas into text_delta', async () => {
    const provider = new OpenAIProvider({
      id: 'p',
      apiKey: 'sk',
      baseUrl: 'https://api.openai.com/v1',
    })
    const chunks = [
      { choices: [{ delta: { content: 'hello' }, finish_reason: null }] },
      { choices: [{ delta: { content: ' world' }, finish_reason: null }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      },
    ]
    const out: ProviderEvent[] = []
    for await (const ev of provider.translateStream(fakeStream(chunks))) {
      out.push(ev)
    }
    expect(out).toEqual([
      { type: 'text_delta', text: 'hello' },
      { type: 'text_delta', text: ' world' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 2 },
      },
    ])
  })

  it('translates streamed tool calls into tool_use_start + deltas + stop', async () => {
    const provider = new OpenAIProvider({
      id: 'p',
      apiKey: 'sk',
      baseUrl: 'https://api.openai.com/v1',
    })
    const chunks = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'Read', arguments: '' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '{"path":' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"a.ts"}' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 3, completion_tokens: 7 },
      },
    ]
    const out: ProviderEvent[] = []
    for await (const ev of provider.translateStream(fakeStream(chunks))) {
      out.push(ev)
    }
    expect(out).toEqual([
      { type: 'tool_use_start', id: 'call_1', name: 'Read' },
      { type: 'tool_use_args_delta', id: 'call_1', delta: '{"path":' },
      { type: 'tool_use_args_delta', id: 'call_1', delta: '"a.ts"}' },
      { type: 'tool_use_stop', id: 'call_1', input: { path: 'a.ts' } },
      {
        type: 'message_stop',
        stopReason: 'tool_use',
        usage: { inputTokens: 3, outputTokens: 7 },
      },
    ])
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/provider/openai.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/provider/openai.ts
import OpenAI from 'openai'
import type {
  LLMProvider,
  LLMRequest,
  ProviderEvent,
  ToolSpec,
} from './types'
import type { Message, StopReason } from '../message/types'
import { fetchRemoteModels } from './remoteModels'

type OpenAIOpts = {
  id: string
  apiKey: string
  baseUrl: string
  extraHeaders?: Record<string, string>
}

export class OpenAIProvider implements LLMProvider {
  readonly id: string
  readonly format = 'openai' as const
  private client: OpenAI
  private apiKey: string
  private baseUrl: string
  private extraHeaders: Record<string, string>

  constructor(opts: OpenAIOpts) {
    this.id = opts.id
    this.apiKey = opts.apiKey
    this.baseUrl = opts.baseUrl
    this.extraHeaders = opts.extraHeaders ?? {}
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      defaultHeaders: this.extraHeaders,
    })
  }

  async *stream(
    req: LLMRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const sdkStream = await this.client.chat.completions.create(
      {
        model: req.model,
        stream: true,
        stream_options: { include_usage: true },
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        messages: toOpenAIMessages(req.system, req.messages),
        tools: req.tools.length > 0
          ? req.tools.map(t => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            }))
          : undefined,
      },
      { signal },
    )
    for await (const ev of this.translateStream(sdkStream as any)) {
      yield ev
    }
  }

  async *translateStream(
    chunks: AsyncIterable<unknown>,
  ): AsyncIterable<ProviderEvent> {
    type ToolBuf = { id: string; name: string; args: string; started: boolean }
    const toolsByIdx = new Map<number, ToolBuf>()
    let finishReason: string | null = null
    let usage = { inputTokens: 0, outputTokens: 0 }

    for await (const raw of chunks) {
      const chunk = raw as any
      const choice = chunk.choices?.[0]
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        }
      }
      if (!choice) continue
      const delta = choice.delta ?? {}
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield { type: 'text_delta', text: delta.content }
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          let buf = toolsByIdx.get(idx)
          if (!buf) {
            buf = { id: tc.id ?? `tc_${idx}`, name: tc.function?.name ?? '', args: '', started: false }
            toolsByIdx.set(idx, buf)
          }
          if (tc.id && !buf.id) buf.id = tc.id
          if (tc.function?.name && !buf.name) buf.name = tc.function.name
          if (!buf.started && buf.name) {
            buf.started = true
            yield { type: 'tool_use_start', id: buf.id, name: buf.name }
          }
          const piece: string | undefined = tc.function?.arguments
          if (typeof piece === 'string' && piece.length > 0) {
            buf.args += piece
            yield { type: 'tool_use_args_delta', id: buf.id, delta: piece }
          }
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason
    }

    for (const buf of toolsByIdx.values()) {
      let parsed: unknown = {}
      try { parsed = JSON.parse(buf.args || '{}') } catch { /* empty */ }
      yield { type: 'tool_use_stop', id: buf.id, input: parsed }
    }

    yield {
      type: 'message_stop',
      stopReason: normalizeFinish(finishReason),
      usage,
    }
  }

  async listRemoteModels(): Promise<string[]> {
    return fetchRemoteModels({
      format: 'openai',
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      extraHeaders: this.extraHeaders,
    })
  }
}

function normalizeFinish(r: string | null): StopReason {
  switch (r) {
    case 'tool_calls': return 'tool_use'
    case 'length': return 'max_tokens'
    case 'stop': return 'end_turn'
    default: return 'end_turn'
  }
}

function toOpenAIMessages(system: string, messages: Message[]): unknown[] {
  const out: any[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      const text = m.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
      out.push({ role: 'user', content: text })
    } else if (m.role === 'assistant') {
      const text = m.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
      const toolCalls = m.content
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }))
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      })
    } else if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolUseId,
        content: m.content,
      })
    }
  }
  return out
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/provider/openai.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/provider/openai.ts test/core/provider/openai.test.ts
git commit -m "feat(core/provider): add OpenAIProvider with event translation"
```

---

### Task 12: Remote model fetch

**Files:**
- Create: `src/core/provider/remoteModels.ts`
- Create: `test/core/provider/remoteModels.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/provider/remoteModels.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { fetchRemoteModels } from '../../../src/core/provider/remoteModels'

const server = setupServer(
  http.get('https://api.openai.example/v1/models', ({ request }) => {
    const auth = request.headers.get('authorization')
    if (auth !== 'Bearer sk-x') return new HttpResponse(null, { status: 401 })
    return HttpResponse.json({
      data: [{ id: 'gpt-5' }, { id: 'gpt-4o' }],
    })
  }),
  http.get('https://api.anthropic.example/v1/models', ({ request }) => {
    const key = request.headers.get('x-api-key')
    if (key !== 'sk-a') return new HttpResponse(null, { status: 401 })
    return HttpResponse.json({
      data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-opus-4-7' }],
    })
  }),
)

beforeAll(() => server.listen())
afterAll(() => server.close())

describe('fetchRemoteModels', () => {
  it('fetches OpenAI-format /v1/models', async () => {
    const models = await fetchRemoteModels({
      format: 'openai',
      baseUrl: 'https://api.openai.example/v1',
      apiKey: 'sk-x',
    })
    expect(models).toEqual(['gpt-5', 'gpt-4o'])
  })

  it('fetches Anthropic-format /v1/models', async () => {
    const models = await fetchRemoteModels({
      format: 'anthropic',
      baseUrl: 'https://api.anthropic.example',
      apiKey: 'sk-a',
    })
    expect(models).toEqual(['claude-sonnet-4-6', 'claude-opus-4-7'])
  })

  it('raises on 401', async () => {
    await expect(
      fetchRemoteModels({
        format: 'openai',
        baseUrl: 'https://api.openai.example/v1',
        apiKey: 'wrong',
      }),
    ).rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/provider/remoteModels.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/provider/remoteModels.ts
const ANTHROPIC_VERSION = '2023-06-01'

export type FetchRemoteModelsOpts = {
  format: 'anthropic' | 'openai'
  baseUrl: string
  apiKey?: string
  extraHeaders?: Record<string, string>
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

export async function fetchRemoteModels(
  opts: FetchRemoteModelsOpts,
): Promise<string[]> {
  const base = trimSlash(opts.baseUrl)
  const endpoints =
    opts.format === 'anthropic'
      ? [`${base}/v1/models`, `${base}/models`]
      : [`${base}/models`, base.endsWith('/v1') ? '' : `${base}/v1/models`].filter(Boolean)

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.extraHeaders ?? {}),
  }
  if (opts.format === 'anthropic') {
    if (opts.apiKey) headers['x-api-key'] = opts.apiKey
    headers['anthropic-version'] = ANTHROPIC_VERSION
  } else if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`
  }

  let lastErr: Error | null = null
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) {
        lastErr = new Error(`${res.status} ${res.statusText} on ${url}`)
        continue
      }
      const body: any = await res.json()
      const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
      return list.map((m: any) => (typeof m === 'string' ? m : m.id)).filter(Boolean)
    } catch (err) {
      lastErr = err as Error
    }
  }
  throw lastErr ?? new Error('no endpoints tried')
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/provider/remoteModels.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/provider/remoteModels.ts test/core/provider/remoteModels.test.ts
git commit -m "feat(core/provider): add remote /v1/models fetcher"
```

---

### Task 13: ProviderResolver

**Files:**
- Create: `src/core/provider/resolver.ts`
- Create: `test/core/provider/resolver.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/provider/resolver.test.ts
import { describe, it, expect } from 'vitest'
import { ProviderResolver } from '../../../src/core/provider/resolver'
import type { Config } from '../../../src/core/config/schema'

const cfg: Config = {
  providers: [
    {
      id: 'p1',
      name: 'Anthropic',
      format: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-a',
      models: ['claude-sonnet-4-6'],
      selectedModel: 'claude-sonnet-4-6',
    },
    {
      id: 'p2',
      name: 'OpenAI',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-o',
      models: ['gpt-5'],
      selectedModel: 'gpt-5',
    },
  ],
  active: { providerId: 'p1' },
}

describe('ProviderResolver', () => {
  it('constructs one provider instance per config entry', () => {
    const r = new ProviderResolver(cfg)
    expect(r.listProviders()).toHaveLength(2)
  })

  it('resolveFor uses session.providerId + session.model', () => {
    const r = new ProviderResolver(cfg)
    const { provider, model } = r.resolveFor({ providerId: 'p2', model: 'gpt-5' } as any)
    expect(provider.id).toBe('p2')
    expect(model).toBe('gpt-5')
  })

  it('listModels returns the provider-specific list', () => {
    const r = new ProviderResolver(cfg)
    expect(r.listModels('p1')).toEqual(['claude-sonnet-4-6'])
    expect(r.listModels('p2')).toEqual(['gpt-5'])
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/provider/resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/provider/resolver.ts
import type { Config, ProviderConfig } from '../config/schema'
import type { LLMProvider } from './types'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'

type SessionLike = { providerId: string; model: string }

export class ProviderResolver {
  private byId = new Map<string, LLMProvider>()
  private configs = new Map<string, ProviderConfig>()

  constructor(cfg: Config) {
    for (const pc of cfg.providers) {
      this.configs.set(pc.id, pc)
      this.byId.set(pc.id, this.buildInstance(pc))
    }
  }

  private buildInstance(pc: ProviderConfig): LLMProvider {
    if (pc.format === 'anthropic') {
      return new AnthropicProvider({
        id: pc.id,
        apiKey: pc.apiKey ?? '',
        baseUrl: pc.baseUrl,
        extraHeaders: pc.extraHeaders,
      })
    }
    return new OpenAIProvider({
      id: pc.id,
      apiKey: pc.apiKey ?? '',
      baseUrl: pc.baseUrl,
      extraHeaders: pc.extraHeaders,
    })
  }

  listProviders(): ProviderConfig[] {
    return [...this.configs.values()]
  }

  listModels(providerId: string): string[] {
    return this.configs.get(providerId)?.models ?? []
  }

  resolveFor(session: SessionLike): { provider: LLMProvider; model: string } {
    const p = this.byId.get(session.providerId)
    if (!p) throw new Error(`Unknown provider: ${session.providerId}`)
    return { provider: p, model: session.model }
  }

  async fetchRemoteModels(providerId: string): Promise<string[]> {
    const p = this.byId.get(providerId)
    if (!p) throw new Error(`Unknown provider: ${providerId}`)
    return p.listRemoteModels()
  }

  getProviderConfig(providerId: string): ProviderConfig | undefined {
    return this.configs.get(providerId)
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/provider/resolver.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/provider/resolver.ts test/core/provider/resolver.test.ts
git commit -m "feat(core/provider): add ProviderResolver"
```

---
## §E · Tools

### Task 14: Tool types and registry

**Files:**
- Create: `src/core/tools/types.ts`
- Create: `src/core/tools/registry.ts`
- Create: `test/core/tools/registry.test.ts`

- [ ] **Step 1: Write types**

```ts
// src/core/tools/types.ts
import type { ToolSpec } from '../provider/types'

export type PermissionHint = 'none' | 'write' | 'exec' | 'network'

export type ToolResult = { output: string; isError: boolean }

export type ToolContext = {
  signal: AbortSignal
  cwd: string
  onProgress?: (msg: string) => void
}

export interface Tool<I = unknown> {
  name: string
  description: string
  parameters: Record<string, unknown>
  source: 'builtin' | 'skill' | 'mcp' | 'plugin'
  needsPermission: (input: I) => PermissionHint
  run: (input: I, ctx: ToolContext) => Promise<ToolResult>
}

export function toToolSpec<I>(t: Tool<I>): ToolSpec {
  return {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }
}
```

- [ ] **Step 2: Write failing test for registry**

```ts
// test/core/tools/registry.test.ts
import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { Tool } from '../../../src/core/tools/types'

const fake: Tool = {
  name: 'Echo',
  description: 'returns input.text',
  parameters: { type: 'object', properties: { text: { type: 'string' } } },
  source: 'builtin',
  needsPermission: () => 'none',
  run: async (input: any) => ({ output: String(input.text ?? ''), isError: false }),
}

describe('ToolRegistry', () => {
  it('registers and looks up by name', () => {
    const r = new ToolRegistry()
    r.register(fake)
    expect(r.find('Echo')).toBe(fake)
    expect(r.find('Nope')).toBeUndefined()
  })

  it('listSpecs returns ToolSpec for each registered tool', () => {
    const r = new ToolRegistry()
    r.register(fake)
    const specs = r.listSpecs()
    expect(specs).toHaveLength(1)
    expect(specs[0].name).toBe('Echo')
  })

  it('throws on duplicate name by default', () => {
    const r = new ToolRegistry()
    r.register(fake)
    expect(() => r.register(fake)).toThrow(/duplicate/)
  })
})
```

- [ ] **Step 3: Run test — expect fail**

Run: `pnpm test test/core/tools/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement registry**

```ts
// src/core/tools/registry.ts
import type { Tool } from './types'
import { toToolSpec } from './types'
import type { ToolSpec } from '../provider/types'

export class ToolRegistry {
  private byName = new Map<string, Tool>()

  register(tool: Tool): void {
    if (this.byName.has(tool.name)) {
      throw new Error(`duplicate tool name: ${tool.name}`)
    }
    this.byName.set(tool.name, tool)
  }

  find(name: string): Tool | undefined {
    return this.byName.get(name)
  }

  list(): Tool[] {
    return [...this.byName.values()]
  }

  listSpecs(): ToolSpec[] {
    return this.list().map(toToolSpec)
  }
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm test test/core/tools/registry.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/core/tools/types.ts src/core/tools/registry.ts test/core/tools/registry.test.ts
git commit -m "feat(core/tools): add Tool interface and registry"
```

---

### Task 15: Read tool

**Files:**
- Create: `src/core/tools/read.ts`
- Create: `test/core/tools/read.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/tools/read.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { ReadTool } from '../../../src/core/tools/read'

function tmp(): string { return mkdtempSync(join(os.tmpdir(), 'nuka-read-')) }

describe('ReadTool', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })

  it('reads a file with cat -n style line numbers', async () => {
    const p = join(dir, 'a.txt')
    writeFileSync(p, 'hello\nworld\n')
    const r = await ReadTool.run({ path: p }, { signal: new AbortController().signal, cwd: dir })
    expect(r.isError).toBe(false)
    expect(r.output).toContain('1\thello')
    expect(r.output).toContain('2\tworld')
  })

  it('supports offset + limit', async () => {
    const p = join(dir, 'b.txt')
    writeFileSync(p, 'a\nb\nc\nd\ne\n')
    const r = await ReadTool.run(
      { path: p, offset: 2, limit: 2 },
      { signal: new AbortController().signal, cwd: dir },
    )
    expect(r.output).toContain('2\tb')
    expect(r.output).toContain('3\tc')
    expect(r.output).not.toContain('d')
  })

  it('returns isError for missing file', async () => {
    const r = await ReadTool.run(
      { path: join(dir, 'missing.txt') },
      { signal: new AbortController().signal, cwd: dir },
    )
    expect(r.isError).toBe(true)
  })

  it('rejects binary files by default', async () => {
    const p = join(dir, 'bin')
    writeFileSync(p, Buffer.from([0, 1, 2, 0, 3]))
    const r = await ReadTool.run({ path: p }, { signal: new AbortController().signal, cwd: dir })
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/binary/i)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/tools/read.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/tools/read.ts
import { readFile } from 'node:fs/promises'
import type { Tool } from './types'

type ReadInput = { path: string; offset?: number; limit?: number }

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(512, buf.length))
  for (const b of sample) if (b === 0) return true
  return false
}

export const ReadTool: Tool<ReadInput> = {
  name: 'Read',
  description: 'Read a text file and return its contents with line numbers.',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      offset: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1 },
    },
  },
  source: 'builtin',
  needsPermission: () => 'none',
  async run(input) {
    try {
      const buf = await readFile(input.path)
      if (looksBinary(buf)) {
        return { isError: true, output: `Refusing to read binary file: ${input.path}` }
      }
      const all = buf.toString('utf8').split('\n')
      const start = Math.max(1, input.offset ?? 1)
      const end = input.limit ? start + input.limit - 1 : all.length
      const rows: string[] = []
      for (let i = start; i <= Math.min(end, all.length); i++) {
        rows.push(`${i}\t${all[i - 1]}`)
      }
      return { isError: false, output: rows.join('\n') }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/tools/read.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/read.ts test/core/tools/read.test.ts
git commit -m "feat(core/tools): add Read tool"
```

---

### Task 16: Write tool

**Files:**
- Create: `src/core/tools/write.ts`
- Create: `test/core/tools/write.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/tools/write.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { WriteTool } from '../../../src/core/tools/write'

function tmp(): string { return mkdtempSync(join(os.tmpdir(), 'nuka-write-')) }
const ctx = { signal: new AbortController().signal, cwd: '/' }

describe('WriteTool', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })

  it('creates a new file and declares write permission', () => {
    expect(WriteTool.needsPermission({ path: '/tmp/x', content: 'a' })).toBe('write')
  })

  it('writes content atomically', async () => {
    const p = join(dir, 'a.txt')
    const r = await WriteTool.run({ path: p, content: 'hi\n' }, ctx)
    expect(r.isError).toBe(false)
    expect(existsSync(p)).toBe(true)
    expect(readFileSync(p, 'utf8')).toBe('hi\n')
  })

  it('errors if parent directory does not exist', async () => {
    const p = join(dir, 'does-not-exist', 'a.txt')
    const r = await WriteTool.run({ path: p, content: 'x' }, ctx)
    expect(r.isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/tools/write.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/tools/write.ts
import { writeFile, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Tool } from './types'

type WriteInput = { path: string; content: string }

export const WriteTool: Tool<WriteInput> = {
  name: 'Write',
  description: 'Write content to a file (atomic; parent dir must exist).',
  parameters: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
  },
  source: 'builtin',
  needsPermission: () => 'write',
  async run(input) {
    try {
      const parent = dirname(input.path)
      await stat(parent) // throws if missing
      const tmp = `${input.path}.${randomBytes(4).toString('hex')}.tmp`
      await writeFile(tmp, input.content, 'utf8')
      await rename(tmp, input.path)
      return { isError: false, output: `wrote ${input.content.length} bytes to ${input.path}` }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/tools/write.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/write.ts test/core/tools/write.test.ts
git commit -m "feat(core/tools): add Write tool"
```

---

### Task 17: Edit tool

**Files:**
- Create: `src/core/tools/edit.ts`
- Create: `test/core/tools/edit.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/tools/edit.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { EditTool } from '../../../src/core/tools/edit'

function tmp(): string { return mkdtempSync(join(os.tmpdir(), 'nuka-edit-')) }
const ctx = { signal: new AbortController().signal, cwd: '/' }

describe('EditTool', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })

  it('replaces a unique occurrence', async () => {
    const p = join(dir, 'a.ts')
    writeFileSync(p, 'const x = 1\nconst y = 2\n')
    const r = await EditTool.run(
      { path: p, old_string: 'const x = 1', new_string: 'const x = 42' },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(readFileSync(p, 'utf8')).toBe('const x = 42\nconst y = 2\n')
  })

  it('errors if old_string appears multiple times and replace_all is false', async () => {
    const p = join(dir, 'a.ts')
    writeFileSync(p, 'x\nx\n')
    const r = await EditTool.run(
      { path: p, old_string: 'x', new_string: 'y' },
      ctx,
    )
    expect(r.isError).toBe(true)
  })

  it('replaces all occurrences when replace_all=true', async () => {
    const p = join(dir, 'a.ts')
    writeFileSync(p, 'x\nx\n')
    const r = await EditTool.run(
      { path: p, old_string: 'x', new_string: 'y', replace_all: true },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(readFileSync(p, 'utf8')).toBe('y\ny\n')
  })

  it('errors if old_string is not found', async () => {
    const p = join(dir, 'a.ts')
    writeFileSync(p, 'hello')
    const r = await EditTool.run(
      { path: p, old_string: 'nope', new_string: 'x' },
      ctx,
    )
    expect(r.isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/tools/edit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/tools/edit.ts
import { readFile, writeFile } from 'node:fs/promises'
import type { Tool } from './types'

type EditInput = {
  path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

function countOccurrences(hay: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let i = 0
  for (;;) {
    const found = hay.indexOf(needle, i)
    if (found === -1) return count
    count++
    i = found + needle.length
  }
}

export const EditTool: Tool<EditInput> = {
  name: 'Edit',
  description: 'Exact string replacement in a file.',
  parameters: {
    type: 'object',
    required: ['path', 'old_string', 'new_string'],
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
  },
  source: 'builtin',
  needsPermission: () => 'write',
  async run(input) {
    try {
      const content = await readFile(input.path, 'utf8')
      const n = countOccurrences(content, input.old_string)
      if (n === 0) {
        return { isError: true, output: `old_string not found in ${input.path}` }
      }
      if (n > 1 && !input.replace_all) {
        return {
          isError: true,
          output: `old_string matches ${n} times; pass replace_all=true or make the pattern unique`,
        }
      }
      const next = input.replace_all
        ? content.split(input.old_string).join(input.new_string)
        : content.replace(input.old_string, input.new_string)
      await writeFile(input.path, next, 'utf8')
      return { isError: false, output: `edited ${input.path}: ${n} replacement(s)` }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/tools/edit.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/edit.ts test/core/tools/edit.test.ts
git commit -m "feat(core/tools): add Edit tool"
```

---

### Task 18: Bash tool

**Files:**
- Create: `src/core/tools/bash.ts`
- Create: `test/core/tools/bash.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/tools/bash.test.ts
import { describe, it, expect } from 'vitest'
import { BashTool } from '../../../src/core/tools/bash'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

describe('BashTool', () => {
  it('runs a simple command and returns stdout', async () => {
    const r = await BashTool.run({ command: "echo hello" }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('hello')
  })

  it('returns isError with non-zero exit', async () => {
    const r = await BashTool.run({ command: "exit 3" }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/exit\s*3/i)
  })

  it('respects timeout', async () => {
    const r = await BashTool.run({ command: "sleep 2", timeout: 100 }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/timed out|killed/i)
  })

  it('declares exec permission', () => {
    expect(BashTool.needsPermission({ command: 'echo' })).toBe('exec')
  })

  it('aborts on signal', async () => {
    const ac = new AbortController()
    const p = BashTool.run({ command: 'sleep 5' }, { ...ctx, signal: ac.signal })
    setTimeout(() => ac.abort(), 50)
    const r = await p
    expect(r.isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/tools/bash.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/tools/bash.ts
import { execa } from 'execa'
import type { Tool } from './types'

type BashInput = { command: string; timeout?: number; cwd?: string }
const DEFAULT_TIMEOUT = 120_000

export const BashTool: Tool<BashInput> = {
  name: 'Bash',
  description: 'Run a shell command and capture its output.',
  parameters: {
    type: 'object',
    required: ['command'],
    properties: {
      command: { type: 'string' },
      timeout: { type: 'integer', minimum: 1 },
      cwd: { type: 'string' },
    },
  },
  source: 'builtin',
  needsPermission: () => 'exec',
  async run(input, ctx) {
    const timeout = input.timeout ?? DEFAULT_TIMEOUT
    try {
      const result = await execa(input.command, {
        shell: true,
        cwd: input.cwd ?? ctx.cwd,
        timeout,
        killSignal: 'SIGKILL',
        reject: false,
        cancelSignal: ctx.signal,
        all: true,
      })
      if (result.timedOut) {
        return { isError: true, output: `timed out after ${timeout}ms\n${result.all ?? ''}` }
      }
      if (result.isCanceled) {
        return { isError: true, output: 'aborted by user' }
      }
      if (result.failed || result.exitCode !== 0) {
        return {
          isError: true,
          output: `exit ${result.exitCode}\n${result.all ?? ''}`,
        }
      }
      return { isError: false, output: result.all ?? '' }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/tools/bash.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/bash.ts test/core/tools/bash.test.ts
git commit -m "feat(core/tools): add Bash tool"
```

---

### Task 19: Glob tool

**Files:**
- Create: `src/core/tools/glob.ts`
- Create: `test/core/tools/glob.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/tools/glob.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { GlobTool } from '../../../src/core/tools/glob'

const ctx = { signal: new AbortController().signal, cwd: '/' }

describe('GlobTool', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'nuka-glob-'))
    mkdirSync(join(dir, 'a'))
    writeFileSync(join(dir, 'a', 'x.ts'), '')
    writeFileSync(join(dir, 'a', 'y.md'), '')
    writeFileSync(join(dir, 'top.ts'), '')
  })

  it('matches extension patterns recursively', async () => {
    const r = await GlobTool.run({ pattern: '**/*.ts', path: dir }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('top.ts')
    expect(r.output).toContain('x.ts')
    expect(r.output).not.toContain('y.md')
  })

  it('returns empty list when nothing matches', async () => {
    const r = await GlobTool.run({ pattern: '**/*.zzz', path: dir }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output.trim()).toBe('')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/tools/glob.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/tools/glob.ts
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import picomatch from 'picomatch'
import type { Tool } from './types'

type GlobInput = { pattern: string; path?: string }

async function walk(root: string, signal: AbortSignal): Promise<{ p: string; mtime: number }[]> {
  const out: { p: string; mtime: number }[] = []
  async function go(dir: string): Promise<void> {
    if (signal.aborted) return
    let entries: string[] = []
    try { entries = await readdir(dir) } catch { return }
    for (const name of entries) {
      if (signal.aborted) return
      if (name === 'node_modules' || name.startsWith('.git')) continue
      const full = join(dir, name)
      let st
      try { st = await stat(full) } catch { continue }
      if (st.isDirectory()) await go(full)
      else out.push({ p: full, mtime: st.mtimeMs })
    }
  }
  await go(root)
  return out
}

export const GlobTool: Tool<GlobInput> = {
  name: 'Glob',
  description: 'List files matching a glob pattern, sorted by mtime desc.',
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
    },
  },
  source: 'builtin',
  needsPermission: () => 'none',
  async run(input, ctx) {
    const root = input.path ?? ctx.cwd
    try {
      const entries = await walk(root, ctx.signal)
      const isMatch = picomatch(input.pattern, { dot: false })
      const matched = entries
        .filter(e => isMatch(e.p.slice(root.length + 1).replace(/\\/g, '/')))
        .sort((a, b) => b.mtime - a.mtime)
        .map(e => e.p)
      return { isError: false, output: matched.join('\n') }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/tools/glob.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/glob.ts test/core/tools/glob.test.ts
git commit -m "feat(core/tools): add Glob tool"
```

---

### Task 20: Grep tool

**Files:**
- Create: `src/core/tools/grep.ts`
- Create: `test/core/tools/grep.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/tools/grep.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { GrepTool } from '../../../src/core/tools/grep'

const ctx = { signal: new AbortController().signal, cwd: '/' }

describe('GrepTool', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'nuka-grep-'))
    writeFileSync(join(dir, 'a.ts'), 'export function foo() {}\nexport const bar = 1\n')
    writeFileSync(join(dir, 'b.ts'), 'const baz = 2\n')
  })

  it('finds literal matches with default files_with_matches output', async () => {
    const r = await GrepTool.run({ pattern: 'foo', path: dir }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('a.ts')
    expect(r.output).not.toContain('b.ts')
  })

  it('supports output_mode="content"', async () => {
    const r = await GrepTool.run(
      { pattern: 'bar', path: dir, output_mode: 'content' },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(r.output).toMatch(/bar\s*=\s*1/)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/tools/grep.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement (shell out to ripgrep if available, else naive fallback)**

```ts
// src/core/tools/grep.ts
import { execa } from 'execa'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tool } from './types'

type GrepInput = {
  pattern: string
  path?: string
  glob?: string
  type?: string
  output_mode?: 'files_with_matches' | 'content' | 'count'
}

async function haveRg(): Promise<boolean> {
  try {
    await execa('rg', ['--version'], { reject: false })
    return true
  } catch {
    return false
  }
}

async function fallback(input: GrepInput, cwd: string): Promise<{ output: string; isError: boolean }> {
  const root = input.path ?? cwd
  const re = new RegExp(input.pattern)
  const matches: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: string[] = []
    try { entries = await readdir(dir) } catch { return }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.git')) continue
      const full = join(dir, name)
      let st
      try { st = await stat(full) } catch { continue }
      if (st.isDirectory()) await walk(full)
      else {
        try {
          const text = await readFile(full, 'utf8')
          const hits = text.split('\n').map((line, i) => ({ line, i: i + 1 })).filter(r => re.test(r.line))
          if (hits.length > 0) {
            if (input.output_mode === 'content') {
              for (const h of hits) matches.push(`${full}:${h.i}: ${h.line}`)
            } else if (input.output_mode === 'count') {
              matches.push(`${full}:${hits.length}`)
            } else {
              matches.push(full)
            }
          }
        } catch { /* not utf8 */ }
      }
    }
  }
  await walk(root)
  return { isError: false, output: matches.join('\n') }
}

export const GrepTool: Tool<GrepInput> = {
  name: 'Grep',
  description: 'Search file contents using ripgrep (falls back to a naive scanner).',
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
      glob: { type: 'string' },
      type: { type: 'string' },
      output_mode: { type: 'string', enum: ['files_with_matches', 'content', 'count'] },
    },
  },
  source: 'builtin',
  needsPermission: () => 'none',
  async run(input, ctx) {
    const root = input.path ?? ctx.cwd
    try {
      if (!(await haveRg())) return fallback(input, ctx.cwd)
      const args: string[] = []
      if (input.output_mode === 'files_with_matches' || !input.output_mode) args.push('-l')
      else if (input.output_mode === 'count') args.push('-c')
      if (input.glob) args.push('--glob', input.glob)
      if (input.type) args.push('--type', input.type)
      args.push(input.pattern, root)
      const res = await execa('rg', args, { reject: false, cancelSignal: ctx.signal })
      if (res.exitCode !== 0 && res.exitCode !== 1) {
        return { isError: true, output: res.stderr || `rg exit ${res.exitCode}` }
      }
      return { isError: false, output: res.stdout }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/tools/grep.test.ts`
Expected: 2 passed (may use fallback if rg is missing; test still passes).

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/grep.ts test/core/tools/grep.test.ts
git commit -m "feat(core/tools): add Grep tool"
```

---
## §F · Permission

### Task 21: Permission types + glob pattern suggestion

**Files:**
- Create: `src/core/permission/types.ts`
- Create: `src/core/permission/suggest.ts`
- Create: `test/core/permission/suggest.test.ts`

- [ ] **Step 1: Write types**

```ts
// src/core/permission/types.ts
import type { PermissionHint } from '../tools/types'
export type { PermissionHint }

export type PermissionRule = {
  scope: 'once' | 'session' | 'pattern'
  hint: PermissionHint
  pattern?: string
}

export type PermissionDecision = {
  allowed: boolean
  reason?: string
  remember?: PermissionRule
}

export type PermissionCall = {
  toolName: string
  hint: PermissionHint
  input: unknown
}
```

- [ ] **Step 2: Write failing test for suggest**

```ts
// test/core/permission/suggest.test.ts
import { describe, it, expect } from 'vitest'
import { suggestPattern } from '../../../src/core/permission/suggest'

describe('suggestPattern', () => {
  it('suggests a prefix glob from a file path for write hint', () => {
    expect(
      suggestPattern({
        toolName: 'Write',
        hint: 'write',
        input: { path: 'src/provider/openai.ts', content: '' },
      }),
    ).toBe('src/provider/**')
  })

  it('suggests a command-head glob for exec hint', () => {
    expect(
      suggestPattern({
        toolName: 'Bash',
        hint: 'exec',
        input: { command: 'npm test -- --coverage' },
      }),
    ).toBe('npm *')
  })

  it('returns undefined when nothing natural suggests', () => {
    expect(
      suggestPattern({ toolName: 'Grep', hint: 'none', input: {} }),
    ).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test — expect fail**

Run: `pnpm test test/core/permission/suggest.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

```ts
// src/core/permission/suggest.ts
import type { PermissionCall } from './types'

export function suggestPattern(call: PermissionCall): string | undefined {
  if (call.hint === 'write') {
    const path = (call.input as any)?.path
    if (typeof path === 'string') {
      const parts = path.split('/')
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}/**`
      return `${parts[0]}/**`
    }
  }
  if (call.hint === 'exec') {
    const cmd = (call.input as any)?.command
    if (typeof cmd === 'string') {
      const head = cmd.trim().split(/\s+/)[0]
      if (head) return `${head} *`
    }
  }
  return undefined
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm test test/core/permission/suggest.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/core/permission/types.ts src/core/permission/suggest.ts test/core/permission/suggest.test.ts
git commit -m "feat(core/permission): add types and pattern suggestion"
```

---

### Task 22: Permission cache (session + pattern)

**Files:**
- Create: `src/core/permission/cache.ts`
- Create: `test/core/permission/cache.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/permission/cache.test.ts
import { describe, it, expect } from 'vitest'
import { PermissionCache } from '../../../src/core/permission/cache'

describe('PermissionCache', () => {
  it('matches session-scope rules by hint', () => {
    const c = new PermissionCache()
    c.add({ scope: 'session', hint: 'write' })
    expect(c.isAllowed({ toolName: 'Write', hint: 'write', input: { path: 'a/b.ts' } })).toBe(true)
    expect(c.isAllowed({ toolName: 'Bash', hint: 'exec', input: { command: 'x' } })).toBe(false)
  })

  it('matches pattern-scope rules by glob against path (write) or command (exec)', () => {
    const c = new PermissionCache()
    c.add({ scope: 'pattern', hint: 'write', pattern: 'src/**' })
    c.add({ scope: 'pattern', hint: 'exec', pattern: 'npm *' })
    expect(c.isAllowed({ toolName: 'Write', hint: 'write', input: { path: 'src/a.ts' } })).toBe(true)
    expect(c.isAllowed({ toolName: 'Write', hint: 'write', input: { path: 'other/a.ts' } })).toBe(false)
    expect(c.isAllowed({ toolName: 'Bash', hint: 'exec', input: { command: 'npm test' } })).toBe(true)
    expect(c.isAllowed({ toolName: 'Bash', hint: 'exec', input: { command: 'rm -rf /' } })).toBe(false)
  })

  it('once-scope rules never stay in the cache (they are fulfilled inline and not added)', () => {
    const c = new PermissionCache()
    c.add({ scope: 'once', hint: 'write' })
    expect(c.isAllowed({ toolName: 'Write', hint: 'write', input: { path: 'a' } })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/permission/cache.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/permission/cache.ts
import picomatch from 'picomatch'
import type { PermissionCall, PermissionRule } from './types'

function subjectFor(call: PermissionCall): string | undefined {
  if (call.hint === 'write') return (call.input as any)?.path
  if (call.hint === 'exec') return (call.input as any)?.command
  return undefined
}

export class PermissionCache {
  private rules: PermissionRule[] = []

  add(rule: PermissionRule): void {
    if (rule.scope === 'once') return
    this.rules.push(rule)
  }

  isAllowed(call: PermissionCall): boolean {
    for (const r of this.rules) {
      if (r.hint !== call.hint) continue
      if (r.scope === 'session') return true
      if (r.scope === 'pattern' && r.pattern) {
        const subj = subjectFor(call)
        if (!subj) continue
        if (picomatch(r.pattern)(subj)) return true
      }
    }
    return false
  }

  list(): PermissionRule[] {
    return [...this.rules]
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/permission/cache.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/permission/cache.ts test/core/permission/cache.test.ts
git commit -m "feat(core/permission): add permission cache with glob matching"
```

---

### Task 23: PermissionChecker (ties cache + UI callback)

**Files:**
- Create: `src/core/permission/checker.ts`
- Create: `test/core/permission/checker.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/permission/checker.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'

describe('PermissionChecker', () => {
  it('auto-allows hint=none without prompting', async () => {
    const ask = vi.fn()
    const checker = new PermissionChecker(new PermissionCache(), ask)
    const d = await checker.check({ toolName: 'Read', hint: 'none', input: {} })
    expect(d.allowed).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('auto-allows when cache covers the call', async () => {
    const cache = new PermissionCache()
    cache.add({ scope: 'session', hint: 'write' })
    const ask = vi.fn()
    const checker = new PermissionChecker(cache, ask)
    const d = await checker.check({ toolName: 'Write', hint: 'write', input: { path: 'a' } })
    expect(d.allowed).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('prompts via UI callback when no rule covers the call; stores remember', async () => {
    const cache = new PermissionCache()
    const ask = vi.fn().mockResolvedValue({
      allowed: true,
      remember: { scope: 'session', hint: 'write' },
    })
    const checker = new PermissionChecker(cache, ask)
    const d = await checker.check({ toolName: 'Write', hint: 'write', input: { path: 'a' } })
    expect(d.allowed).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    expect(cache.list()).toHaveLength(1)
  })

  it('propagates rejection', async () => {
    const ask = vi.fn().mockResolvedValue({ allowed: false, reason: 'no' })
    const checker = new PermissionChecker(new PermissionCache(), ask)
    const d = await checker.check({ toolName: 'Bash', hint: 'exec', input: { command: 'x' } })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('no')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/permission/checker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/permission/checker.ts
import type { PermissionCache } from './cache'
import type { PermissionCall, PermissionDecision } from './types'

export type AskUser = (call: PermissionCall) => Promise<PermissionDecision>

export class PermissionChecker {
  constructor(
    private cache: PermissionCache,
    private askUser: AskUser,
  ) {}

  async check(call: PermissionCall): Promise<PermissionDecision> {
    if (call.hint === 'none') return { allowed: true }
    if (this.cache.isAllowed(call)) return { allowed: true }
    const decision = await this.askUser(call)
    if (decision.allowed && decision.remember) {
      this.cache.add(decision.remember)
    }
    return decision
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/permission/checker.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/permission/checker.ts test/core/permission/checker.test.ts
git commit -m "feat(core/permission): add PermissionChecker"
```

---
## §G · Session

### Task 24: Session types + MessageQueue

**Files:**
- Create: `src/core/session/types.ts`
- Create: `src/core/session/queue.ts`
- Create: `test/core/session/queue.test.ts`

- [ ] **Step 1: Write types**

```ts
// src/core/session/types.ts
import type { Message, TokenUsage } from '../message/types'
import type { PermissionRule } from '../permission/types'
import type { MessageQueue } from './queue'

export type SessionMode = 'normal' | 'plan' | 'bypass'

export type Session = {
  id: string
  parentId?: string
  providerId: string
  model: string
  messages: Message[]
  totalUsage: TokenUsage
  permissionCache: PermissionRule[]
  queue: MessageQueue
  mode: SessionMode
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 2: Write failing test**

```ts
// test/core/session/queue.test.ts
import { describe, it, expect } from 'vitest'
import { MessageQueue } from '../../../src/core/session/queue'

describe('MessageQueue', () => {
  it('reports hasPending and drains fifo', () => {
    const q = new MessageQueue()
    expect(q.hasPending()).toBe(false)
    q.push('a'); q.push('b')
    expect(q.hasPending()).toBe(true)
    expect(q.drain()).toEqual(['a', 'b'])
    expect(q.hasPending()).toBe(false)
  })

  it('drain empties the queue', () => {
    const q = new MessageQueue()
    q.push('x')
    q.drain()
    expect(q.drain()).toEqual([])
  })

  it('size reports pending count', () => {
    const q = new MessageQueue()
    q.push('a'); q.push('b'); q.push('c')
    expect(q.size()).toBe(3)
  })
})
```

- [ ] **Step 3: Run test — expect fail**

Run: `pnpm test test/core/session/queue.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

```ts
// src/core/session/queue.ts
export class MessageQueue {
  private buf: string[] = []
  push(text: string): void { this.buf.push(text) }
  hasPending(): boolean { return this.buf.length > 0 }
  size(): number { return this.buf.length }
  drain(): string[] {
    const out = this.buf
    this.buf = []
    return out
  }
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm test test/core/session/queue.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/core/session/types.ts src/core/session/queue.ts test/core/session/queue.test.ts
git commit -m "feat(core/session): add Session types and MessageQueue"
```

---

### Task 25: Session factory

**Files:**
- Create: `src/core/session/session.ts`
- Create: `test/core/session/session.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/session/session.test.ts
import { describe, it, expect } from 'vitest'
import { createSession, branchSession } from '../../../src/core/session/session'

describe('session factory', () => {
  it('createSession initializes messages empty with given provider/model', () => {
    const s = createSession({ providerId: 'p1', model: 'x' })
    expect(s.providerId).toBe('p1')
    expect(s.model).toBe('x')
    expect(s.messages).toEqual([])
    expect(s.totalUsage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(s.mode).toBe('normal')
    expect(s.parentId).toBeUndefined()
  })

  it('branchSession deep-clones messages and links parentId', () => {
    const parent = createSession({ providerId: 'p1', model: 'x' })
    parent.messages.push({
      role: 'user',
      id: 'u1',
      ts: 1,
      content: [{ type: 'text', text: 'hi' }],
    })
    const child = branchSession(parent)
    expect(child.parentId).toBe(parent.id)
    expect(child.messages).toHaveLength(1)
    // mutating child should not affect parent
    child.messages.push({ role: 'user', id: 'u2', ts: 2, content: [] })
    expect(parent.messages).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/session/session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/session/session.ts
import { ulid } from 'ulid'
import type { Session } from './types'
import { MessageQueue } from './queue'

export function createSession(opts: { providerId: string; model: string }): Session {
  return {
    id: ulid(),
    providerId: opts.providerId,
    model: opts.model,
    messages: [],
    totalUsage: { inputTokens: 0, outputTokens: 0 },
    permissionCache: [],
    queue: new MessageQueue(),
    mode: 'normal',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function branchSession(parent: Session): Session {
  const child = createSession({
    providerId: parent.providerId,
    model: parent.model,
  })
  child.parentId = parent.id
  child.messages = JSON.parse(JSON.stringify(parent.messages))
  child.totalUsage = { ...parent.totalUsage }
  child.permissionCache = parent.permissionCache.map(r => ({ ...r }))
  child.mode = parent.mode
  return child
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/session/session.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/session/session.ts test/core/session/session.test.ts
git commit -m "feat(core/session): add createSession + branchSession"
```

---

### Task 26: SessionManager

**Files:**
- Create: `src/core/session/manager.ts`
- Create: `test/core/session/manager.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/session/manager.test.ts
import { describe, it, expect } from 'vitest'
import { SessionManager } from '../../../src/core/session/manager'

describe('SessionManager', () => {
  it('start creates and activates an initial session', () => {
    const m = new SessionManager()
    const s = m.start({ providerId: 'p', model: 'x' })
    expect(m.active()).toBe(s)
    expect(m.list()).toEqual([s])
  })

  it('new() adds a fresh session and makes it active; old session is preserved', () => {
    const m = new SessionManager()
    const a = m.start({ providerId: 'p', model: 'x' })
    const b = m.new()
    expect(m.active()).toBe(b)
    expect(m.list()).toEqual([a, b])
  })

  it('branch() forks active, makes fork active, preserves parent', () => {
    const m = new SessionManager()
    const a = m.start({ providerId: 'p', model: 'x' })
    a.messages.push({ role: 'user', id: 'u', ts: 1, content: [] })
    const b = m.branch()
    expect(b.parentId).toBe(a.id)
    expect(m.active()).toBe(b)
    expect(m.list()).toHaveLength(2)
  })

  it('switch(id) changes active without mutating list order', () => {
    const m = new SessionManager()
    const a = m.start({ providerId: 'p', model: 'x' })
    const b = m.new()
    m.switch(a.id)
    expect(m.active()).toBe(a)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/session/manager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/session/manager.ts
import type { Session } from './types'
import { createSession, branchSession } from './session'

export class SessionManager {
  private sessions: Session[] = []
  private activeId: string | undefined

  start(opts: { providerId: string; model: string }): Session {
    const s = createSession(opts)
    this.sessions.push(s)
    this.activeId = s.id
    return s
  }

  new(): Session {
    const base = this.active()
    const s = createSession({
      providerId: base?.providerId ?? '',
      model: base?.model ?? '',
    })
    this.sessions.push(s)
    this.activeId = s.id
    return s
  }

  branch(): Session {
    const base = this.active()
    if (!base) throw new Error('no active session to branch from')
    const forked = branchSession(base)
    this.sessions.push(forked)
    this.activeId = forked.id
    return forked
  }

  switch(id: string): Session {
    const s = this.sessions.find(x => x.id === id)
    if (!s) throw new Error(`unknown session: ${id}`)
    this.activeId = id
    return s
  }

  active(): Session | undefined {
    return this.sessions.find(s => s.id === this.activeId)
  }

  list(): Session[] {
    return [...this.sessions]
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/session/manager.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/session/manager.ts test/core/session/manager.test.ts
git commit -m "feat(core/session): add SessionManager"
```

---

### Task 27: Telemetry (cost + git branch)

**Files:**
- Create: `src/core/session/telemetry.ts`
- Create: `test/core/session/telemetry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/session/telemetry.test.ts
import { describe, it, expect } from 'vitest'
import { computeCost, addUsage } from '../../../src/core/session/telemetry'
import type { ProviderConfig } from '../../../src/core/config/schema'

const provider: ProviderConfig = {
  id: 'p', name: 'x', format: 'openai', baseUrl: 'https://x', models: ['m1'],
  pricing: { m1: { input: 3, output: 15 } },
}

describe('telemetry', () => {
  it('addUsage accumulates input/output tokens', () => {
    const acc = { inputTokens: 10, outputTokens: 5 }
    const next = addUsage(acc, { inputTokens: 2, outputTokens: 3 })
    expect(next).toEqual({ inputTokens: 12, outputTokens: 8 })
  })

  it('computeCost uses the provider pricing table keyed by model', () => {
    const cost = computeCost(
      provider,
      'm1',
      { inputTokens: 1_000_000, outputTokens: 500_000 },
    )
    // 3.00 * 1 + 15.00 * 0.5 = 10.5
    expect(cost).toBeCloseTo(10.5, 2)
  })

  it('computeCost returns 0 when pricing is missing', () => {
    expect(
      computeCost(
        { ...provider, pricing: undefined },
        'm1',
        { inputTokens: 1000, outputTokens: 1000 },
      ),
    ).toBe(0)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/session/telemetry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/session/telemetry.ts
import { execSync } from 'node:child_process'
import type { TokenUsage } from '../message/types'
import type { ProviderConfig } from '../config/schema'

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) || undefined,
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) || undefined,
  }
}

export function computeCost(
  provider: ProviderConfig,
  modelId: string,
  usage: TokenUsage,
): number {
  const rate = provider.pricing?.[modelId]
  if (!rate) return 0
  const input = (usage.inputTokens / 1_000_000) * rate.input
  const output = (usage.outputTokens / 1_000_000) * rate.output
  const cacheRead = rate.cacheRead
    ? ((usage.cacheReadTokens ?? 0) / 1_000_000) * rate.cacheRead
    : 0
  const cacheWrite = rate.cacheWrite
    ? ((usage.cacheWriteTokens ?? 0) / 1_000_000) * rate.cacheWrite
    : 0
  return input + output + cacheRead + cacheWrite
}

export function currentGitBranch(cwd: string): { branch: string; dirty: boolean } | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
    const statusLen = execSync('git status --porcelain', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().length
    return { branch, dirty: statusLen > 0 }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/session/telemetry.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/session/telemetry.ts test/core/session/telemetry.test.ts
git commit -m "feat(core/session): add telemetry (cost + git branch)"
```

---
## §H · Agent Loop + Compact

### Task 28: System prompt builder

**Files:**
- Create: `src/core/agent/systemPrompt.ts`
- Create: `test/core/agent/systemPrompt.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/agent/systemPrompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../../src/core/agent/systemPrompt'

describe('buildSystemPrompt', () => {
  it('includes identity, cwd, and tool guidance sections', () => {
    const s = buildSystemPrompt({
      cwd: '/tmp/proj',
      platform: 'linux',
      shell: '/bin/bash',
      nodeVersion: 'v20.10.0',
      gitBranch: { branch: 'main', dirty: false },
    })
    expect(s).toMatch(/You are Nuka/i)
    expect(s).toContain('/tmp/proj')
    expect(s).toContain('linux')
    expect(s).toMatch(/main/)
    expect(s).toMatch(/tool/i)
  })

  it('handles missing git branch gracefully', () => {
    const s = buildSystemPrompt({
      cwd: '/x',
      platform: 'darwin',
      shell: '/bin/zsh',
      nodeVersion: 'v18.0.0',
      gitBranch: null,
    })
    expect(s).not.toContain('null')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/agent/systemPrompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/agent/systemPrompt.ts
export type SystemPromptInput = {
  cwd: string
  platform: string
  shell: string
  nodeVersion: string
  gitBranch: { branch: string; dirty: boolean } | null
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const git = input.gitBranch
    ? `git: ${input.gitBranch.branch}${input.gitBranch.dirty ? ' (dirty)' : ''}`
    : 'git: (not a git repository)'
  return [
    'You are Nuka, a terminal coding agent. Be concise. Act. Ask before destructive changes.',
    '',
    'Environment:',
    `  cwd: ${input.cwd}`,
    `  platform: ${input.platform}`,
    `  shell: ${input.shell}`,
    `  node: ${input.nodeVersion}`,
    `  ${git}`,
    '',
    'Tool usage:',
    '  - Use tools to read files, edit files, and run commands rather than guessing.',
    '  - Prefer Edit for targeted changes; Write when creating new files.',
    '  - Announce destructive shell commands before executing them.',
    '  - Report results briefly; let the user review diffs and outputs.',
  ].join('\n')
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/agent/systemPrompt.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/systemPrompt.ts test/core/agent/systemPrompt.test.ts
git commit -m "feat(core/agent): add system prompt builder"
```

---

### Task 29: Agent loop (runAgent)

**Files:**
- Create: `src/core/agent/events.ts`
- Create: `src/core/agent/loop.ts`
- Create: `test/core/agent/loop.test.ts`

- [ ] **Step 1: Write event types**

```ts
// src/core/agent/events.ts
import type { StopReason, TokenUsage } from '../message/types'

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'turn_end'; usage: TokenUsage; stopReason: StopReason }
  | { type: 'queued_message_flushed'; count: number }
  | { type: 'error'; error: Error }
```

- [ ] **Step 2: Write failing test for the loop**

```ts
// test/core/agent/loop.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { Tool } from '../../../src/core/tools/types'

function stubProvider(scripts: ProviderEvent[][]): LLMProvider {
  let i = 0
  return {
    id: 'p', format: 'openai',
    async *stream() {
      const script = scripts[i++] ?? []
      for (const ev of script) yield ev
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

describe('runAgent', () => {
  it('ends on a text-only turn', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const provider = stubProvider([[
      { type: 'text_delta', text: 'hi' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]])
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(new PermissionCache(), async () => ({ allowed: true }))

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'hi' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    expect(events.at(-1)).toEqual({
      type: 'turn_end',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    expect(session.messages).toHaveLength(2) // user + assistant
  })

  it('runs a tool call then continues the loop until text-only turn', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })

    // Turn 1: assistant emits a tool call
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 't1', name: 'Echo' },
      { type: 'tool_use_args_delta', id: 't1', delta: '{"text":"ok"}' },
      { type: 'tool_use_stop', id: 't1', input: { text: 'ok' } },
      {
        type: 'message_stop',
        stopReason: 'tool_use',
        usage: { inputTokens: 5, outputTokens: 3 },
      },
    ]
    // Turn 2: assistant replies and stops
    const turn2: ProviderEvent[] = [
      { type: 'text_delta', text: 'done' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 2, outputTokens: 1 },
      },
    ]
    const provider = stubProvider([turn1, turn2])

    const tools = new ToolRegistry()
    const echo: Tool<{ text: string }> = {
      name: 'Echo',
      description: 'echo',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
      source: 'builtin',
      needsPermission: () => 'none',
      run: async (i) => ({ output: i.text, isError: false }),
    }
    tools.register(echo)

    const permission = new PermissionChecker(new PermissionCache(), async () => ({ allowed: true }))

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'please echo' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    const types = events.map(e => e.type)
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_result')
    expect(events.at(-1).type).toBe('turn_end')
  })

  it('flushes queued messages at turn boundary', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.queue.push('btw')
    // Turn 1: tool call forces another turn
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 't1', name: 'Echo' },
      { type: 'tool_use_stop', id: 't1', input: { text: 'x' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    // Turn 2: ends plainly
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    tools.register({
      name: 'Echo', description: 'e', parameters: {}, source: 'builtin',
      needsPermission: () => 'none',
      run: async () => ({ output: '', isError: false }),
    })
    const permission = new PermissionChecker(new PermissionCache(), async () => ({ allowed: true }))
    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'hi' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)
    expect(events.some(e => e.type === 'queued_message_flushed' && e.count === 1)).toBe(true)
  })
})
```

- [ ] **Step 3: Run test — expect fail**

Run: `pnpm test test/core/agent/loop.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the loop**

```ts
// src/core/agent/loop.ts
import type { Session } from '../session/types'
import type { AgentEvent } from './events'
import type { ProviderEvent } from '../provider/types'
import type { ProviderResolver } from '../provider/resolver'
import type { ToolRegistry } from '../tools/registry'
import type { PermissionChecker } from '../permission/checker'
import { makeUserMessage, makeToolMessage, emptyAssistant } from '../message/factories'
import { buildSystemPrompt } from './systemPrompt'
import { addUsage } from '../session/telemetry'
import type { AssistantMessage, ContentBlock } from '../message/types'

export type RunAgentDeps = {
  provider: ProviderResolver
  tools: ToolRegistry
  permission: PermissionChecker
  systemPromptInput?: () => Parameters<typeof buildSystemPrompt>[0]
}

function extractToolCalls(m: AssistantMessage): Array<{ id: string; name: string; input: unknown }> {
  return m.content.flatMap(b =>
    b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [],
  )
}

function applyToAssistant(m: AssistantMessage, ev: ProviderEvent): void {
  if (ev.type === 'text_delta') {
    const last = m.content[m.content.length - 1]
    if (last && last.type === 'text') last.text += ev.text
    else m.content.push({ type: 'text', text: ev.text } as ContentBlock)
  } else if (ev.type === 'tool_use_start') {
    m.content.push({ type: 'tool_use', id: ev.id, name: ev.name, input: {} })
  } else if (ev.type === 'tool_use_stop') {
    for (let i = m.content.length - 1; i >= 0; i--) {
      const b = m.content[i]
      if (b.type === 'tool_use' && b.id === ev.id) { b.input = ev.input; break }
    }
  } else if (ev.type === 'message_stop') {
    m.usage = ev.usage
    m.stopReason = ev.stopReason
  }
}

export async function* runAgent(
  input: { text: string },
  session: Session,
  deps: RunAgentDeps,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  session.messages.push(makeUserMessage(input))

  while (!signal.aborted) {
    const { provider, model } = deps.provider.resolveFor(session)
    const system = deps.systemPromptInput
      ? buildSystemPrompt(deps.systemPromptInput())
      : ''
    const stream = provider.stream(
      {
        model,
        system,
        messages: session.messages,
        tools: deps.tools.listSpecs(),
      },
      signal,
    )

    const assistant = emptyAssistant()
    for await (const ev of stream) {
      if (ev.type === 'text_delta') yield { type: 'text_delta', text: ev.text }
      applyToAssistant(assistant, ev)
    }
    session.messages.push(assistant)
    if (assistant.usage) session.totalUsage = addUsage(session.totalUsage, assistant.usage)

    const calls = extractToolCalls(assistant)
    if (calls.length === 0) {
      yield {
        type: 'turn_end',
        stopReason: assistant.stopReason ?? 'end_turn',
        usage: assistant.usage ?? { inputTokens: 0, outputTokens: 0 },
      }
      break
    }

    for (const call of calls) {
      if (signal.aborted) break
      const tool = deps.tools.find(call.name)
      if (!tool) {
        yield { type: 'tool_result', id: call.id, output: `Unknown tool: ${call.name}`, isError: true }
        session.messages.push(makeToolMessage(call.id, { output: `Unknown tool: ${call.name}`, isError: true }))
        continue
      }
      yield { type: 'tool_call', id: call.id, name: call.name, input: call.input }
      const decision = await deps.permission.check({
        toolName: tool.name,
        hint: tool.needsPermission(call.input),
        input: call.input,
      })
      if (decision.remember) session.permissionCache.push(decision.remember)
      const result = decision.allowed
        ? await tool.run(call.input, { signal, cwd: process.cwd() })
        : { output: `Rejected: ${decision.reason ?? 'user denied'}`, isError: true }
      session.messages.push(makeToolMessage(call.id, result))
      yield { type: 'tool_result', id: call.id, output: result.output, isError: result.isError }
    }

    const drained = session.queue.drain()
    if (drained.length > 0) {
      session.messages.push(makeUserMessage({ text: drained.join('\n\n') }))
      yield { type: 'queued_message_flushed', count: drained.length }
    }
  }
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm test test/core/agent/loop.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/core/agent/events.ts src/core/agent/loop.ts test/core/agent/loop.test.ts
git commit -m "feat(core/agent): add runAgent loop with tool-use and queue flush"
```

---

### Task 30: Real LLM-backed /compact

**Files:**
- Create: `src/core/compact/compact.ts`
- Create: `test/core/compact/compact.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/core/compact/compact.test.ts
import { describe, it, expect } from 'vitest'
import { compactSession, COMPACT_SUMMARY_MARKER } from '../../../src/core/compact/compact'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'

function stub(text: string): LLMProvider {
  return {
    id: 'p', format: 'openai',
    async *stream(): AsyncIterable<ProviderEvent> {
      yield { type: 'text_delta', text }
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
      }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

describe('compactSession', () => {
  it('replaces older messages with a single compact summary, preserves keepTurns most recent', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    for (let i = 0; i < 6; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}` }] })
    }
    expect(s.messages).toHaveLength(12)

    const before = s.messages.slice(-6) // last 3 turns
    await compactSession(s, { provider: stub('SUMMARY'), model: 'm', keepTurns: 3 })

    // 1 summary + last 6 messages = 7
    expect(s.messages).toHaveLength(7)
    const first = s.messages[0]
    expect(first.role).toBe('assistant')
    if (first.role === 'assistant') {
      const text = first.content.map((b: any) => b.text ?? '').join('')
      expect(text).toContain(COMPACT_SUMMARY_MARKER)
      expect(text).toContain('SUMMARY')
    }
    expect(s.messages.slice(1)).toEqual(before)
  })

  it('is a no-op when message count is already within the keep window', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.messages.push({ role: 'user', id: 'u', ts: 1, content: [{ type: 'text', text: 'hi' }] })
    const before = s.messages.length
    await compactSession(s, { provider: stub('X'), model: 'm', keepTurns: 3 })
    expect(s.messages.length).toBe(before)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/compact/compact.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/core/compact/compact.ts
import type { Session } from '../session/types'
import type { LLMProvider } from '../provider/types'
import type { AssistantMessage, Message } from '../message/types'
import { ulid } from 'ulid'

export const COMPACT_SUMMARY_MARKER = '[[compact-summary]]'

const COMPACT_SYSTEM = `You are a session summarizer for an AI coding assistant.
Produce a tight summary of the conversation so far. Cover:
  - User goals and any constraints
  - Decisions made
  - File paths touched and their current state
  - Tool calls and their outcomes
  - Open questions and pending TODOs
Keep it factual, under ~500 tokens. No preamble. No apologies.`

export type CompactOpts = {
  provider: LLMProvider
  model: string
  keepTurns?: number
}

function turnBoundaries(messages: Message[]): number[] {
  // Each user message starts a turn
  const idx: number[] = []
  messages.forEach((m, i) => { if (m.role === 'user') idx.push(i) })
  return idx
}

export async function compactSession(session: Session, opts: CompactOpts): Promise<void> {
  const keepTurns = opts.keepTurns ?? 3
  const boundaries = turnBoundaries(session.messages)
  if (boundaries.length <= keepTurns) return

  const cutIndex = boundaries[boundaries.length - keepTurns]
  const older = session.messages.slice(0, cutIndex)
  const kept = session.messages.slice(cutIndex)

  let summaryText = ''
  const stream = opts.provider.stream(
    {
      model: opts.model,
      system: COMPACT_SYSTEM,
      messages: older,
      tools: [],
      maxTokens: 800,
    },
    new AbortController().signal,
  )
  for await (const ev of stream) {
    if (ev.type === 'text_delta') summaryText += ev.text
  }

  const summary: AssistantMessage = {
    role: 'assistant',
    id: ulid(),
    ts: Date.now(),
    content: [
      {
        type: 'text',
        text: `${COMPACT_SUMMARY_MARKER}\n${summaryText.trim()}`,
      },
    ],
  }

  session.messages = [summary, ...kept]
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/compact/compact.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/compact/compact.ts test/core/compact/compact.test.ts
git commit -m "feat(core/compact): add real LLM-backed session compactor"
```

---
## §I · Slash Commands

### Task 31: SlashCommand types + registry

**Files:**
- Create: `src/slash/types.ts`
- Create: `src/slash/registry.ts`
- Create: `test/slash/registry.test.ts`

- [ ] **Step 1: Write types**

```ts
// src/slash/types.ts
import type { SessionManager } from '../core/session/manager'
import type { ProviderResolver } from '../core/provider/resolver'
import type { Config } from '../core/config/schema'

export type DialogDescriptor =
  | { kind: 'model-picker' }
  | { kind: 'config-editor' }

export type SessionEffect =
  | { kind: 'new-session' }
  | { kind: 'branch-session' }
  | { kind: 'clear-screen' }
  | { kind: 'compact' }

export type SlashResult =
  | { type: 'text'; text: string }
  | { type: 'dialog'; dialog: DialogDescriptor }
  | { type: 'effect'; effect: SessionEffect }
  | { type: 'exit' }

export type SlashContext = {
  sessions: SessionManager
  providers: ProviderResolver
  config: Config
}

export interface SlashCommand {
  name: string            // without leading slash
  description: string
  usage?: string
  run(args: string, ctx: SlashContext): Promise<SlashResult>
}
```

- [ ] **Step 2: Write failing test**

```ts
// test/slash/registry.test.ts
import { describe, it, expect } from 'vitest'
import { SlashRegistry } from '../../src/slash/registry'
import type { SlashCommand } from '../../src/slash/types'

const exit: SlashCommand = {
  name: 'exit',
  description: 'quit',
  run: async () => ({ type: 'exit' }),
}

describe('SlashRegistry', () => {
  it('registers and looks up by name (with or without leading slash)', () => {
    const r = new SlashRegistry()
    r.register(exit)
    expect(r.find('/exit')).toBe(exit)
    expect(r.find('exit')).toBe(exit)
    expect(r.find('/nope')).toBeUndefined()
  })

  it('parses "/name args rest" into name + args', () => {
    expect(SlashRegistry.parse('/btw hello world')).toEqual({
      name: 'btw',
      args: 'hello world',
    })
    expect(SlashRegistry.parse('/exit')).toEqual({ name: 'exit', args: '' })
    expect(SlashRegistry.parse('no slash')).toBeNull()
  })

  it('suggests starting-with matches for a prefix', () => {
    const r = new SlashRegistry()
    r.register(exit)
    r.register({ name: 'export', description: 'x', run: async () => ({ type: 'text', text: '' }) })
    expect(r.suggest('/ex').map(c => c.name).sort()).toEqual(['exit', 'export'])
  })
})
```

- [ ] **Step 3: Run test — expect fail**

Run: `pnpm test test/slash/registry.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

```ts
// src/slash/registry.ts
import type { SlashCommand } from './types'

export class SlashRegistry {
  private byName = new Map<string, SlashCommand>()

  register(cmd: SlashCommand): void {
    if (this.byName.has(cmd.name)) throw new Error(`duplicate slash: ${cmd.name}`)
    this.byName.set(cmd.name, cmd)
  }

  find(input: string): SlashCommand | undefined {
    const name = input.startsWith('/') ? input.slice(1) : input
    return this.byName.get(name)
  }

  list(): SlashCommand[] {
    return [...this.byName.values()]
  }

  suggest(prefix: string): SlashCommand[] {
    const p = prefix.startsWith('/') ? prefix.slice(1) : prefix
    return this.list().filter(c => c.name.startsWith(p))
  }

  static parse(text: string): { name: string; args: string } | null {
    if (!text.startsWith('/')) return null
    const m = text.slice(1).match(/^(\S+)\s*(.*)$/)
    if (!m) return null
    return { name: m[1], args: m[2].trim() }
  }
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm test test/slash/registry.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/slash/types.ts src/slash/registry.ts test/slash/registry.test.ts
git commit -m "feat(slash): add SlashCommand types and registry"
```

---

### Task 32: Simple slash commands (exit, help, clear, new, branch, btw, cost)

Each of these is small; batched so the commit is meaningful. `/model`, `/config`, `/compact` are handled in Tasks 33–35.

**Files:**
- Create: `src/slash/exit.ts`
- Create: `src/slash/help.ts`
- Create: `src/slash/clear.ts`
- Create: `src/slash/new.ts`
- Create: `src/slash/branch.ts`
- Create: `src/slash/btw.ts`
- Create: `src/slash/cost.ts`
- Create: `test/slash/simple.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/slash/simple.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ExitCommand } from '../../src/slash/exit'
import { HelpCommand } from '../../src/slash/help'
import { ClearCommand } from '../../src/slash/clear'
import { NewCommand } from '../../src/slash/new'
import { BranchCommand } from '../../src/slash/branch'
import { BtwCommand } from '../../src/slash/btw'
import { CostCommand } from '../../src/slash/cost'
import { SessionManager } from '../../src/core/session/manager'
import type { SlashContext } from '../../src/slash/types'

function ctx(overrides: Partial<SlashContext> = {}): SlashContext {
  const sessions = new SessionManager()
  sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
    config: { providers: [], active: { providerId: 'p' } } as any,
    ...overrides,
  }
}

describe('simple slash commands', () => {
  it('/exit returns { type: exit }', async () => {
    expect(await ExitCommand.run('', ctx())).toEqual({ type: 'exit' })
  })

  it('/help returns text listing commands', async () => {
    const c = ctx()
    const res = await HelpCommand.run('', c)
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/exit/)
  })

  it('/clear returns clear-screen effect', async () => {
    expect(await ClearCommand.run('', ctx())).toEqual({ type: 'effect', effect: { kind: 'clear-screen' } })
  })

  it('/new returns new-session effect', async () => {
    expect(await NewCommand.run('', ctx())).toEqual({ type: 'effect', effect: { kind: 'new-session' } })
  })

  it('/branch returns branch-session effect', async () => {
    expect(await BranchCommand.run('', ctx())).toEqual({ type: 'effect', effect: { kind: 'branch-session' } })
  })

  it('/btw enqueues text into the active session', async () => {
    const c = ctx()
    const res = await BtwCommand.run('hello', c)
    expect(res.type).toBe('text')
    expect(c.sessions.active()?.queue.size()).toBe(1)
  })

  it('/cost renders a breakdown of totals and per-model usage', async () => {
    const c = ctx()
    const active = c.sessions.active()!
    active.totalUsage = { inputTokens: 1000, outputTokens: 2000 }
    const res = await CostCommand.run('', c)
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toMatch(/tokens/i)
    }
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/slash/simple.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement each**

```ts
// src/slash/exit.ts
import type { SlashCommand } from './types'

export const ExitCommand: SlashCommand = {
  name: 'exit',
  description: 'Quit Nuka',
  run: async () => ({ type: 'exit' }),
}
```

```ts
// src/slash/help.ts
import type { SlashCommand, SlashContext } from './types'

const CMDS: Array<[string, string]> = [
  ['/exit', 'Quit Nuka'],
  ['/help', 'Show this help'],
  ['/clear', 'Clear rendered messages (keeps session)'],
  ['/new', 'Start a new session'],
  ['/branch', 'Fork the current session'],
  ['/model', 'Pick provider + model'],
  ['/config', 'Edit config in $EDITOR'],
  ['/btw <text>', 'Queue a message without interrupting the current turn'],
  ['/compact', 'Summarize older messages to free context'],
  ['/cost', 'Show cost and token breakdown'],
]

export const HelpCommand: SlashCommand = {
  name: 'help',
  description: 'Show help',
  run: async (_args: string, _ctx: SlashContext) => {
    const rows = CMDS.map(([k, v]) => `  ${k.padEnd(18)} ${v}`).join('\n')
    return { type: 'text', text: `Commands:\n${rows}` }
  },
}
```

```ts
// src/slash/clear.ts
import type { SlashCommand } from './types'

export const ClearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear rendered messages',
  run: async () => ({ type: 'effect', effect: { kind: 'clear-screen' } }),
}
```

```ts
// src/slash/new.ts
import type { SlashCommand } from './types'

export const NewCommand: SlashCommand = {
  name: 'new',
  description: 'Start a new session',
  run: async () => ({ type: 'effect', effect: { kind: 'new-session' } }),
}
```

```ts
// src/slash/branch.ts
import type { SlashCommand } from './types'

export const BranchCommand: SlashCommand = {
  name: 'branch',
  description: 'Fork the current session',
  run: async () => ({ type: 'effect', effect: { kind: 'branch-session' } }),
}
```

```ts
// src/slash/btw.ts
import type { SlashCommand, SlashContext } from './types'

export const BtwCommand: SlashCommand = {
  name: 'btw',
  description: 'Queue a message without interrupting',
  usage: '/btw <text>',
  run: async (args: string, ctx: SlashContext) => {
    const active = ctx.sessions.active()
    if (!active) return { type: 'text', text: 'No active session.' }
    if (!args.trim()) return { type: 'text', text: 'Usage: /btw <text>' }
    active.queue.push(args)
    return { type: 'text', text: `queued (${active.queue.size()} pending)` }
  },
}
```

```ts
// src/slash/cost.ts
import type { SlashCommand, SlashContext } from './types'
import { computeCost } from '../core/session/telemetry'

export const CostCommand: SlashCommand = {
  name: 'cost',
  description: 'Show cost and token breakdown',
  run: async (_args: string, ctx: SlashContext) => {
    const s = ctx.sessions.active()
    if (!s) return { type: 'text', text: 'No active session.' }
    const pc = ctx.providers.getProviderConfig(s.providerId)
    const cost = pc ? computeCost(pc, s.model, s.totalUsage) : 0
    const { inputTokens, outputTokens } = s.totalUsage
    const lines = [
      `provider   ${pc?.name ?? s.providerId}`,
      `model      ${s.model}`,
      `input      ${inputTokens.toLocaleString()} tokens`,
      `output     ${outputTokens.toLocaleString()} tokens`,
      `cost       $${cost.toFixed(4)}`,
    ]
    return { type: 'text', text: lines.join('\n') }
  },
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/slash/simple.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/slash/exit.ts src/slash/help.ts src/slash/clear.ts src/slash/new.ts src/slash/branch.ts src/slash/btw.ts src/slash/cost.ts test/slash/simple.test.ts
git commit -m "feat(slash): add exit/help/clear/new/branch/btw/cost commands"
```

---

### Task 33: /model two-level picker launcher + config persistence

The `/model` command opens the picker dialog; the dialog itself lives in TUI §J. This task covers the non-UI piece: reading/writing the selection to the config file.

**Files:**
- Create: `src/slash/model.ts`
- Create: `src/core/config/save.ts`
- Create: `test/core/config/save.test.ts`

- [ ] **Step 1: Write failing test for save.ts**

```ts
// test/core/config/save.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { saveActiveSelection, saveProviderSelectedModel, addProvider } from '../../../src/core/config/save'

function home(): string {
  const h = mkdtempSync(join(os.tmpdir(), 'nuka-save-'))
  mkdirSync(join(h, '.nuka'))
  writeFileSync(
    join(h, '.nuka', 'config.yaml'),
    `providers:
  - id: p1
    name: A
    format: anthropic
    baseUrl: https://api.anthropic.com
    models: [claude-sonnet-4-6]
    selectedModel: claude-sonnet-4-6
active: { providerId: p1 }
`,
  )
  return h
}

describe('config save', () => {
  it('saveActiveSelection updates active.providerId', async () => {
    const h = home()
    await saveActiveSelection(h, 'p1')
    const txt = readFileSync(join(h, '.nuka', 'config.yaml'), 'utf8')
    expect(txt).toMatch(/providerId:\s*p1/)
  })

  it('saveProviderSelectedModel updates selectedModel for a given provider', async () => {
    const h = home()
    await saveProviderSelectedModel(h, 'p1', 'opus-4-7')
    const txt = readFileSync(join(h, '.nuka', 'config.yaml'), 'utf8')
    expect(txt).toMatch(/selectedModel:\s*opus-4-7/)
  })

  it('addProvider appends a new provider', async () => {
    const h = home()
    await addProvider(h, {
      id: 'p2', name: 'X', format: 'openai', baseUrl: 'https://x', models: ['m1'],
    })
    const txt = readFileSync(join(h, '.nuka', 'config.yaml'), 'utf8')
    expect(txt).toContain('id: p2')
    expect(txt).toContain('id: p1')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/core/config/save.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement save.ts**

```ts
// src/core/config/save.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import path from 'node:path'
import type { ProviderConfig } from './schema'
import { ConfigSchema } from './schema'

function globalConfigFile(home: string): string {
  return path.join(home, '.nuka', 'config.yaml')
}

async function readConfig(home: string): Promise<any> {
  try {
    const text = await readFile(globalConfigFile(home), 'utf8')
    return parseYaml(text) ?? {}
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

async function writeConfig(home: string, obj: unknown): Promise<void> {
  await mkdir(path.join(home, '.nuka'), { recursive: true })
  ConfigSchema.parse(obj) // validate before writing
  await writeFile(globalConfigFile(home), stringifyYaml(obj), 'utf8')
}

export async function saveActiveSelection(home: string, providerId: string): Promise<void> {
  const obj = await readConfig(home)
  obj.active = { providerId }
  await writeConfig(home, obj)
}

export async function saveProviderSelectedModel(
  home: string,
  providerId: string,
  model: string,
): Promise<void> {
  const obj = await readConfig(home)
  const list: any[] = Array.isArray(obj.providers) ? obj.providers : []
  const p = list.find(x => x.id === providerId)
  if (!p) throw new Error(`provider not found: ${providerId}`)
  p.selectedModel = model
  if (!p.models?.includes(model)) p.models = [...(p.models ?? []), model]
  obj.providers = list
  await writeConfig(home, obj)
}

export async function addProvider(home: string, provider: ProviderConfig): Promise<void> {
  const obj = await readConfig(home)
  const list: any[] = Array.isArray(obj.providers) ? obj.providers : []
  if (list.some(p => p.id === provider.id)) {
    throw new Error(`provider id already exists: ${provider.id}`)
  }
  list.push(provider)
  obj.providers = list
  if (!obj.active) obj.active = { providerId: provider.id }
  await writeConfig(home, obj)
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/core/config/save.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Implement /model slash**

```ts
// src/slash/model.ts
import type { SlashCommand } from './types'

export const ModelCommand: SlashCommand = {
  name: 'model',
  description: 'Pick provider + model (two-level picker)',
  run: async () => ({ type: 'dialog', dialog: { kind: 'model-picker' } }),
}
```

- [ ] **Step 6: Commit**

```bash
git add src/core/config/save.ts test/core/config/save.test.ts src/slash/model.ts
git commit -m "feat: add config save helpers and /model launcher"
```

---

### Task 34: /compact slash wired to compactSession

**Files:**
- Create: `src/slash/compact.ts`
- Create: `test/slash/compact.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/slash/compact.test.ts
import { describe, it, expect } from 'vitest'
import { CompactCommand } from '../../src/slash/compact'
import { SessionManager } from '../../src/core/session/manager'
import type { SlashContext } from '../../src/slash/types'

function ctx(): SlashContext {
  const sessions = new SessionManager()
  sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    providers: { resolveFor: () => ({}) } as any,
    config: { providers: [], active: { providerId: 'p' } } as any,
  }
}

describe('/compact', () => {
  it('returns a compact effect', async () => {
    expect(await CompactCommand.run('', ctx())).toEqual({
      type: 'effect',
      effect: { kind: 'compact' },
    })
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/slash/compact.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/slash/compact.ts
import type { SlashCommand } from './types'

export const CompactCommand: SlashCommand = {
  name: 'compact',
  description: 'Summarize older messages via the active model',
  run: async () => ({ type: 'effect', effect: { kind: 'compact' } }),
}
```

The `compact` effect is handled in the TUI by calling `compactSession()` from `core/compact/compact.ts`. Wired up in Task 45.

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/slash/compact.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/slash/compact.ts test/slash/compact.test.ts
git commit -m "feat(slash): add /compact launcher"
```

---

### Task 35: /config slash

**Files:**
- Create: `src/slash/config.ts`
- Create: `test/slash/config.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/slash/config.test.ts
import { describe, it, expect } from 'vitest'
import { ConfigCommand } from '../../src/slash/config'

describe('/config', () => {
  it('opens the config editor dialog', async () => {
    expect(await ConfigCommand.run('', {} as any)).toEqual({
      type: 'dialog',
      dialog: { kind: 'config-editor' },
    })
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/slash/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/slash/config.ts
import type { SlashCommand } from './types'

export const ConfigCommand: SlashCommand = {
  name: 'config',
  description: 'Open config in $EDITOR',
  run: async () => ({ type: 'dialog', dialog: { kind: 'config-editor' } }),
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/slash/config.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/slash/config.ts test/slash/config.test.ts
git commit -m "feat(slash): add /config launcher"
```

---
## §J · TUI + Wire-up

TUI tests use `ink-testing-library`. Components in `tui/` are React 19 functional components. No tests are written for the theme / tips pools (pure data), but snapshots cover the composed views.

### Task 36: Theme palette

**Files:**
- Create: `src/tui/theme.ts`

- [ ] **Step 1: Implement theme**

```ts
// src/tui/theme.ts
export type Palette = {
  primary: string
  accent: string
  fg: string
  muted: string
  warn: string
  error: string
  success: string
}

export const defaultPalette: Palette = {
  primary: '#A3BE8C',
  accent: '#6E8759',
  fg: '#D8DEE9',
  muted: '#4C566A',
  warn: '#EBCB8B',
  error: '#BF616A',
  success: '#A3BE8C',
}

export function mergePalette(
  base: Palette,
  override?: Partial<Palette>,
): Palette {
  return { ...base, ...(override ?? {}) }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/tui/theme.ts
git commit -m "feat(tui): add theme palette"
```

---

### Task 37: Welcome screen (Logo + tips + Welcome)

**Files:**
- Create: `src/tui/Welcome/tips.ts`
- Create: `src/tui/Welcome/Logo.tsx`
- Create: `src/tui/Welcome/Welcome.tsx`
- Create: `test/tui/welcome.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// test/tui/welcome.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Welcome } from '../../src/tui/Welcome/Welcome'

describe('Welcome', () => {
  it('renders NUKA brand and cwd', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/workspace/proj"
        gitBranch={{ branch: 'main', dirty: false }}
        model="claude-sonnet-4-6"
        version="0.1.0"
        tip="Which bug are we slicing today?"
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('NUKA')
    expect(frame).toContain('/workspace/proj')
    expect(frame).toContain('main')
    expect(frame).toContain('claude-sonnet-4-6')
    expect(frame).toContain('Which bug are we slicing')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/tui/welcome.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement tips pool**

```ts
// src/tui/Welcome/tips.ts
export const DEFAULT_TIPS: string[] = [
  'Which bug are we slicing today?',
  'Keyboard ready. Feed me a task.',
  'Coffee. Code. Avocado.',
  "Refactor o'clock. Deep breath.",
  "I won't write tests, but I'll nag you to.",
  'Saving is brave. Committing is braver.',
  'Past-you left a TODO. Want to see it?',
  'Build or break today? Either works.',
]

export function pickTip(extra: string[] = []): string {
  const pool = [...DEFAULT_TIPS, ...extra]
  return pool[Math.floor(Math.random() * pool.length)]
}
```

- [ ] **Step 4: Implement Logo**

```tsx
// src/tui/Welcome/Logo.tsx
import React from 'react'
import { Text } from 'ink'
import { defaultPalette } from '../theme'

const LOGO_LINES = [
  '⣶⣄⡀          ⢀⣴',
  '⣿⣿⣻⣷⣦⡀      ⣾⣿',
  '⣿⣾ ⠙⢾⣿⡄    ⣿⣷',
  '⣿⣿   ⢸⣷⡇    ⣿⣽',
  '⣿⣾   ⢸⣷⡇    ⣿⣻',
  '⠘⣿⣵⣄⠸⣷⣇⢀⣠⣾⣿⠋',
  '  ⠈⠙⠽⢧⡹⠾⡿⠻⠓⠁',
]

export function Logo(): React.JSX.Element {
  return (
    <Text color={defaultPalette.primary}>
      {LOGO_LINES.join('\n')}
    </Text>
  )
}
```

- [ ] **Step 5: Implement Welcome**

```tsx
// src/tui/Welcome/Welcome.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { Logo } from './Logo'
import { defaultPalette as P } from '../theme'

export type WelcomeProps = {
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  model: string
  version: string
  tip: string
}

export function Welcome(props: WelcomeProps): React.JSX.Element {
  const { cwd, gitBranch, model, version, tip } = props
  const git = gitBranch
    ? `${gitBranch.branch}${gitBranch.dirty ? ' *' : ' · clean'}`
    : '(not a git repo)'
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box>
        <Box marginRight={3}>
          <Logo />
        </Box>
        <Box flexDirection="column">
          <Text color={P.primary} bold>NUKA</Text>
          <Text color={P.muted}>Avocado Agent · v{version}</Text>
          <Box height={1} />
          <Text color={P.muted}>cwd   <Text color={P.fg}>{cwd}</Text></Text>
          <Text color={P.muted}>git   <Text color={P.fg}>{git}</Text></Text>
          <Text color={P.muted}>model <Text color={P.fg}>{model}</Text></Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={P.primary}>✦ </Text>
        <Text color={P.fg}>{tip}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={P.muted}>
          Type <Text color={P.primary}>/</Text> for commands,{' '}
          <Text color={P.primary}>?</Text> for help, <Text color={P.primary}>esc</Text> to cancel.
        </Text>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 6: Run test — expect pass**

Run: `pnpm test test/tui/welcome.test.tsx`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add src/tui/Welcome test/tui/welcome.test.tsx
git commit -m "feat(tui): add Welcome screen with logo, tip, env panel"
```

---

### Task 38: Messages rendering

**Files:**
- Create: `src/tui/Messages/Markdown.tsx`
- Create: `src/tui/Messages/Diff.tsx`
- Create: `src/tui/Messages/ToolCall.tsx`
- Create: `src/tui/Messages/MessageRow.tsx`
- Create: `src/tui/Messages/Messages.tsx`
- Create: `test/tui/messages.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// test/tui/messages.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Messages } from '../../src/tui/Messages/Messages'
import type { Message } from '../../src/core/message/types'

const sample: Message[] = [
  { role: 'user', id: 'u1', ts: 1, content: [{ type: 'text', text: 'hello' }] },
  { role: 'assistant', id: 'a1', ts: 2, content: [{ type: 'text', text: 'hi there' }] },
]

describe('Messages', () => {
  it('renders a user and assistant row', () => {
    const { lastFrame } = render(<Messages items={sample} streaming={null} />)
    const f = lastFrame() ?? ''
    expect(f).toContain('hello')
    expect(f).toContain('hi there')
    expect(f).toContain('you')
    expect(f).toContain('nuka')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/tui/messages.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement Markdown**

```tsx
// src/tui/Messages/Markdown.tsx
import React from 'react'
import { Text } from 'ink'

// Phase 1 Markdown: pass-through. Phase 2 can plug in marked + cli-highlight.
export function Markdown({ source }: { source: string }): React.JSX.Element {
  return <Text>{source}</Text>
}
```

- [ ] **Step 4: Implement Diff**

```tsx
// src/tui/Messages/Diff.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { createPatch } from 'diff'
import { defaultPalette as P } from '../theme'

export function Diff({
  path, before, after,
}: { path: string; before: string; after: string }): React.JSX.Element {
  const patch = createPatch(path, before, after, '', '', { context: 2 })
  return (
    <Box flexDirection="column">
      {patch.split('\n').map((line, i) => {
        const color = line.startsWith('+') && !line.startsWith('+++')
          ? P.success
          : line.startsWith('-') && !line.startsWith('---')
          ? P.error
          : P.muted
        return <Text key={i} color={color}>{line}</Text>
      })}
    </Box>
  )
}
```

- [ ] **Step 5: Implement ToolCall**

```tsx
// src/tui/Messages/ToolCall.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'

export function ToolCall(props: {
  name: string
  argSummary: string
  status: 'running' | 'ok' | 'error'
  durationMs?: number
}): React.JSX.Element {
  const icon = props.status === 'ok' ? '✓' : props.status === 'error' ? '✗' : '…'
  const iconColor = props.status === 'error' ? P.error : P.success
  return (
    <Box>
      <Text color={P.accent}>⏺ </Text>
      <Text color={P.fg} bold>{props.name} </Text>
      <Text color={P.muted}>{props.argSummary}</Text>
      {props.durationMs != null && (
        <Text color={P.muted}>  {(props.durationMs / 1000).toFixed(1)}s</Text>
      )}
      <Text color={iconColor}> {icon}</Text>
    </Box>
  )
}
```

- [ ] **Step 6: Implement MessageRow**

```tsx
// src/tui/Messages/MessageRow.tsx
import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from '../../core/message/types'
import { defaultPalette as P } from '../theme'
import { Markdown } from './Markdown'

export function MessageRow({ m }: { m: Message }): React.JSX.Element | null {
  if (m.role === 'system') return null
  const speaker = m.role === 'user' ? 'you' : m.role === 'assistant' ? 'nuka' : 'tool'
  const color = m.role === 'user' ? P.muted : m.role === 'assistant' ? P.primary : P.accent
  const text = m.role === 'tool'
    ? m.content
    : m.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={color} bold>▎ {speaker}</Text>
      <Box marginLeft={2}>
        <Markdown source={text} />
      </Box>
    </Box>
  )
}
```

- [ ] **Step 7: Implement Messages**

```tsx
// src/tui/Messages/Messages.tsx
import React from 'react'
import { Box, Static } from 'ink'
import { MessageRow } from './MessageRow'
import type { Message } from '../../core/message/types'

export function Messages(props: {
  items: Message[]
  streaming: Message | null
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Static items={props.items}>
        {(m, i) => <MessageRow key={m.id ?? i} m={m} />}
      </Static>
      {props.streaming && <MessageRow m={props.streaming} />}
    </Box>
  )
}
```

- [ ] **Step 8: Run test — expect pass**

Run: `pnpm test test/tui/messages.test.tsx`
Expected: 1 passed.

- [ ] **Step 9: Commit**

```bash
git add src/tui/Messages test/tui/messages.test.tsx
git commit -m "feat(tui): add Messages rendering (row, markdown, diff, tool call)"
```

---

### Task 39: PromptInput (bottom-fixed)

**Files:**
- Create: `src/tui/PromptInput/useInputHistory.ts`
- Create: `src/tui/PromptInput/SlashSuggest.tsx`
- Create: `src/tui/PromptInput/PromptInput.tsx`
- Create: `test/tui/promptInput.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// test/tui/promptInput.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { PromptInput } from '../../src/tui/PromptInput/PromptInput'

describe('PromptInput', () => {
  it('renders the prompt marker and initial value', () => {
    const { lastFrame } = render(
      <PromptInput value="hello" onChange={() => {}} onSubmit={() => {}} disabled={false} />,
    )
    expect(lastFrame()).toContain('>')
    expect(lastFrame()).toContain('hello')
  })

  it('typed characters call onChange', () => {
    const onChange = vi.fn()
    const { stdin } = render(
      <PromptInput value="" onChange={onChange} onSubmit={() => {}} disabled={false} />,
    )
    stdin.write('a')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('enter submits non-empty value', () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      <PromptInput value="hi" onChange={() => {}} onSubmit={onSubmit} disabled={false} />,
    )
    stdin.write('\r')
    expect(onSubmit).toHaveBeenCalledWith('hi')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/tui/promptInput.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement input history hook**

```ts
// src/tui/PromptInput/useInputHistory.ts
import { useCallback, useRef, useState } from 'react'

export function useInputHistory(): {
  push: (v: string) => void
  prev: (current: string) => string | null
  next: () => string | null
  reset: () => void
} {
  const buf = useRef<string[]>([])
  const [cursor, setCursor] = useState<number | null>(null)

  const push = useCallback((v: string) => {
    if (!v.trim()) return
    buf.current.push(v)
    setCursor(null)
  }, [])
  const prev = useCallback((_current: string) => {
    if (buf.current.length === 0) return null
    const next = cursor === null ? buf.current.length - 1 : Math.max(0, cursor - 1)
    setCursor(next)
    return buf.current[next] ?? null
  }, [cursor])
  const next = useCallback(() => {
    if (cursor === null) return null
    const n = cursor + 1
    if (n >= buf.current.length) {
      setCursor(null)
      return ''
    }
    setCursor(n)
    return buf.current[n] ?? null
  }, [cursor])
  const reset = useCallback(() => setCursor(null), [])

  return { push, prev, next, reset }
}
```

- [ ] **Step 4: Implement SlashSuggest**

```tsx
// src/tui/PromptInput/SlashSuggest.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'

export function SlashSuggest(props: {
  candidates: { name: string; description: string }[]
  selectedIndex: number
}): React.JSX.Element | null {
  if (props.candidates.length === 0) return null
  return (
    <Box flexDirection="column" paddingX={1}>
      {props.candidates.slice(0, 6).map((c, i) => (
        <Box key={c.name}>
          <Text color={i === props.selectedIndex ? P.primary : P.muted}>
            {i === props.selectedIndex ? '›' : ' '} /{c.name.padEnd(10)}  {c.description}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
```

- [ ] **Step 5: Implement PromptInput**

```tsx
// src/tui/PromptInput/PromptInput.tsx
import React from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'

export type PromptInputProps = {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
  disabled: boolean
  placeholder?: string
}

export function PromptInput(props: PromptInputProps): React.JSX.Element {
  useInput((input, key) => {
    if (props.disabled) return
    if (key.return) {
      if (props.value.trim()) props.onSubmit(props.value)
      return
    }
    if (key.backspace || key.delete) {
      props.onChange(props.value.slice(0, -1))
      return
    }
    if (!key.ctrl && !key.meta && input) {
      props.onChange(props.value + input)
    }
  }, { isActive: !props.disabled })

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={P.primary}>▎ </Text>
        <Text color={P.primary}>{'> '}</Text>
        <Text color={P.fg}>{props.value || (props.placeholder ?? '')}</Text>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 6: Run test — expect pass**

Run: `pnpm test test/tui/promptInput.test.tsx`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add src/tui/PromptInput test/tui/promptInput.test.tsx
git commit -m "feat(tui): add bottom-fixed PromptInput with history hook"
```

---

### Task 40: StatusBar (two-line)

**Files:**
- Create: `src/tui/StatusBar/Segments.tsx`
- Create: `src/tui/StatusBar/HintLine.tsx`
- Create: `src/tui/StatusBar/StatusBar.tsx`
- Create: `test/tui/statusBar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// test/tui/statusBar.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { StatusBar } from '../../src/tui/StatusBar/StatusBar'

describe('StatusBar', () => {
  it('renders model, cwd, git, context, cost segments', () => {
    const { lastFrame } = render(
      <StatusBar
        model="sonnet-4-6"
        cwd="~/Nuka"
        gitBranch={{ branch: 'main', dirty: true }}
        contextUsed={14000}
        contextMax={200000}
        cost={0.28}
        mcpCount={0}
        autoMode="off"
        queueLength={0}
        mode="idle"
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('sonnet-4-6')
    expect(f).toContain('~/Nuka')
    expect(f).toContain('main')
    expect(f).toContain('14k/200k')
    expect(f).toContain('$0.28')
  })

  it('shows esc cancel hint while running', () => {
    const { lastFrame } = render(
      <StatusBar
        model="m" cwd="~" gitBranch={null} contextUsed={0} contextMax={200000}
        cost={0} mcpCount={0} autoMode="off" queueLength={0} mode="running"
      />,
    )
    expect(lastFrame()).toContain('esc cancel')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/tui/statusBar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement Segments**

```tsx
// src/tui/StatusBar/Segments.tsx
import React from 'react'
import { Text } from 'ink'
import { defaultPalette as P } from '../theme'

export function Sep(): React.JSX.Element {
  return <Text color={P.muted}>{'   ·   '}</Text>
}

export function ModelSeg({ model }: { model: string }): React.JSX.Element {
  return <Text color={P.primary}>⬢ {model}</Text>
}

export function CwdSeg({ cwd }: { cwd: string }): React.JSX.Element {
  return <Text color={P.muted}>{cwd}</Text>
}

export function GitSeg({ branch, dirty }: { branch: string; dirty: boolean }): React.JSX.Element {
  return <Text color={dirty ? P.warn : P.muted}>{branch}{dirty ? '*' : ''}</Text>
}

export function CtxSeg({ used, max }: { used: number; max: number }): React.JSX.Element {
  const pct = used / max
  const color = pct > 0.95 ? P.error : pct > 0.8 ? P.warn : P.muted
  return (
    <Text color={color}>
      {(used / 1000).toFixed(0)}k/{(max / 1000).toFixed(0)}k
    </Text>
  )
}

export function CostSeg({ cost }: { cost: number }): React.JSX.Element {
  return <Text color={P.primary}>${cost.toFixed(2)}</Text>
}

export function McpSeg({ count }: { count: number }): React.JSX.Element {
  if (count === 0) return <Text color={P.muted}>✓ no mcp</Text>
  return <Text color={P.success}>● {count} mcp</Text>
}

export function AutoSeg({ mode }: { mode: 'off' | `on(${number})` }): React.JSX.Element {
  return <Text color={P.muted}>auto: {mode}</Text>
}

export function QueueSeg({ n }: { n: number }): React.JSX.Element | null {
  if (n === 0) return null
  return <Text color={P.muted}>⏳ {n} queued</Text>
}
```

- [ ] **Step 4: Implement HintLine**

```tsx
// src/tui/StatusBar/HintLine.tsx
import React from 'react'
import { Text } from 'ink'
import { defaultPalette as P } from '../theme'

export type HintMode = 'idle' | 'running' | 'awaiting-user' | 'primed-quit'

export function HintLine({ mode }: { mode: HintMode }): React.JSX.Element {
  const map: Record<HintMode, string> = {
    'idle': '? shortcuts · ⏎ send',
    'running': 'esc cancel · ⏎ queue',
    'awaiting-user': '↑↓ select · ⏎ confirm · esc reject',
    'primed-quit': 'esc×2 to quit',
  }
  return <Text color={P.muted}>{map[mode]}</Text>
}
```

- [ ] **Step 5: Implement StatusBar**

```tsx
// src/tui/StatusBar/StatusBar.tsx
import React from 'react'
import { Box } from 'ink'
import {
  ModelSeg, CwdSeg, GitSeg, CtxSeg, CostSeg, McpSeg, AutoSeg, QueueSeg, Sep,
} from './Segments'
import { HintLine, type HintMode } from './HintLine'

export type StatusBarProps = {
  model: string
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  contextUsed: number
  contextMax: number
  cost: number
  mcpCount: number
  autoMode: 'off' | `on(${number})`
  queueLength: number
  mode: HintMode
}

export function StatusBar(p: StatusBarProps): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <ModelSeg model={p.model} /><Sep />
        <CwdSeg cwd={p.cwd} /><Sep />
        {p.gitBranch && (<><GitSeg {...p.gitBranch} /><Sep /></>)}
        <CtxSeg used={p.contextUsed} max={p.contextMax} /><Sep />
        <CostSeg cost={p.cost} />
      </Box>
      <Box>
        <McpSeg count={p.mcpCount} /><Sep />
        <AutoSeg mode={p.autoMode} />
        {p.queueLength > 0 && <><Sep /><QueueSeg n={p.queueLength} /></>}
        <Box flexGrow={1} />
        <HintLine mode={p.mode} />
      </Box>
    </Box>
  )
}
```

- [ ] **Step 6: Run test — expect pass**

Run: `pnpm test test/tui/statusBar.test.tsx`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add src/tui/StatusBar test/tui/statusBar.test.tsx
git commit -m "feat(tui): add two-line StatusBar"
```

---

### Task 41: PermissionDialog

**Files:**
- Create: `src/tui/dialogs/PermissionDialog.tsx`
- Create: `test/tui/permissionDialog.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// test/tui/permissionDialog.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { PermissionDialog } from '../../src/tui/dialogs/PermissionDialog'

describe('PermissionDialog', () => {
  it('renders tool call details and 4 options', () => {
    const { lastFrame } = render(
      <PermissionDialog
        call={{ toolName: 'Write', hint: 'write', input: { path: 'src/a.ts', content: 'x' } }}
        suggestedPattern="src/**"
        onDecide={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Write')
    expect(f).toContain('src/a.ts')
    expect(f).toContain('Yes, once')
    expect(f).toContain('this session')
    expect(f).toContain('src/**')
  })

  it('pressing 1 then enter fires onDecide with once', () => {
    const onDecide = vi.fn()
    const { stdin } = render(
      <PermissionDialog
        call={{ toolName: 'Bash', hint: 'exec', input: { command: 'echo hi' } }}
        suggestedPattern="echo *"
        onDecide={onDecide}
      />,
    )
    stdin.write('\r') // default first option = once
    expect(onDecide).toHaveBeenCalled()
    const arg = onDecide.mock.calls[0][0]
    expect(arg.allowed).toBe(true)
    expect(arg.remember).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/tui/permissionDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/tui/dialogs/PermissionDialog.tsx
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'
import type { PermissionCall, PermissionDecision } from '../../core/permission/types'

export function PermissionDialog(props: {
  call: PermissionCall
  suggestedPattern?: string
  onDecide: (d: PermissionDecision) => void
}): React.JSX.Element {
  const [cursor, setCursor] = useState(0)
  const options: Array<{ label: string; decide: () => PermissionDecision }> = [
    { label: 'Yes, once', decide: () => ({ allowed: true }) },
    {
      label: `Yes, always for ${props.call.hint} in this session`,
      decide: () => ({ allowed: true, remember: { scope: 'session', hint: props.call.hint } }),
    },
    ...(props.suggestedPattern
      ? [{
          label: `Yes, always for ${props.suggestedPattern}`,
          decide: () => ({
            allowed: true,
            remember: { scope: 'pattern' as const, hint: props.call.hint, pattern: props.suggestedPattern! },
          }),
        }]
      : []),
    { label: 'No', decide: () => ({ allowed: false, reason: 'user denied' }) },
  ]

  useInput((input, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    else if (key.downArrow) setCursor(c => Math.min(options.length - 1, c + 1))
    else if (key.return) props.onDecide(options[cursor].decide())
    else if (key.escape) props.onDecide({ allowed: false, reason: 'escape' })
    else if (/^[1-9]$/.test(input)) {
      const n = Number(input) - 1
      if (n < options.length) props.onDecide(options[n].decide())
    }
  })

  const inputSummary = JSON.stringify(props.call.input).slice(0, 120)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.warn} paddingX={1}>
      <Text color={P.warn} bold>{props.call.toolName} · {props.call.hint}</Text>
      <Text color={P.muted}>{inputSummary}</Text>
      <Box height={1} />
      {options.map((o, i) => (
        <Text key={o.label} color={i === cursor ? P.primary : P.fg}>
          {i === cursor ? '›' : ' '} [{i + 1}] {o.label}
        </Text>
      ))}
      <Box height={1} />
      <Text color={P.muted}>↑↓ select · ⏎ confirm · esc reject</Text>
    </Box>
  )
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/tui/permissionDialog.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/tui/dialogs/PermissionDialog.tsx test/tui/permissionDialog.test.tsx
git commit -m "feat(tui): add PermissionDialog with 4-option flow"
```

---

### Task 42: ModelPicker (two-level)

**Files:**
- Create: `src/tui/dialogs/ModelPicker.tsx`
- Create: `test/tui/modelPicker.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// test/tui/modelPicker.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { ModelPicker } from '../../src/tui/dialogs/ModelPicker'
import type { ProviderConfig } from '../../src/core/config/schema'

const providers: ProviderConfig[] = [
  { id: 'p1', name: 'Anthropic', format: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-6'] },
  { id: 'p2', name: 'OpenAI', format: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5'] },
]

describe('ModelPicker', () => {
  it('shows provider list at root', () => {
    const { lastFrame } = render(
      <ModelPicker providers={providers} onSelect={() => {}} onAddProvider={() => {}} onRefresh={async () => []} onCancel={() => {}} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Anthropic')
    expect(f).toContain('OpenAI')
    expect(f).toContain('Add provider')
  })

  it('enter on a provider drills into its model list', () => {
    const { lastFrame, stdin } = render(
      <ModelPicker providers={providers} onSelect={() => {}} onAddProvider={() => {}} onRefresh={async () => []} onCancel={() => {}} />,
    )
    stdin.write('\r') // pick first provider = Anthropic
    expect(lastFrame()).toContain('claude-sonnet-4-6')
    expect(lastFrame()).toContain('Back')
    expect(lastFrame()).toContain('Refresh')
  })

  it('onSelect fires with provider + model after drill-down selection', () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <ModelPicker providers={providers} onSelect={onSelect} onAddProvider={() => {}} onRefresh={async () => []} onCancel={() => {}} />,
    )
    stdin.write('\r')      // into Anthropic
    stdin.write('\r')      // pick claude-sonnet-4-6
    expect(onSelect).toHaveBeenCalledWith('p1', 'claude-sonnet-4-6')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/tui/modelPicker.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/tui/dialogs/ModelPicker.tsx
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { ProviderConfig } from '../../core/config/schema'
import { defaultPalette as P } from '../theme'

type View = { kind: 'root' } | { kind: 'models'; providerId: string }

export function ModelPicker(props: {
  providers: ProviderConfig[]
  onSelect: (providerId: string, model: string) => void
  onAddProvider: () => void
  onRefresh: (providerId: string) => Promise<string[]>
  onCancel: () => void
}): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'root' })
  const [cursor, setCursor] = useState(0)

  if (view.kind === 'root') {
    const items = [
      ...props.providers.map(p => ({ label: `${p.name}    ${p.baseUrl}`, action: () => { setView({ kind: 'models', providerId: p.id }); setCursor(0) } })),
      { label: '[+] Add provider…', action: props.onAddProvider },
    ]
    useInput((_input, key) => {
      if (key.upArrow) setCursor(c => Math.max(0, c - 1))
      else if (key.downArrow) setCursor(c => Math.min(items.length - 1, c + 1))
      else if (key.return) items[cursor].action()
      else if (key.escape) props.onCancel()
    })
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
        <Text color={P.primary} bold>Select provider</Text>
        {items.map((it, i) => (
          <Text key={i} color={i === cursor ? P.primary : P.fg}>
            {i === cursor ? '›' : ' '} {it.label}
          </Text>
        ))}
      </Box>
    )
  }

  const provider = props.providers.find(p => p.id === view.providerId)!
  const [models, setModels] = useState<string[]>(provider.models ?? [])

  const items = [
    ...models.map(m => ({ label: m, action: () => props.onSelect(provider.id, m) })),
    { label: '[↻] Refresh from /v1/models', action: async () => { const fresh = await props.onRefresh(provider.id); setModels(fresh); setCursor(0) } },
    { label: '[← Back]', action: () => { setView({ kind: 'root' }); setCursor(0) } },
  ]
  useInput((_input, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    else if (key.downArrow) setCursor(c => Math.min(items.length - 1, c + 1))
    else if (key.return) void items[cursor].action()
    else if (key.escape) { setView({ kind: 'root' }); setCursor(0) }
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>{provider.name}</Text>
      {items.map((it, i) => (
        <Text key={i} color={i === cursor ? P.primary : P.fg}>
          {i === cursor ? '›' : ' '} {it.label}
        </Text>
      ))}
    </Box>
  )
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/tui/modelPicker.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/tui/dialogs/ModelPicker.tsx test/tui/modelPicker.test.tsx
git commit -m "feat(tui): add two-level ModelPicker"
```

---
### Task 43: ConfigEditor dialog

**Files:**
- Create: `src/tui/dialogs/ConfigEditor.tsx`
- Create: `test/tui/configEditor.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// test/tui/configEditor.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { ConfigEditor } from '../../src/tui/dialogs/ConfigEditor'

describe('ConfigEditor', () => {
  it('renders the yaml preview and hint to open $EDITOR', () => {
    const { lastFrame } = render(
      <ConfigEditor
        configPath="/home/x/.nuka/config.yaml"
        preview="providers: []\nactive: { providerId: '' }"
        onOpen={() => {}}
        onClose={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('/home/x/.nuka/config.yaml')
    expect(f).toContain('providers: []')
    expect(f).toMatch(/editor/i)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/tui/configEditor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/tui/dialogs/ConfigEditor.tsx
import React from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'

export function ConfigEditor(props: {
  configPath: string
  preview: string
  onOpen: () => void
  onClose: () => void
}): React.JSX.Element {
  useInput((input, key) => {
    if (key.return || input === 'e') props.onOpen()
    else if (key.escape) props.onClose()
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Config · {props.configPath}</Text>
      <Box height={1} />
      <Text color={P.fg}>{props.preview}</Text>
      <Box height={1} />
      <Text color={P.muted}>press ⏎ or e to open $EDITOR · esc to close</Text>
    </Box>
  )
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/tui/configEditor.test.tsx`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/tui/dialogs/ConfigEditor.tsx test/tui/configEditor.test.tsx
git commit -m "feat(tui): add ConfigEditor preview dialog"
```

---

### Task 44: TUI hooks

**Files:**
- Create: `src/tui/hooks/useTerminalSize.ts`
- Create: `src/tui/hooks/useSession.ts`
- Create: `src/tui/hooks/useAgentStream.ts`
- Create: `test/tui/hooks.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// test/tui/hooks.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { useAgentStream } from '../../src/tui/hooks/useAgentStream'
import type { AgentEvent } from '../../src/core/agent/events'

function Probe({ onReady }: { onReady: (api: any) => void }): React.JSX.Element {
  const stream = useAgentStream({ runAgent: async function* () {
    yield { type: 'text_delta', text: 'A' } as AgentEvent
    yield { type: 'turn_end', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } } as AgentEvent
  } })
  React.useEffect(() => onReady(stream), [])
  return <Text>{stream.events.map(e => e.type).join(',')}</Text>
}

describe('useAgentStream', () => {
  it('exposes send + cancel + events list that appends as events arrive', async () => {
    let api: any
    const { rerender, lastFrame } = render(<Probe onReady={a => { api = a }} />)
    await api.send('hi')
    // allow microtasks to flush
    await new Promise(r => setTimeout(r, 0))
    rerender(<Probe onReady={() => {}} />)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('text_delta')
    expect(frame).toContain('turn_end')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/tui/hooks.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement useTerminalSize**

```ts
// src/tui/hooks/useTerminalSize.ts
import { useEffect, useState } from 'react'

export function useTerminalSize(): { columns: number; rows: number } {
  const [size, setSize] = useState({
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  })
  useEffect(() => {
    const onResize = () => setSize({
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    })
    process.stdout.on('resize', onResize)
    return () => { process.stdout.off('resize', onResize) }
  }, [])
  return size
}
```

- [ ] **Step 4: Implement useSession**

```ts
// src/tui/hooks/useSession.ts
import { useState, useMemo, useCallback } from 'react'
import type { Session } from '../../core/session/types'
import { SessionManager } from '../../core/session/manager'

export function useSession(initial: {
  providerId: string
  model: string
}): {
  session: Session
  manager: SessionManager
  refresh: () => void
} {
  const manager = useMemo(() => {
    const m = new SessionManager()
    m.start(initial)
    return m
  }, [])
  const [, tick] = useState(0)
  const refresh = useCallback(() => tick(t => t + 1), [])
  return { session: manager.active()!, manager, refresh }
}
```

- [ ] **Step 5: Implement useAgentStream**

```ts
// src/tui/hooks/useAgentStream.ts
import { useCallback, useRef, useState } from 'react'
import type { AgentEvent } from '../../core/agent/events'

export type AgentStreamDeps = {
  runAgent: (input: { text: string }, signal: AbortSignal) => AsyncIterable<AgentEvent>
}

export function useAgentStream(deps: AgentStreamDeps): {
  events: AgentEvent[]
  running: boolean
  send: (text: string) => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(async (text: string) => {
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    try {
      for await (const ev of deps.runAgent({ text }, ac.signal)) {
        setEvents(prev => [...prev, ev])
      }
    } catch (err) {
      setEvents(prev => [...prev, { type: 'error', error: err as Error }])
    } finally {
      setRunning(false)
    }
  }, [deps])

  const cancel = useCallback(() => abortRef.current?.abort(), [])
  const reset = useCallback(() => setEvents([]), [])

  return { events, running, send, cancel, reset }
}
```

- [ ] **Step 6: Run test — expect pass**

Run: `pnpm test test/tui/hooks.test.tsx`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add src/tui/hooks test/tui/hooks.test.tsx
git commit -m "feat(tui): add useTerminalSize, useSession, useAgentStream"
```

---

### Task 45: App.tsx (wire everything)

**Files:**
- Create: `src/tui/App.tsx`
- Create: `test/tui/app.test.tsx`

The App is the top-level Ink component that composes Welcome / Messages / PromptInput / StatusBar and hosts active dialogs. It receives preconstructed `core/` dependencies from `cli.tsx`.

- [ ] **Step 1: Write failing integration test**

```tsx
// test/tui/app.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { App } from '../../src/tui/App'
import { SessionManager } from '../../src/core/session/manager'
import { SlashRegistry } from '../../src/slash/registry'
import { HelpCommand } from '../../src/slash/help'

describe('App', () => {
  it('boots with welcome screen when no messages exist', () => {
    const sessions = new SessionManager()
    sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    const slash = new SlashRegistry()
    slash.register(HelpCommand)

    const { lastFrame } = render(
      <App
        sessions={sessions}
        slash={slash}
        providers={{ listProviders: () => [], getProviderConfig: () => undefined, fetchRemoteModels: async () => [] } as any}
        config={{ providers: [], active: { providerId: 'p' } } as any}
        runAgent={async function* () { /* no-op */ }}
        onExit={() => {}}
        onOpenEditor={() => {}}
        compactSession={async () => {}}
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('NUKA')
    expect(f).toContain('/root/codes/Nuka')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm test test/tui/app.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/tui/App.tsx
import React, { useCallback, useState } from 'react'
import { Box, useApp, useInput } from 'ink'
import { Welcome } from './Welcome/Welcome'
import { Messages } from './Messages/Messages'
import { PromptInput } from './PromptInput/PromptInput'
import { StatusBar } from './StatusBar/StatusBar'
import { PermissionDialog } from './dialogs/PermissionDialog'
import { ModelPicker } from './dialogs/ModelPicker'
import { ConfigEditor } from './dialogs/ConfigEditor'
import { pickTip } from './Welcome/tips'
import type { SessionManager } from '../core/session/manager'
import type { ProviderResolver } from '../core/provider/resolver'
import type { Config } from '../core/config/schema'
import type { AgentEvent } from '../core/agent/events'
import type { SlashRegistry } from '../slash/registry'
import type { Session } from '../core/session/types'
import { computeCost } from '../core/session/telemetry'
import { useAgentStream } from './hooks/useAgentStream'

type Dialog =
  | { kind: 'permission'; call: any; suggestedPattern?: string; resolve: (d: any) => void }
  | { kind: 'model-picker' }
  | { kind: 'config-editor' }

export type AppProps = {
  sessions: SessionManager
  slash: SlashRegistry
  providers: ProviderResolver
  config: Config
  runAgent: (input: { text: string }, session: Session, signal: AbortSignal) => AsyncIterable<AgentEvent>
  onExit: () => void
  onOpenEditor: () => void
  compactSession: (s: Session) => Promise<void>
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  version: string
}

export function App(props: AppProps): React.JSX.Element {
  const { exit } = useApp()
  const [session, setSession] = useState<Session>(() => props.sessions.active()!)
  const [input, setInput] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [tip] = useState(() => pickTip(props.config.welcome?.tips))
  const [primedQuit, setPrimedQuit] = useState(false)

  const runner = (i: { text: string }, signal: AbortSignal) => props.runAgent(i, session, signal)
  const stream = useAgentStream({ runAgent: runner })

  const handleSlashEffect = useCallback(async (effect: { kind: string }) => {
    if (effect.kind === 'clear-screen') { stream.reset() }
    else if (effect.kind === 'new-session') {
      const next = props.sessions.new()
      next.providerId = session.providerId
      next.model = session.model
      setSession(next)
      stream.reset()
    } else if (effect.kind === 'branch-session') {
      const next = props.sessions.branch()
      setSession(next)
      stream.reset()
    } else if (effect.kind === 'compact') {
      await props.compactSession(session)
    }
  }, [session, props, stream])

  const handleSubmit = useCallback(async (raw: string) => {
    setInput('')
    if (raw.startsWith('/')) {
      const parsed = (await import('../slash/registry')).SlashRegistry.parse(raw)
      if (!parsed) return
      const cmd = props.slash.find(parsed.name)
      if (!cmd) return
      const res = await cmd.run(parsed.args, {
        sessions: props.sessions,
        providers: props.providers,
        config: props.config,
      })
      if (res.type === 'exit') { props.onExit(); exit() }
      else if (res.type === 'dialog') setDialog(res.dialog as any)
      else if (res.type === 'effect') await handleSlashEffect(res.effect)
      return
    }
    if (stream.running) {
      session.queue.push(raw)  // /btw semantics: pressing enter while running queues
      return
    }
    await stream.send(raw)
  }, [props, session, stream, handleSlashEffect, exit])

  useInput((input, key) => {
    if (key.escape) {
      if (stream.running) { stream.cancel(); return }
      if (primedQuit) { props.onExit(); exit() }
      else { setPrimedQuit(true); setTimeout(() => setPrimedQuit(false), 2000) }
    }
  })

  const streamingMsg = null // Phase 1 renders via messages[]; streaming text is appended via runAgent pushing to session.messages
  const contextUsed = session.totalUsage.inputTokens + session.totalUsage.outputTokens
  const contextMax = 200_000
  const pc = props.providers.getProviderConfig(session.providerId)
  const cost = pc ? computeCost(pc, session.model, session.totalUsage) : 0
  const hintMode: 'idle' | 'running' | 'awaiting-user' | 'primed-quit' =
    dialog ? 'awaiting-user' : stream.running ? 'running' : primedQuit ? 'primed-quit' : 'idle'

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        {session.messages.length === 0
          ? <Welcome
              cwd={props.cwd}
              gitBranch={props.gitBranch}
              model={session.model}
              version={props.version}
              tip={tip}
            />
          : <Messages items={session.messages} streaming={streamingMsg} />}
      </Box>

      {dialog?.kind === 'permission' && (
        <PermissionDialog
          call={dialog.call}
          suggestedPattern={dialog.suggestedPattern}
          onDecide={d => { dialog.resolve(d); setDialog(null) }}
        />
      )}
      {dialog?.kind === 'model-picker' && (
        <ModelPicker
          providers={props.providers.listProviders()}
          onSelect={(providerId, model) => { session.providerId = providerId; session.model = model; setDialog(null) }}
          onAddProvider={() => { /* Phase 1: no-op stub; a wizard lives in a follow-up */ setDialog(null) }}
          onRefresh={async (providerId) => props.providers.fetchRemoteModels(providerId)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'config-editor' && (
        <ConfigEditor
          configPath={`${process.env.HOME}/.nuka/config.yaml`}
          preview={JSON.stringify(props.config, null, 2)}
          onOpen={() => { props.onOpenEditor(); setDialog(null) }}
          onClose={() => setDialog(null)}
        />
      )}

      <PromptInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={!!dialog}
        placeholder=""
      />
      <StatusBar
        model={session.model}
        cwd={props.cwd}
        gitBranch={props.gitBranch}
        contextUsed={contextUsed}
        contextMax={contextMax}
        cost={cost}
        mcpCount={0}
        autoMode="off"
        queueLength={session.queue.size()}
        mode={hintMode}
      />
    </Box>
  )
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm test test/tui/app.test.tsx`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/tui/App.tsx test/tui/app.test.tsx
git commit -m "feat(tui): add App wiring messages, dialogs, input, status bar"
```

---

### Task 46: cli.tsx entry + e2e smoke test

**Files:**
- Modify: `src/cli.tsx` (replace placeholder)
- Create: `test/e2e/smoke.test.ts`

- [ ] **Step 1: Replace cli.tsx with real wiring**

```tsx
// src/cli.tsx
import React from 'react'
import { render } from 'ink'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { App } from './tui/App'
import { loadConfig } from './core/config/load'
import { ProviderResolver } from './core/provider/resolver'
import { SessionManager } from './core/session/manager'
import { ToolRegistry } from './core/tools/registry'
import { PermissionCache } from './core/permission/cache'
import { PermissionChecker } from './core/permission/checker'
import { suggestPattern } from './core/permission/suggest'
import { SlashRegistry } from './slash/registry'
import { ExitCommand } from './slash/exit'
import { HelpCommand } from './slash/help'
import { ClearCommand } from './slash/clear'
import { NewCommand } from './slash/new'
import { BranchCommand } from './slash/branch'
import { BtwCommand } from './slash/btw'
import { CostCommand } from './slash/cost'
import { ModelCommand } from './slash/model'
import { ConfigCommand } from './slash/config'
import { CompactCommand } from './slash/compact'
import { ReadTool } from './core/tools/read'
import { WriteTool } from './core/tools/write'
import { EditTool } from './core/tools/edit'
import { BashTool } from './core/tools/bash'
import { GlobTool } from './core/tools/glob'
import { GrepTool } from './core/tools/grep'
import { currentGitBranch } from './core/session/telemetry'
import { runAgent as runAgentLoop } from './core/agent/loop'
import { buildSystemPrompt } from './core/agent/systemPrompt'
import { compactSession } from './core/compact/compact'
import { globalConfigPath } from './core/config/paths'
import { MACRO_VERSION } from './version'

async function main(): Promise<void> {
  const cwd = process.cwd()
  const config = await loadConfig({ home: os.homedir(), cwd })

  if (config.providers.length === 0) {
    console.error(
      `No providers configured.\nAdd one to ${globalConfigPath()} — see docs/superpowers/specs/2026-04-23-nuka-rewrite-design.md §4.3`,
    )
    process.exit(2)
  }

  const providers = new ProviderResolver(config)
  const sessions = new SessionManager()
  const activeProviderId = config.active.providerId || config.providers[0].id
  const activeProvider = config.providers.find(p => p.id === activeProviderId)
  if (!activeProvider) {
    console.error(`active.providerId references unknown provider: ${activeProviderId}`)
    process.exit(2)
  }
  const activeModel = activeProvider.selectedModel ?? activeProvider.models?.[0] ?? ''
  sessions.start({ providerId: activeProvider.id, model: activeModel })

  const tools = new ToolRegistry()
  ;[ReadTool, WriteTool, EditTool, BashTool, GlobTool, GrepTool].forEach(t => tools.register(t as any))

  // askUser is populated by App via a side channel; wire a promise-based bridge:
  type PermQ = {
    resolve: (d: any) => void
    payload: { call: any; suggestedPattern?: string }
  }
  const pendingPerm: { current: PermQ | null } = { current: null }
  const askUser = (call: any) =>
    new Promise<any>((resolve) => {
      pendingPerm.current = { resolve, payload: { call, suggestedPattern: suggestPattern(call) } }
      // Trigger App rerender by setting window global — replaced with a proper event bus on follow-up iteration.
      ;(globalThis as any).__NUKA_PERM__?.(pendingPerm.current.payload, resolve)
    })

  const permission = new PermissionChecker(new PermissionCache(), askUser)

  const slash = new SlashRegistry()
  ;[ExitCommand, HelpCommand, ClearCommand, NewCommand, BranchCommand, BtwCommand, CostCommand, ModelCommand, ConfigCommand, CompactCommand].forEach(c => slash.register(c))

  const nodeVersion = process.version
  const shell = process.env.SHELL ?? '/bin/sh'
  const platform = process.platform
  const gitBranch = currentGitBranch(cwd)

  const runAgent = (input: any, session: any, signal: AbortSignal) =>
    runAgentLoop(input, session, {
      provider: providers,
      tools,
      permission,
      systemPromptInput: () => ({
        cwd, platform, shell, nodeVersion, gitBranch,
      }),
    }, signal)

  render(
    <App
      sessions={sessions}
      slash={slash}
      providers={providers}
      config={config}
      runAgent={runAgent}
      onExit={() => process.exit(0)}
      onOpenEditor={() => {
        const editor = process.env.EDITOR ?? 'vi'
        spawn(editor, [globalConfigPath()], { stdio: 'inherit' })
      }}
      compactSession={async (s) => {
        const { provider, model } = providers.resolveFor(s)
        await compactSession(s, { provider, model, keepTurns: config.compact?.keepTurns ?? 3 })
      }}
      cwd={cwd}
      gitBranch={gitBranch}
      version={MACRO_VERSION}
    />,
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Create version file**

```ts
// src/version.ts
export const MACRO_VERSION = '0.1.0'
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: typecheck passes; esbuild produces `dist/cli.js`.

- [ ] **Step 4: Write e2e smoke test**

```ts
// test/e2e/smoke.test.ts
import { describe, it, expect } from 'vitest'
import { execa } from 'execa'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

describe('cli smoke', () => {
  it('exits non-zero when no providers are configured', async () => {
    const home = mkdtempSync(join(os.tmpdir(), 'nuka-smoke-'))
    const res = await execa('node', ['dist/cli.js'], {
      reject: false,
      env: { HOME: home, PATH: process.env.PATH ?? '' },
      timeout: 3000,
    })
    expect(res.exitCode).toBe(2)
    expect(res.stderr).toMatch(/No providers configured/)
  })
})
```

- [ ] **Step 5: Run e2e test**

Run: `pnpm build && pnpm test test/e2e/smoke.test.ts`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add src/cli.tsx src/version.ts test/e2e/smoke.test.ts
git commit -m "feat(cli): wire up App with providers, tools, slash commands, and permission bridge"
```

---

## Phase 1 Completion Gate

Run the full verification before declaring Phase 1 done:

- [ ] `pnpm typecheck` — zero errors
- [ ] `pnpm test` — all suites pass
- [ ] `pnpm build` — `dist/cli.js` produced, executable
- [ ] Manual walk: populate `~/.nuka/config.yaml` with one provider (Anthropic or OpenAI), run `nuka`, verify:
  - Welcome screen shows logo + random tip + status bar
  - `/help` lists all ten commands
  - Asking the agent to read a file triggers `Read` with permission auto-allow
  - Asking to edit a file triggers `Edit` with permission dialog
  - `/model` opens root menu; drilling in shows models + `[↻] Refresh` + `[← Back]`
  - Selecting a model persists `selectedModel` + `active.providerId` in `~/.nuka/config.yaml`
  - `/btw foo` while the agent is running enqueues without interruption, flushes at turn boundary
  - `/branch` forks a session; swapping via a follow-up `/switch` (Phase 2) not required here — the session list in `SessionManager.list()` should show two entries
  - `/compact` replaces older messages with a single summary
  - `esc` cancels a running turn; a second `esc` quits

Spec §4.12 criteria 1–11 must all pass.

---
## §K · Phase 2 — Extensions (Milestone Plan)

Phase 2 detail is intentionally at milestone-level: one group per feature, listing the files and acceptance criteria but not every TDD step. Before starting Phase 2, expand the spec §5 sections into full designs, then expand each milestone here into §D-style bite-sized tasks with runnable test/impl steps.

### Milestone K1: Skill system

**Purpose:** Load markdown skills (`~/.nuka/skills/*.md`, `<cwd>/.nuka/skills/*.md`) and inject them into the system prompt (always-on) or as transient system messages (triggered).

**Touches:**
- New `src/core/skill/` — `types.ts` (frontmatter schema), `loader.ts` (disk scan + parse), `activator.ts` (evaluate triggers), `skillTool.ts` (built-in `Skill` tool letting the agent load a skill by name).
- `src/core/agent/systemPrompt.ts` — extended to append always-on skills.
- `src/core/tools/registry.ts` — accept `source: 'skill'` tools.

**Acceptance:**
1. `~/.nuka/skills/foo.md` with `name: foo`, `when: on-session-start` appends its body to the system prompt.
2. A skill with `when: { keyword: ["test", "tdd"] }` injects its body as a transient system message when the user turn contains those keywords.
3. The `Skill` tool lets the agent call `Skill({ name: 'foo' })` and receive confirmation; subsequent turn sees the skill content.
4. Project skills override global skills with the same name.

### Milestone K2: Session persistence

**Purpose:** Append-only JSONL per session + `.meta.json` sidecar; `/resume`, `/history`, `/delete-session`; `--resume` CLI flag.

**Touches:**
- New `src/core/session/store.ts` — JSONL writer/reader, meta serialization.
- `src/core/session/manager.ts` — wire `start`/`new`/`branch` to persist messages incrementally.
- New slash commands: `src/slash/resume.ts`, `src/slash/history.ts`, `src/slash/delete-session.ts`.
- `src/cli.tsx` — handle `--resume`, list sessions on demand.

**Acceptance:**
1. Each message append writes one JSONL line immediately (crash-safe).
2. `.meta.json` updated on totalUsage / cache changes via debounced write.
3. `/resume` opens a picker of recent sessions; selecting one restores identical state.
4. `nuka --resume` picks the most recent session without prompting.
5. `/delete-session <id>` removes both files after confirmation.

### Milestone K3: Streaming tool output

**Purpose:** `ToolContext.onProgress` becomes active; UI renders live tool output blocks.

**Touches:**
- `src/core/tools/bash.ts` — pipe `execa`'s `.stdout.on('data', ...)` and `.stderr.on('data', ...)` into `onProgress` line by line.
- `src/tui/Messages/ToolCall.tsx` — add a live-output collapse region.
- `src/core/agent/loop.ts` — plumb progress events into `AgentEvent` as `tool_progress`.
- `src/tui/hooks/useAgentStream.ts` — handle `tool_progress` events.

**Acceptance:**
1. `npm test` long-running command shows progressive output lines in the UI.
2. On error exit the final collapsed block shows the full tail.
3. `esc` cancels and the UI reflects that the process was aborted.

### Milestone K4: Auto-compact

**Purpose:** When `tokens(messages) > contextWindow × autoThreshold`, run the §H/Task 30 compactor automatically.

**Touches:**
- New `src/core/compact/auto.ts` — threshold check + announce banner.
- `src/core/agent/loop.ts` — call auto-compact between turns.
- `src/core/config/schema.ts` — already has `compact.keepTurns`; add `compact.autoThreshold` (default 0.80) and `compact.model` (optional override).

**Acceptance:**
1. With a low `autoThreshold`, the loop triggers compact automatically.
2. A muted system banner announces "context compacted".
3. `compact.model` override is honored: summarizer runs on the configured model even if the session uses a different one.

### Milestone K5: More built-in tools

**TodoWrite** — session-scoped, replace-all of `items: [{title, status}]`.
**WebFetch** — HTTP GET + `turndown` markdown conversion; `network` permission.
**WebSearch** — configurable search endpoint (Brave / DuckDuckGo / user-provided), returns summarized results.

**Touches:**
- `src/core/tools/todoWrite.ts`
- `src/core/tools/webFetch.ts`
- `src/core/tools/webSearch.ts`
- `src/core/config/schema.ts` — add `search.provider`, `search.apiKey`, `search.endpoint`.

**Acceptance:** each tool has its own test file; all are registered in `cli.tsx`; permission routing works for `network` hint.

### Milestone K6: Input niceties

**Touches:**
- `src/tui/PromptInput/PromptInput.tsx` — `@` opens file mention menu; `!` prefix captures into context.
- `src/tui/PromptInput/MentionPanel.tsx` (new) — fuzzy file search via fuse.js.
- `src/tui/PromptInput/useInputHistory.ts` — wire `↑`/`↓` in PromptInput.

**Acceptance:**
1. Typing `@pa` surfaces file paths starting with "pa"; selecting inserts content as a user attachment.
2. `!ls -la` runs the shell command locally and appends its output as a system message for the next turn (does not go through the agent loop).
3. `↑`/`↓` scroll through submitted prompts.

---

## §L · Phase 3 — External Integrations (Milestone Plan)

### Milestone L1: MCP client

**Purpose:** Connect to MCP servers over `stdio` and `sse` transports; surface their tools and resources.

**Touches:**
- New `src/core/mcp/` — `types.ts`, `client.ts` (wraps `@modelcontextprotocol/sdk`), `stdioTransport.ts`, `sseTransport.ts`, `toolAdapter.ts` (wraps MCP tool → Nuka `Tool`), `resourceAdapter.ts`.
- `src/core/tools/registry.ts` — accept `source: 'mcp'` with `mcp__<server>__<tool>` namespacing.
- Built-in tools: `ListMcpResources`, `ReadMcpResource`.
- `src/core/config/schema.ts` — `mcp.servers` block (transport, command/url, headers, env).
- `src/tui/StatusBar/` — green/yellow MCP indicator reflects real connection state.

**Acceptance:**
1. A configured stdio MCP server (e.g. `@modelcontextprotocol/server-filesystem`) exposes tools; the agent can call them end-to-end.
2. A configured SSE MCP server works equivalently.
3. Permission routing is unchanged.
4. Restarting with an unreachable server: the status-bar segment goes yellow but the CLI still boots.

### Milestone L2: Plugin system

**Purpose:** Local plugin directories (and later npm packages) contribute skills, tools, slash commands, and MCP servers.

**Touches:**
- New `src/core/plugin/` — `manifest.ts` (parse `plugin.yaml`), `loader.ts` (dynamic `import()` + sandboxing boundary), `installer.ts` (copy/symlink to `~/.nuka/plugins/` with confirmation).
- `src/cli.tsx` — `nuka plugin install <path-or-url>` subcommand.
- Namespacing: `plugin__<plugin-name>__<tool-name>`; slash `/<plugin-name>:<cmd>`.

**Acceptance:**
1. A sample plugin dropped in `~/.nuka/plugins/nuka-sample/` registers its skill, tool, slash command, and MCP server on next startup.
2. `nuka plugin install ./nuka-sample` copies it, prompts for confirmation, and prints namespacing summary.
3. Plugin-reported tool conflicts are logged and the earlier-registered source wins.

### Milestone L3: Unified tool registry

**Purpose:** Pass a single deduplicated, namespaced tool list to the provider.

**Touches:**
- `src/core/tools/registry.ts` — add source tagging, conflict resolution.
- `src/core/agent/loop.ts` — use the merged registry.
- `src/tui/Messages/ToolCall.tsx` — render source badge (builtin / skill / mcp / plugin).

**Acceptance:**
1. With one skill, one MCP server, and one plugin each contributing tools, the agent can discover and call tools from all three sources in the same turn.
2. Duplicate names are logged; the earlier registration wins.
3. UI badges visually distinguish the source.

---

## §M · Phase 4+ Backlog (not in this plan)

Tracked in spec §7. Items there must be expanded into their own design spec before a plan can be written for them:

- Plan Mode / Bypass Mode
- Sub-agents / Task tool
- Hooks
- Remote control (Telegram / Feishu / Discord)
- IDE integration
- OAuth login flows
- Voice input
- Images / attachments
- Smarter context management (context collapse, relevance eviction, memory prefetch)
- Plugin marketplace
- Telemetry / cost dashboards
- Native single-binary distribution

When starting any Phase 4+ item, first amend `docs/superpowers/specs/2026-04-23-nuka-rewrite-design.md` (or write a follow-up spec), then add a milestone or task section to this plan.

---

## Self-Review

Spec coverage sanity check against `docs/superpowers/specs/2026-04-23-nuka-rewrite-design.md`:

| Spec § | Coverage |
|---|---|
| §2 Architecture Overview | Tasks 4–5 (message types), 29 (loop), 9 (provider types), 14 (tool types), 21–23 (permission), 24–27 (session) |
| §3 TUI Design | Tasks 36 (theme), 37 (welcome/logo/tips), 38 (messages), 39 (prompt input), 40 (status bar), 41 (permission dialog), 42 (model picker), 43 (config editor) |
| §4.1 Directory layout | Task 1 (scaffolding) + structure realized by Tasks 4–46 |
| §4.2 Provider layer | Tasks 9–13 |
| §4.3 Config schema | Tasks 6–8, 33 (save) |
| §4.4 Built-in tools | Tasks 14–20 |
| §4.5 System prompt | Task 28 |
| §4.6 Permission system | Tasks 21–23 |
| §4.7 Session model | Tasks 24–26 |
| §4.8 Real `/compact` | Task 30 |
| §4.9 Ten slash commands | Tasks 31–35 |
| §4.10 TUI wiring | Task 45 |
| §4.11 Build and test | Tasks 1–3 + each implementation task |
| §4.12 Completion criteria | Phase 1 Completion Gate (post-Task 46) |
| §4.13 Explicit deferrals | Milestones K1–K6 (Phase 2), L1–L3 (Phase 3) |
| §5 Phase 2 | Milestones K1–K6 |
| §6 Phase 3 | Milestones L1–L3 |
| §7 Phase 4+ TODO | Reflected in §M |
| §8 Risks | Tests in Tasks 10/11 (SDK translation), 20 (rg fallback), 30 (compact), 42 (model picker flow) mitigate the top items |
| §9 Phase sequencing | Mirrors plan section order (A→J, K, L, M) |

**Type-consistency spot checks (names used across tasks):**
- `ProviderEvent.message_stop.stopReason` / `usage` — defined in Task 9; consumed in Tasks 10, 11, 29, 30.
- `LLMProvider.stream(req, signal)` / `.listRemoteModels()` — defined in Task 9; implemented in Tasks 10, 11; consumed in Tasks 13, 29, 30.
- `ProviderResolver.resolveFor(session)` / `.listProviders()` / `.fetchRemoteModels()` / `.getProviderConfig()` — defined in Task 13; consumed in Tasks 29, 45, 46.
- `Tool.needsPermission(input)` returning `PermissionHint` — defined in Task 14; consumed in Task 29.
- `PermissionChecker.check(call)` — defined in Task 23; consumed in Task 29.
- `SessionManager.{ start, new, branch, switch, active, list }` — defined in Task 26; consumed in Tasks 45, 46.
- `compactSession(session, opts)` — defined in Task 30; consumed in Tasks 34, 45, 46.
- `SlashResult` union (`text` / `dialog` / `effect` / `exit`) — defined in Task 31; consumed in Tasks 32–35 and App (Task 45).
- `AgentEvent` union — defined in Task 29; consumed in Tasks 44, 45.
- `Welcome` / `Messages` / `PromptInput` / `StatusBar` / dialog component props — all defined in Tasks 37–43; consumed in App (Task 45) exactly as defined.

**Placeholder scan:** no "TBD", "TODO in code", or "similar to …" shortcuts inside task bodies. Every task that changes code includes the actual code.

**Known scope notes:**
- The `/model` "Add provider…" wizard is intentionally a stub in Task 45 (focused add-provider dialog is a tight follow-up; plan doesn't fabricate its full detail to avoid inventing spec content).
- App.tsx uses a `globalThis.__NUKA_PERM__` bridge as a Phase-1-minimum permission event bus. It is functional but the tidier pattern (dedicated event emitter or React context) is a refactor target inside Phase 2; spec §4.6 does not prescribe a specific mechanism.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-nuka-rewrite-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task (46 Phase-1 tasks), review between tasks, fast iteration. Phase 2/3 milestones expanded into tasks as they are begun.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?










