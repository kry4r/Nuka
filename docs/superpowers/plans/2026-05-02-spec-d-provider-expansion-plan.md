# Spec D — Provider Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land four new providers (Gemini, Bedrock, Vertex, Local Ollama/llama.cpp) plus the abstraction extensions and supporting infra (model registry, SigV4 signer, cache-hint normalization, mid-session-switch handling, six-provider doctor) without regressing the existing two providers.

**Architecture:** Seven milestones (M1–M7). M1 is blocking. M2–M5 can land in parallel via subagents. M6 needs M2–M5. M7 closes the spec. All work is **type-first → unit-test-first → integration-last**. Source-of-truth spec: `docs/superpowers/specs/2026-05-02-spec-d-provider-expansion-design.md`.

**Tech stack:** TypeScript 5.6, Node ≥ 20 (native `fetch`, native `crypto`), vitest 2.1, zod 4.3, MSW 2.x for HTTP intercept. No new runtime deps.

---

## File structure

**New files (creation):**

```
src/core/provider/
  registry.ts                    § 5.4 — model registry + findModel/routeProviderId
  cacheHint.ts                   § 6.12 — defaultCacheHint(session)
  gemini.ts                      § 6.1 — GeminiProvider
  bedrock.ts                     § 6.2 — BedrockProvider
  vertex.ts                      § 6.3 — VertexProvider
  local.ts                       § 6.4 — LocalProvider + stub-tools
  aws/sigv4.ts                   § 6.7 — hand-rolled SigV4
  aws/eventstream.ts             § 6.2 — Bedrock event-stream frame parser
  aws/jwt.ts                     § 6.3 — service-account JWT signer

test/core/provider/
  registry.test.ts               registry lookups, prefix tolerance
  resolver.routing.test.ts       routeByModel for each routePrefix
  gemini.translate.test.ts       fixture-replay translation
  gemini.cache.test.ts           cachedContents create/reuse
  gemini.message.test.ts         Nuka Message → Gemini Content shape
  bedrock.sigv4.test.ts          AWS test-vector byte-exact reproduction
  bedrock.eventstream.test.ts    framing parser
  bedrock.translate.test.ts      end-to-end framed → Anthropic translation
  bedrock.refresh.test.ts        403 InvalidSignature → refresh once → retry
  vertex.jwt.test.ts             JWT signing with stable clock + skew
  vertex.translate.test.ts       Anthropic envelope on Vertex transport
  vertex.tokenrefresh.test.ts    401 → re-mint JWT
  local.translate.test.ts        Ollama and llama.cpp parametrized
  local.stubtools.test.ts        degraded path: tools rejected → stub-tools
  local.health.test.ts           ECONNREFUSED → ok:false
  cacheHint.test.ts              defaultCacheHint short-session skip rule

test/core/cost/
  pricing.registry.test.ts       registry-driven pricing lookups + overlay

test/core/onboarding/
  probes.gemini.test.ts          probeGemini + 4xx mapping
  probes.bedrock.test.ts         ListFoundationModels signed call
  probes.vertex.test.ts          token exchange path
  probes.local.test.ts           ECONNREFUSED + ok path

test/core/agent/
  forkedAgent.cachehint.test.ts  hint passthrough + Gemini cache reuse
  loop.reasoning.test.ts         reasoning_delta forwarded to AgentEvent
  loop.error.test.ts             non-retriable error short-circuits turn

test/core/slash/
  model.applyselection.test.ts   providerSwitches record + cacheKey reset

test/integration/
  provider-expansion.test.ts     6-provider parallel round-trip
  onboarding-providers.test.ts   wizard for each new template

test/fixtures/providers/
  gemini-stream.ndjson
  gemini-stream.expected.json
  gemini-cached-create.json
  gemini-cache-hit.expected.json
  bedrock-eventstream.bin
  bedrock-eventstream.expected.json
  bedrock-list-models.json
  bedrock-exception.bin
  vertex-token-exchange.json
  vertex-stream.ndjson
  vertex-stream.expected.json
  local-ollama-tags.json
  local-ollama-chat.ndjson
  local-ollama-chat.expected.json
  local-llamacpp-models.json
  local-llamacpp-chat.ndjson
  local-stub-tools-roundtrip.txt
  local-stub-tools.expected.json
  sigv4-suite.json
```

**Modified files:**

```
src/core/provider/types.ts        rewrite: extended interface, AuthConfig, CacheHint, ModelInfo
src/core/provider/anthropic.ts    auth shape; cache_control marker injection
src/core/provider/openai.ts       auth shape (one-line)
src/core/provider/resolver.ts     switch on (format, auth.kind); routeByModel
src/core/provider/remoteModels.ts gemini + local endpoint branches
src/core/cost/pricing.ts          registry-driven findPricing; overlay
src/core/onboarding/providerProbe.ts +4 probe variants
src/core/onboarding/templates.ts  +4 new templates
src/core/agent/forkedAgent.ts     cacheHint pass-through (one line)
src/core/agent/loop.ts            cacheHint default + reasoning/error fold
src/core/agent/events.ts          reasoning_delta + error AgentEvent variants
src/core/message/types.ts         assistant.reasoning, assistant.errorReason
src/core/session/types.ts         providerSwitches[], cacheKey
src/core/config/schema.ts         AuthConfigSchema discriminated union
src/core/config/load.ts           string apiKey back-compat (rewrite to auth.apiKey)
src/slash/model.ts                applyModelSelection helper
test/core/provider/anthropic.translate.test.ts   touch-up: assert cache_control absent when no hint
test/core/provider/openai.translate.test.ts      no change expected
docs/superpowers/specs/2026-05-02-spec-d-provider-expansion-design.md  appended notes if any
```

**Naming reconciliation:**

- `ProviderEvent` is the canonical adapter-output event. The agent loop yields `AgentEvent` (defined in `src/core/agent/events.ts`). Plan extends `AgentEvent` with `reasoning_delta` (mirroring `ProviderEvent.reasoning_delta`) and `error` (lowered from provider-level `error` events that are non-retriable). The two unions stay structurally aligned but separate; the loop is the bridge.

---

## Task 1: M1.T1 — Extend `LLMProvider` and supporting types (type-only first)

**Files:**
- Modify: `src/core/provider/types.ts`
- Test: `test/core/provider/types.test-d.ts` (NEW)

- [ ] **Step 1: Write the failing type test (TDD)**

Create `test/core/provider/types.test-d.ts`:

```ts
import { expectTypeOf } from 'vitest'
import type {
  AuthConfig, CacheHint, CachePolicy, LLMProvider, LLMRequest,
  ModelCapabilities, ModelInfo, ProviderEvent, ProviderErrorCode, ProviderFormat,
} from '../../../src/core/provider/types'

// ProviderFormat extended.
expectTypeOf<ProviderFormat>().toEqualTypeOf<
  'anthropic' | 'openai' | 'google' | 'local-openai'
>()

// CachePolicy locked.
expectTypeOf<CachePolicy>().toEqualTypeOf<
  'anthropic-explicit' | 'gemini-context' | 'none'
>()

// AuthConfig has 5 variants discriminated by `kind`.
expectTypeOf<AuthConfig>().toMatchTypeOf<{ kind: string }>()
expectTypeOf<Extract<AuthConfig, { kind: 'apiKey' }>>().toMatchTypeOf<{ apiKey: string }>()
expectTypeOf<Extract<AuthConfig, { kind: 'awsCreds' }>>().toMatchTypeOf<{
  accessKeyId: string; secretAccessKey: string; region: string
}>()
expectTypeOf<Extract<AuthConfig, { kind: 'serviceAccount' }>>().toMatchTypeOf<{
  filePath: string; project: string; location: string
}>()
expectTypeOf<Extract<AuthConfig, { kind: 'bearerRefresh' }>>().toMatchTypeOf<{
  token: string; exp: number
}>()
expectTypeOf<Extract<AuthConfig, { kind: 'none' }>>().toEqualTypeOf<{ kind: 'none' }>()

// ProviderEvent extended additively.
expectTypeOf<ProviderEvent>().toMatchTypeOf<
  | { type: 'text_delta' } | { type: 'tool_use_start' } | { type: 'tool_use_args_delta' }
  | { type: 'tool_use_stop' } | { type: 'message_stop' }
  | { type: 'reasoning_delta' } | { type: 'error' } | { type: 'cache_hit' }
>()

// ProviderErrorCode union.
expectTypeOf<ProviderErrorCode>().toEqualTypeOf<
  'auth_refresh_failed' | 'rate_limited' | 'service_unavailable'
  | 'model_not_found' | 'context_too_large' | 'tool_schema_unsupported' | 'unknown'
>()

// ModelInfo and ModelCapabilities are concrete.
expectTypeOf<ModelInfo>().toMatchTypeOf<{
  id: string; providerId: string; displayName: string; capabilities: ModelCapabilities
}>()

// LLMRequest gains optional cacheHint.
expectTypeOf<LLMRequest>().toMatchTypeOf<{ cacheHint?: CacheHint }>()

// LLMProvider gains cachePolicy + auth.
expectTypeOf<LLMProvider>().toMatchTypeOf<{
  readonly cachePolicy: CachePolicy
  readonly auth: AuthConfig
}>()
```

This test fails to compile until step 2 lands.

- [ ] **Step 2: Implement the new types**

Replace `src/core/provider/types.ts` with the schema in spec §5.1 verbatim. Preserve the existing exports (`ProviderFormat`, `ToolSpec`, `Effort`, `LLMRequest`, `ProviderEvent`, `LLMProvider`) and add `CachePolicy`, `AuthConfig`, `CacheHint`, `ProviderErrorCode`, `ModelCapabilities`, `ModelInfo`. **No method bodies** in this task — only types.

- [ ] **Step 3: Run type test**
```bash
npx vitest run test/core/provider/types.test-d.ts
```
Expected: 0 failures, 0 type errors.

- [ ] **Step 4: Compile remaining code; expect 5–10 errors**
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -30
```
Expected errors are in `anthropic.ts:13-18`, `openai.ts:12-17`, `resolver.ts:38-52`, `forkedAgent.ts:62-72`, `loop.ts:252-261`. They will be repaired in Tasks 2–5.

**Acceptance criteria:**
- Type test passes.
- `tsc --noEmit` reports compilation errors *only* in the four files above.
- No runtime test in `test/core/provider/` is affected.

**Estimated LOC:** ~120 LOC types, ~60 LOC test. **Estimated time:** 0.5 hr.

---

## Task 2: M1.T2 — Migrate `AnthropicProvider` to new opts shape

**Files:**
- Modify: `src/core/provider/anthropic.ts:13-37`
- Test: `test/core/provider/anthropic.translate.test.ts` (existing — should stay green)
- Test: `test/core/provider/anthropic.cachecontrol.test.ts` (NEW)

- [ ] **Step 1: Write failing cache-control test**

Create `test/core/provider/anthropic.cachecontrol.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AnthropicProvider } from '../../../src/core/provider/anthropic'

describe('AnthropicProvider cache_control injection', () => {
  it('attaches cache_control on the message at each breakpoint index', () => {
    const p = new AnthropicProvider({
      id: 'a', auth: { kind: 'apiKey', apiKey: 'k' },
      baseUrl: 'https://api.anthropic.com',
    })
    const messages = [/* 5 user/assistant messages */]
    const body = (p as any)._buildBody({
      model: 'claude-sonnet-4-6', system: '', messages,
      tools: [], cacheHint: { breakpoints: [2, 4] },
    })
    // Message 2: last text block has cache_control.
    expect(body.messages[2].content.at(-1).cache_control).toEqual({ type: 'ephemeral' })
    // Message 4: same.
    expect(body.messages[4].content.at(-1).cache_control).toEqual({ type: 'ephemeral' })
    // Other messages: no cache_control.
    expect(body.messages[0].content.at(-1).cache_control).toBeUndefined()
  })

  it('omits cache_control when no hint provided', () => { /* ... */ })
})
```

- [ ] **Step 2: Refactor `AnthropicOpts` → `AuthConfig` adoption**

In `src/core/provider/anthropic.ts:13-18`, replace:

```ts
type AnthropicOpts = {
  id: string
  apiKey: string
  baseUrl: string
  extraHeaders?: Record<string, string>
}
```

with:

```ts
type AnthropicOpts = {
  id: string
  auth: Extract<AuthConfig, { kind: 'apiKey' }>
  baseUrl: string
  extraHeaders?: Record<string, string>
}
```

Update constructor (`anthropic.ts:28-38`) to read `opts.auth.apiKey`. Add `readonly cachePolicy = 'anthropic-explicit'` and `readonly auth: AuthConfig`. Preserve `format = 'anthropic'`.

- [ ] **Step 3: Extract `_buildBody` for testability + cache_control injection**

Refactor the inline body construction in `stream()` (`anthropic.ts:40-65`) into a private `_buildBody(req: LLMRequest): unknown` method. This method:
1. Constructs `messages` via the existing `toAnthropicMessages` helper.
2. If `req.cacheHint?.breakpoints` is non-empty, walks the resulting `messages[]` and appends `cache_control: {type: 'ephemeral'}` to the **last content block** of each indexed message. Out-of-bounds indices are silently skipped.
3. Returns the params object.

`stream()` becomes a thin wrapper: `const params = this._buildBody(req); const sdkStream = this.client.messages.stream(params as any, {signal}); ...`.

- [ ] **Step 4: Test**
```bash
npx vitest run test/core/provider/anthropic.translate.test.ts
npx vitest run test/core/provider/anthropic.cachecontrol.test.ts
```
Expected: both green.

**Acceptance criteria:**
- Existing `anthropic.translate.test.ts` continues to pass.
- New cache-control test passes.
- `AnthropicProvider` exposes `auth` and `cachePolicy` per the new interface.

**Estimated LOC:** +60 / -25 LOC src, +120 LOC test. **Estimated time:** 1 hr.

---

## Task 3: M1.T3 — Migrate `OpenAIProvider` to new opts shape

**Files:**
- Modify: `src/core/provider/openai.ts:12-37`
- Test: `test/core/provider/openai.translate.test.ts` (existing)

- [ ] **Step 1: Adapt `OpenAIOpts` to take `auth: AuthConfig`**

In `openai.ts:12-17`, replace:

```ts
type OpenAIOpts = { id: string; apiKey: string; baseUrl: string; extraHeaders?: ... }
```

with:

```ts
type OpenAIOpts = {
  id: string
  auth: Extract<AuthConfig, { kind: 'apiKey' }>
  baseUrl: string
  extraHeaders?: Record<string, string>
}
```

Constructor reads `opts.auth.apiKey`. Add `readonly cachePolicy = 'none'` and `readonly auth: AuthConfig`.

- [ ] **Step 2: No translation changes required**

OpenAI translate logic at `openai.ts:73-130` is unchanged. `stream()` body construction unchanged.

- [ ] **Step 3: Test**
```bash
npx vitest run test/core/provider/openai.translate.test.ts
```
Expected: green.

**Acceptance criteria:**
- All existing OpenAI tests green.
- `OpenAIProvider` exposes `auth: AuthConfig` and `cachePolicy: 'none'`.

**Estimated LOC:** +20 / -15 LOC. **Estimated time:** 0.5 hr.

---

## Task 4: M1.T4 — Extend `ConfigSchema` with discriminated `AuthConfigSchema`

**Files:**
- Modify: `src/core/config/schema.ts:1-23`, `src/core/config/load.ts`
- Test: `test/core/config/schema.authconfig.test.ts` (NEW)

- [ ] **Step 1: Write failing schema tests**

Create `test/core/config/schema.authconfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ProviderConfigSchema } from '../../../src/core/config/schema'

describe('ProviderConfigSchema with AuthConfig', () => {
  it('parses apiKey variant', () => {
    const ok = ProviderConfigSchema.safeParse({
      id: 'a', name: 'Anthropic', format: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      auth: { kind: 'apiKey', apiKey: 'sk-ant-x' },
    })
    expect(ok.success).toBe(true)
  })
  it('parses awsCreds variant', () => { /* ... */ })
  it('parses serviceAccount variant', () => { /* ... */ })
  it('parses bearerRefresh variant', () => { /* ... */ })
  it('parses none variant', () => { /* ... */ })
  it('rejects awsCreds without region', () => { /* ... */ })
  it('rejects unknown auth.kind', () => { /* ... */ })
  // Back-compat path:
  it('legacy top-level apiKey is rewritten by load.ts', async () => {
    const { migrateLegacyApiKey } = await import('../../../src/core/config/load')
    const out = migrateLegacyApiKey({
      id: 'a', name: 'A', format: 'openai', baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-old',
    })
    expect(out.auth).toEqual({ kind: 'apiKey', apiKey: 'sk-old' })
    expect((out as any).apiKey).toBeUndefined()
  })
})
```

- [ ] **Step 2: Implement the schema**

In `src/core/config/schema.ts`:
- Add `AuthConfigSchema` per spec §5.2 (5-variant `z.discriminatedUnion('kind', [...])`).
- Update `ProviderConfigSchema`: replace `apiKey: z.string().optional()` with `auth: AuthConfigSchema`.
- Add `options: z.record(z.string(), z.unknown()).optional()` field.
- Add the new top-level `detectLocal: z.boolean().default(false)` field on `ConfigSchema`.

- [ ] **Step 3: Implement back-compat in `load.ts`**

Add `migrateLegacyApiKey(raw): ProviderConfig` helper that:
1. Detects `raw.apiKey` is a string AND `raw.auth` is undefined.
2. Returns `{...raw, auth: {kind: 'apiKey', apiKey: raw.apiKey}, apiKey: undefined}`.
3. Otherwise returns `raw` unchanged.

Wire into the config loader pipeline (before zod parsing).

- [ ] **Step 4: Test**
```bash
npx vitest run test/core/config/schema.authconfig.test.ts
```
Expected: all green.

**Acceptance criteria:**
- New schema test green.
- Existing tests in `test/core/config/` continue passing (back-compat works).
- Loading a v1 config (`apiKey: "..."`) silently rewrites to `auth: {kind: 'apiKey', ...}`.

**Estimated LOC:** +80 / -10 LOC src, +150 LOC test. **Estimated time:** 1 hr.

---

## Task 5: M1.T5 — Refactor `ProviderResolver.buildInstance`

**Files:**
- Modify: `src/core/provider/resolver.ts:37-77`
- Test: `test/core/provider/resolver.test.ts` (existing) + `resolver.routing.test.ts` (NEW)

- [ ] **Step 1: Write failing routing test**

Create `test/core/provider/resolver.routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ProviderResolver } from '../../../src/core/provider/resolver'

describe('ProviderResolver.routeByModel', () => {
  it('routes claude-* to anthropic if registered', () => { /* ... */ })
  it('routes gpt-* to openai', () => { /* ... */ })
  it('routes o-prefixed to openai (o3-mini)', () => { /* ... */ })
  it('routes gemini-* to gemini', () => { /* ... */ })
  it('routes bedrock:* to bedrock', () => { /* ... */ })
  it('routes vertex:* to vertex', () => { /* ... */ })
  it('routes local:* to local', () => { /* ... */ })
  it('returns undefined when prefix matches but provider not registered', () => { /* ... */ })
  it('falls back to first prefix-match if multiple providers configured', () => { /* ... */ })
})
```

- [ ] **Step 2: Implement extended `buildInstance` switch**

Replace `resolver.ts:37-52` body with the spec §6.6 switch. Branches:
- `format='anthropic'` + `auth.kind='awsCreds'` → `BedrockProvider`
- `format='anthropic'` + `auth.kind='serviceAccount'` → `VertexProvider`
- `format='anthropic'` + `auth.kind='apiKey'` → `AnthropicProvider`
- `format='openai'` → `OpenAIProvider` (auth.kind must be `apiKey`)
- `format='google'` → `GeminiProvider` (look at `pc.options?.flavor`)
- `format='local-openai'` → `LocalProvider` (look at `pc.options?.transport`)

Imports for `Bedrock/Vertex/Gemini/Local` are placeholder until M2–M5 land. Until then, import them lazily inside their case arm so M1 can ship before M2–M5.

```ts
case 'google': {
  const { GeminiProvider } = await import('./gemini')  // dynamic import
  return new GeminiProvider({...})
}
```

NOTE: Switching `buildInstance` to async breaks the constructor. Cleaner: synchronous static imports, but the new files must exist as stubs that throw on `stream()` until their respective milestone lands. Choose path B: ship M1.T5 with stub files (Tasks 6 / 11 / 14 / 17 each create a stub class first and replace its body in their respective milestones).

- [ ] **Step 3: Implement `routeByModel`**

```ts
import { findModel } from './registry'

routeByModel(modelId: string): { providerId: string; model: string } | undefined {
  const entry = findModel(modelId)
  if (entry && this.byId.has(entry.providerId)) {
    return { providerId: entry.providerId, model: entry.id }
  }
  // Prefix fallback: scan registry for routePrefix matches.
  for (const e of MODEL_REGISTRY) {
    if (e.routePrefix && modelId.startsWith(e.routePrefix) && this.byId.has(e.providerId)) {
      return { providerId: e.providerId, model: modelId }
    }
  }
  return undefined
}
```

- [ ] **Step 4: Test**
```bash
npx vitest run test/core/provider/resolver.test.ts test/core/provider/resolver.routing.test.ts
```

**Acceptance criteria:**
- Existing resolver tests green.
- Routing test green.
- M1 done — milestone gate.

**Estimated LOC:** +80 / -20 LOC src, +180 LOC test. **Estimated time:** 1.5 hr.

---

## Task 6: M1.T6 — Stub provider classes for M2–M5 to replace

**Files:** NEW: `gemini.ts`, `bedrock.ts`, `vertex.ts`, `local.ts`, `aws/sigv4.ts`, `aws/eventstream.ts`, `aws/jwt.ts`

- [ ] **Step 1: Create stub files**

Each new file exports a class implementing `LLMProvider` with `stream()` throwing `new Error('not implemented: <ProviderName> ships in M<N>')` and `listRemoteModels()` returning `[]`. This unblocks `resolver.ts` static imports without breaking `tsc --noEmit`.

```ts
// src/core/provider/gemini.ts (M1 stub)
import type { LLMProvider, AuthConfig, LLMRequest, ProviderEvent } from './types'
export type GeminiOpts = { id: string; baseUrl: string;
  auth: Extract<AuthConfig, { kind: 'apiKey' }>;
  flavor: 'aiStudio' | 'vertex'; options?: { safetyOff?: boolean } }
export class GeminiProvider implements LLMProvider {
  readonly id: string; readonly format = 'google' as const
  readonly cachePolicy = 'gemini-context' as const; readonly auth: AuthConfig
  constructor(opts: GeminiOpts) { this.id = opts.id; this.auth = opts.auth }
  async *stream(_req: LLMRequest, _signal: AbortSignal): AsyncIterable<ProviderEvent> {
    throw new Error('not implemented: GeminiProvider ships in M2')
  }
  async listRemoteModels(): Promise<string[]> { return [] }
}
```

Same shape for `bedrock.ts` (`format = 'anthropic'`, `cachePolicy = 'none'`), `vertex.ts` (`format='anthropic'`, `cachePolicy='anthropic-explicit'`), `local.ts` (`format='local-openai'`, `cachePolicy='none'`).

- [ ] **Step 2: Verify `tsc --noEmit` is now clean**
```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Verify resolver tests still green**
```bash
npx vitest run test/core/provider/resolver.test.ts
```

**Acceptance criteria:**
- Stubs compile.
- Resolver instantiates stubs without runtime error (calling `.stream()` throws — but `resolver.test.ts` doesn't call it).

**Estimated LOC:** ~50 LOC × 4 stubs = 200 LOC. **Estimated time:** 0.5 hr.

---

## Task 7: M1.T7 — Build `ModelRegistry`

**Files:** NEW: `src/core/provider/registry.ts`, `test/core/provider/registry.test.ts`

- [ ] **Step 1: Write failing tests**

`test/core/provider/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findModel, routeProviderId, MODEL_REGISTRY } from '../../../src/core/provider/registry'

describe('ModelRegistry', () => {
  it('finds claude-opus-4-7 by exact id', () => {
    expect(findModel('claude-opus-4-7')?.providerId).toBe('anthropic')
  })
  it('returns undefined for unknown id', () => {
    expect(findModel('nonexistent-model')).toBeUndefined()
  })
  it('case-insensitive match', () => {
    expect(findModel('CLAUDE-OPUS-4-7')?.id).toBe('claude-opus-4-7')
  })
  it('strips provider/ prefix', () => {
    expect(findModel('anthropic/claude-opus-4-7')?.id).toBe('claude-opus-4-7')
  })
  it('routes gemini-* to gemini', () => {
    expect(routeProviderId('gemini-2.0-flash')).toBe('gemini')
  })
  it('routes bedrock:* to bedrock', () => {
    expect(routeProviderId('bedrock:anthropic.claude-sonnet-4-6-v1')).toBe('bedrock')
  })
  it('every entry has positive maxTokens', () => {
    for (const e of MODEL_REGISTRY) expect(e.capabilities.maxTokens).toBeGreaterThan(0)
  })
  it('every entry has non-negative pricing', () => {
    for (const e of MODEL_REGISTRY) {
      expect(e.capabilities.pricing.input).toBeGreaterThanOrEqual(0)
      expect(e.capabilities.pricing.output).toBeGreaterThanOrEqual(0)
    }
  })
})
```

- [ ] **Step 2: Implement registry per spec §5.4**

Create `src/core/provider/registry.ts` with the full `MODEL_REGISTRY` array (14 entries: 3 Anthropic + 4 OpenAI + 2 Gemini + 2 Bedrock + 1 Vertex + 2 Local), `findModel(id)`, and `routeProviderId(modelId)`.

- [ ] **Step 3: Test**
```bash
npx vitest run test/core/provider/registry.test.ts
```

**Acceptance criteria:**
- 8/8 tests green.
- Registry has at least 14 entries.

**Estimated LOC:** ~180 LOC src, ~120 LOC test. **Estimated time:** 1 hr.

---

## Task 8: M1.T8 — Wire `cacheHint` through `forkedAgent.ts` and `loop.ts`

**Files:**
- Modify: `src/core/agent/forkedAgent.ts:62-72`
- Modify: `src/core/agent/loop.ts:252-261`
- NEW: `src/core/provider/cacheHint.ts`
- Test: `test/core/provider/cacheHint.test.ts` (NEW)
- Test: `test/core/agent/forkedAgent.cachehint.test.ts` (NEW)

- [ ] **Step 1: Write failing tests**

`test/core/provider/cacheHint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defaultCacheHint } from '../../../src/core/provider/cacheHint'

describe('defaultCacheHint', () => {
  it('returns undefined for empty session', () => {
    expect(defaultCacheHint({ messages: [] } as any)).toBeUndefined()
  })
  it('returns undefined for sessions with < 4 messages', () => {
    const s = { messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'user' }] }
    expect(defaultCacheHint(s as any)).toBeUndefined()
  })
  it('returns last-message breakpoint for ≥ 4 messages', () => {
    const s = { messages: Array(5).fill({ role: 'user' }), cacheKey: 'cachedContents/abc' }
    expect(defaultCacheHint(s as any)).toEqual({ breakpoints: [4], cacheId: 'cachedContents/abc' })
  })
  it('omits cacheId field when session has no cacheKey', () => { /* ... */ })
})
```

- [ ] **Step 2: Implement**

```ts
// src/core/provider/cacheHint.ts
import type { Session } from '../session/types'
import type { CacheHint } from './types'

export function defaultCacheHint(session: Session): CacheHint | undefined {
  if (session.messages.length < 4) return undefined
  const hint: CacheHint = { breakpoints: [session.messages.length - 1] }
  if (session.cacheKey) hint.cacheId = session.cacheKey
  return hint
}
```

- [ ] **Step 3: Wire into `loop.ts:252-261`**

Add `import { defaultCacheHint } from '../provider/cacheHint'`. Add `cacheHint: defaultCacheHint(session)` to the `provider.stream(...)` arg object.

- [ ] **Step 4: Wire into `forkedAgent.ts:62-72`**

Add `cacheHint: { breakpoints: [params.forkContextMessages.length - 1] }` to the `provider.stream` arg object.

- [ ] **Step 5: Test**

`test/core/agent/forkedAgent.cachehint.test.ts`:
```ts
// Spy on a fake provider; assert req.cacheHint is forwarded.
```

```bash
npx vitest run test/core/provider/cacheHint.test.ts \
              test/core/agent/forkedAgent.cachehint.test.ts \
              test/core/agent/loop.test.ts
```

**Acceptance criteria:**
- New tests green.
- `loop.test.ts` continues green (no regression).

**Estimated LOC:** +40 / -0 LOC src, +120 LOC test. **Estimated time:** 0.5 hr.

---

## Task 9: M1.T9 — Extend `ProviderEvent` consumers in `loop.ts` and `events.ts`

**Files:**
- Modify: `src/core/agent/events.ts`
- Modify: `src/core/agent/loop.ts:184-201, 264-289`
- Modify: `src/core/message/types.ts` (assistant fields)
- Test: `test/core/agent/loop.reasoning.test.ts` (NEW)
- Test: `test/core/agent/loop.error.test.ts` (NEW)

- [ ] **Step 1: Write failing tests**

`test/core/agent/loop.reasoning.test.ts`:
```ts
it('forwards reasoning_delta as AgentEvent reasoning_delta', async () => {
  // Mock provider yields: text_delta, reasoning_delta, message_stop
  // Assert AgentEvent stream contains both text and reasoning deltas.
})
it('accumulates reasoning into assistant.reasoning', () => { /* ... */ })
```

`test/core/agent/loop.error.test.ts`:
```ts
it('non-retriable error short-circuits turn', async () => {
  // Mock provider yields error{retriable:false}; assert turn ends gracefully
  // and assistant.errorReason is set.
})
it('retriable error is forwarded but does not short-circuit', () => {
  // The loop yields the error event but continues; the next provider.stream()
  // call is up to the user to retry. (We don't auto-retry.)
})
```

- [ ] **Step 2: Implement**

In `src/core/agent/events.ts`, add:
```ts
export type AgentEvent =
  // ...existing
  | { type: 'reasoning_delta'; text: string }
  | { type: 'error'; code: ProviderErrorCode; message: string }
```

In `src/core/message/types.ts`, extend `AssistantMessage`:
```ts
export type AssistantMessage = {
  // ...existing
  reasoning?: string
  errorReason?: string
}
```

In `loop.ts:184-201`, extend `applyToAssistant` switch:
```ts
} else if (ev.type === 'reasoning_delta') {
  m.reasoning = (m.reasoning ?? '') + ev.text
} else if (ev.type === 'error') {
  m.errorReason = `${ev.code}: ${ev.message}`
} else if (ev.type === 'cache_hit') {
  // no-op; the loop emits a separate AgentEvent only if non-noisy
}
```

In `loop.ts:264-289`, the streaming for-loop:
```ts
for await (const ev of stream) {
  if (ev.type === 'text_delta') yield { type: 'text_delta', text: ev.text }
  else if (ev.type === 'reasoning_delta') yield { type: 'reasoning_delta', text: ev.text }
  else if (ev.type === 'error' && !ev.retriable) yield { type: 'error', code: ev.code, message: ev.message }
  applyToAssistant(assistant, ev)
}
```

- [ ] **Step 3: Test**
```bash
npx vitest run test/core/agent/
```

**Acceptance criteria:**
- New reasoning + error tests green.
- All existing loop tests green.

**Estimated LOC:** +35 LOC src, +180 LOC test. **Estimated time:** 1 hr.

---

## Task 10: M1.T10 — Extend `Session` with `providerSwitches[]` and `cacheKey`

**Files:**
- Modify: `src/core/session/types.ts`, `src/core/session/factory.ts` (or wherever Session is constructed)
- Test: `test/core/session/types.test.ts` (extension, may not exist; create if missing)

- [ ] **Step 1: Write failing test**

```ts
it('default session has empty providerSwitches and undefined cacheKey', () => {
  const s = createSession({...})
  expect(s.providerSwitches).toEqual([])
  expect(s.cacheKey).toBeUndefined()
})
```

- [ ] **Step 2: Add fields per spec §5.6**

```ts
export type ProviderSwitchRecord = {
  ts: number
  fromProviderId: string; fromModel: string
  toProviderId: string;   toModel: string
  cacheInvalidated: boolean
}
export type Session = {
  // ...existing
  providerSwitches: ProviderSwitchRecord[]
  cacheKey?: string
}
```

In session factory, default `providerSwitches: []`. `cacheKey` left undefined.

- [ ] **Step 3: Test session persistence backward compat**

If a v1 session is loaded from disk without `providerSwitches`, the loader normalizes to `[]`. Add a migration test against an existing fixture.

```bash
npx vitest run test/core/session/
```

**Acceptance criteria:**
- New + existing session tests green.
- Old session JSON files still load.

**Estimated LOC:** +25 LOC src, +50 LOC test. **Estimated time:** 0.5 hr.

---

## **Milestone M1 complete.** Gate: `npx vitest run` (all suites) is green; `tsc --noEmit` is clean.

---

## Task 11: M2.T1 — Implement Gemini wire-shape translator (`gemini.ts`)

**Files:**
- Replace stub: `src/core/provider/gemini.ts`
- Test: `test/core/provider/gemini.translate.test.ts`, `gemini.message.test.ts`
- Fixtures: `test/fixtures/providers/gemini-stream.ndjson`, `gemini-stream.expected.json`

- [ ] **Step 1: Write fixture-replay test**

```ts
import { describe, it, expect } from 'vitest'
import { GeminiProvider } from '../../../src/core/provider/gemini'
import { readFileSync } from 'node:fs'

describe('GeminiProvider.translateStream', () => {
  it('replays gemini-stream.ndjson into expected ProviderEvents', async () => {
    const lines = readFileSync('test/fixtures/providers/gemini-stream.ndjson', 'utf8')
                    .trim().split('\n').map(l => JSON.parse(l))
    const expected = JSON.parse(readFileSync('test/fixtures/providers/gemini-stream.expected.json', 'utf8'))
    const p = new GeminiProvider({/* ... */})
    const out: any[] = []
    async function* iter() { for (const l of lines) yield l }
    for await (const ev of (p as any).translateStream(iter())) out.push(ev)
    expect(out).toEqual(expected)
  })
})
```

Build the fixture by hand (typed JSON-line dump of representative Gemini SSE chunks: text, thoughtSummary, functionCall, usageMetadata, done).

Build the expected by reading the spec §13 mapping table and computing what each input chunk should produce.

- [ ] **Step 2: Implement message-shape translator**

Create `_toGeminiContents(messages: Message[], system: string): { systemInstruction, contents }` per spec §6.1 table. Write `gemini.message.test.ts` with parametrized examples.

- [ ] **Step 3: Implement `translateStream`**

Per spec §6.1 step 4 (text → text_delta, thoughtSummary → reasoning_delta, functionCall → tool_use_*, usageMetadata → message_stop, errorResponse → error event).

- [ ] **Step 4: Implement `stream()` method (without cache yet)**

POST to `${baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`. SSE parsing via the standard `data: ` line splitter (Node 20+ `Response.body` async iter).

- [ ] **Step 5: Implement `listRemoteModels()`**

GET `${baseUrl}/v1beta/models?key=${apiKey}` → extract `models[].name` (strip `models/` prefix).

- [ ] **Step 6: Tests**
```bash
npx vitest run test/core/provider/gemini.translate.test.ts \
              test/core/provider/gemini.message.test.ts
```

**Acceptance criteria:**
- Fixture replay matches byte-for-byte.
- Message-shape translation handles all 4 role variants.
- 0 stub-throws remaining for non-cache code paths.

**Estimated LOC:** ~220 LOC src, ~280 LOC test. **Estimated time:** 4 hr.

---

## Task 12: M2.T2 — Implement Gemini context cache integration

**Files:**
- Modify: `src/core/provider/gemini.ts`
- Test: `test/core/provider/gemini.cache.test.ts`
- Fixture: `test/fixtures/providers/gemini-cached-create.json`, `gemini-cache-hit.expected.json`

- [ ] **Step 1: Write failing test**

```ts
describe('GeminiProvider with cacheHint', () => {
  it('creates cachedContents on first turn with breakpoints', async () => {
    // Mock POST :cachedContents → returns { name: 'cachedContents/test1' }
    // Mock POST :streamGenerateContent → returns text chunks
    // Stream req with cacheHint = { breakpoints: [3] }
    // Assert: cachedContents.create was called with messages[0..3]
    // Assert: streamGenerateContent body has cachedContent: 'cachedContents/test1'
    // Assert: ProviderEvent stream begins with cache_hit{cacheId: 'cachedContents/test1'}
  })
  it('reuses cacheId when hint provides one', async () => {
    // cacheHint = { breakpoints: [3], cacheId: 'cachedContents/abc' }
    // Assert: cachedContents.create NOT called
    // Assert: streamGenerateContent body has cachedContent: 'cachedContents/abc'
    // Assert: cache_hit emitted with cacheId: 'cachedContents/abc'
  })
  it('drops cacheId on 404 and rebuilds', async () => {
    // First :streamGenerateContent returns 404 with reason 'cache not found'
    // Provider creates a new cache, retries once
    // Assert: cache_hit emitted twice (first with old cacheId, then new)
  })
})
```

- [ ] **Step 2: Implement cache integration**

Per spec §6.1. Key code path:

```ts
async *stream(req, signal) {
  let cachedName: string | undefined
  if (this.cachePolicy === 'gemini-context' && req.cacheHint?.breakpoints?.length) {
    const bp = Math.max(...req.cacheHint.breakpoints)
    if (req.cacheHint.cacheId) {
      cachedName = req.cacheHint.cacheId
    } else {
      const prefix = req.messages.slice(0, bp + 1)
      const resp = await this._cachedContentsCreate(prefix, req.system)
      cachedName = resp.name
      yield { type: 'cache_hit', cacheId: cachedName, bytesReused: resp.usageMetadata?.totalTokenCount }
    }
  }
  // Build body with optional cachedContent + suffix messages
  // POST and translate
}
```

- [ ] **Step 3: Test**
```bash
npx vitest run test/core/provider/gemini.cache.test.ts
```

**Acceptance criteria:**
- Cache create + reuse + 404-rebuild paths green.
- `forkedAgent.cachehint.test.ts` (Task 8) extended to include a Gemini fork; assert second fork reuses the cache.

**Estimated LOC:** +120 LOC src, +200 LOC test. **Estimated time:** 3 hr.

---

## **Milestone M2 complete.** Gate: all gemini tests green; integration test stubbed (will run in M7).

---

## Task 13: M3.T1 — Implement SigV4 signer (`aws/sigv4.ts`)

**Files:**
- Replace stub: `src/core/provider/aws/sigv4.ts`
- Test: `test/core/provider/bedrock.sigv4.test.ts`
- Fixture: `test/fixtures/providers/sigv4-suite.json`

- [ ] **Step 1: Vendor AWS test vectors**

Fetch the public AWS SigV4 test suite (6 cases per spec §6.7):
- `get-vanilla`
- `post-vanilla`
- `post-vanilla-empty-body`
- `post-x-www-form-urlencoded`
- `get-utf8`
- `post-sts-token`

Format as `test/fixtures/providers/sigv4-suite.json`:
```json
[
  { "name": "get-vanilla",
    "input": {
      "method": "GET", "url": "https://example.amazonaws.com/",
      "region": "us-east-1", "service": "service",
      "accessKeyId": "AKIDEXAMPLE",
      "secretAccessKey": "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      "date": "2015-08-30T12:36:00Z",
      "extraHeaders": { "Host": "example.amazonaws.com" }
    },
    "expected": {
      "canonicalRequest": "GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "stringToSign": "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n...",
      "authorization": "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=..."
    }
  },
  /* ... 5 more cases ... */
]
```

- [ ] **Step 2: Write fixture-driven test**

```ts
import { describe, it, expect } from 'vitest'
import { signV4 } from '../../../src/core/provider/aws/sigv4'
import { readFileSync } from 'node:fs'

describe('SigV4', () => {
  const cases = JSON.parse(readFileSync('test/fixtures/providers/sigv4-suite.json', 'utf8'))
  for (const c of cases) {
    it(c.name, () => {
      const { headers } = signV4({...c.input, date: new Date(c.input.date)})
      expect(headers.Authorization).toBe(c.expected.authorization)
      // Optional: assert canonical request reproduction via internal export
    })
  }
})
```

- [ ] **Step 3: Implement signer per spec §6.7**

In `src/core/provider/aws/sigv4.ts`:

```ts
import { createHmac, createHash } from 'node:crypto'

export function signV4(input: SigV4Input): SigV4Output {
  // 1. Hash payload (empty string sha256 if no body)
  const payloadHash = createHash('sha256')
    .update(input.body ?? '').digest('hex')
  // 2. Build canonical headers (lowercase keys, trim values, sort by key)
  // 3. Build canonical request
  // 4. Build string-to-sign
  // 5. Derive signing key
  // 6. Compute signature
  // 7. Format Authorization header
  // 8. Return { headers, url }
}

function hmac(key: Buffer | string, data: string): Buffer { /* ... */ }
function deriveSigningKey(secret: string, date: string, region: string, service: string): Buffer { /* ... */ }
```

Internal helpers exported under `__test__` namespace for granular assertions.

- [ ] **Step 4: 100% coverage check**
```bash
npx vitest run --coverage test/core/provider/bedrock.sigv4.test.ts
```
Expect 100% line coverage on `aws/sigv4.ts`.

**Acceptance criteria:**
- All 6 AWS test vectors reproduce byte-exact `Authorization` headers.
- 100% coverage.

**Estimated LOC:** ~200 LOC src, ~120 LOC test. **Estimated time:** 4 hr (alg + debugging).

---

## Task 14: M3.T2 — Implement Bedrock event-stream framing parser

**Files:**
- Replace stub: `src/core/provider/aws/eventstream.ts`
- Test: `test/core/provider/bedrock.eventstream.test.ts`
- Fixture: `test/fixtures/providers/bedrock-eventstream.bin`, `.expected.json`

- [ ] **Step 1: Generate the fixture**

Capture a real Bedrock invoke-with-response-stream binary response (or hand-craft using AWS SDK serializer). Save raw bytes.

Build expected as the decoded sequence of `{ headers, payload }` objects.

- [ ] **Step 2: Write test**

```ts
import { parseEventStream } from '../../../src/core/provider/aws/eventstream'

describe('Bedrock event-stream parser', () => {
  it('decodes bedrock-eventstream.bin into expected events', async () => {
    const bytes = readFileSync('test/fixtures/providers/bedrock-eventstream.bin')
    const expected = JSON.parse(readFileSync('test/fixtures/providers/bedrock-eventstream.expected.json', 'utf8'))
    async function* sourceBytes() { yield bytes }
    const out: any[] = []
    for await (const frame of parseEventStream(sourceBytes())) out.push(frame)
    expect(out).toEqual(expected)
  })
  it('handles split chunks (partial frames across reads)', async () => {
    // Split the same fixture mid-frame; assert decode still works
  })
  it('rejects bad CRC', async () => { /* ... */ })
})
```

- [ ] **Step 3: Implement parser**

Per spec §6.2. Frame layout:
```
[total_length (4 BE)][headers_length (4 BE)][prelude_crc (4 BE)]
[headers (variable)]
[payload (variable)]
[message_crc (4 BE)]
```

Use Node `crc-32` builtin? No: Node lacks CRC-32. Hand-roll a 30-LOC table-driven CRC-32. ~80 LOC total.

- [ ] **Step 4: Test**
```bash
npx vitest run test/core/provider/bedrock.eventstream.test.ts
```

**Acceptance criteria:**
- Fixture replay matches.
- Split-chunk and bad-CRC paths work.

**Estimated LOC:** ~80 LOC src, ~120 LOC test. **Estimated time:** 2 hr.

---

## Task 15: M3.T3 — Implement BedrockProvider

**Files:**
- Replace stub: `src/core/provider/bedrock.ts`
- Test: `test/core/provider/bedrock.translate.test.ts`, `bedrock.refresh.test.ts`
- Fixture: `test/fixtures/providers/bedrock-list-models.json`, `bedrock-exception.bin`

- [ ] **Step 1: Write tests**

`bedrock.translate.test.ts`:
```ts
it('streams a Bedrock invocation and translates to ProviderEvents', async () => {
  // MSW intercept POST /model/<id>/invoke-with-response-stream
  // Return the event-stream fixture from M3.T2
  // Assert ProviderEvent[] matches the Anthropic-translation expected output
})
it('strips cache_control markers from messages before signing', async () => { /* ... */ })
it('emits error event on :exception frame', async () => { /* ... */ })
```

`bedrock.refresh.test.ts`:
```ts
it('refreshes auth on 403 InvalidSignatureException and retries once', async () => {
  let callCount = 0
  const auth = {
    kind: 'awsCreds', accessKeyId: 'A', secretAccessKey: 'S', region: 'us-east-1',
    refresh: vi.fn().mockResolvedValue({ accessKeyId: 'A2', secretAccessKey: 'S2' }),
  }
  // First MSW handler returns 403 InvalidSignatureException
  // Second handler (after refresh) returns 200 with stream
  // Assert refresh was called exactly once
  // Assert final stream completes successfully
})
it('does not retry on third failure', async () => { /* ... */ })
```

- [ ] **Step 2: Implement Bedrock body construction**

```ts
private _buildBedrockBody(req: LLMRequest): unknown {
  const messages = toAnthropicMessages(req.messages)  // reuse from anthropic.ts
  // strip cache_control
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && typeof b === 'object' && 'cache_control' in b) delete b.cache_control
      }
    }
  }
  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: req.maxTokens ?? 4096,
    system: req.system,
    messages,
    tools: req.tools.map(toAnthropicTool),
  }
}
```

- [ ] **Step 3: Implement signed-request flow**

```ts
async *stream(req, signal) {
  const url = `${this._runtimeUrl()}/model/${this._stripBedrockPrefix(req.model)}/invoke-with-response-stream`
  const body = JSON.stringify(this._buildBedrockBody(req))
  let creds = this.auth
  for (let attempt = 0; attempt < 2; attempt++) {
    const { headers } = signV4({ method: 'POST', url, region: creds.region,
                                 service: 'bedrock', accessKeyId: creds.accessKeyId,
                                 secretAccessKey: creds.secretAccessKey,
                                 sessionToken: creds.sessionToken, body })
    const resp = await fetch(url, { method: 'POST', headers: {
      ...headers, 'Content-Type': 'application/json',
    }, body, signal })
    if (resp.status === 403 && attempt === 0 && this.auth.refresh) {
      creds = { ...creds, ...(await this.auth.refresh()) }
      continue
    }
    if (!resp.ok) {
      yield { type: 'error', code: this._mapHttpToCode(resp.status),
              message: `${resp.status} ${resp.statusText}`, retriable: resp.status >= 500 }
      yield { type: 'message_stop', stopReason: 'end_turn',
              usage: { inputTokens: 0, outputTokens: 0 } }
      return
    }
    // Parse event-stream → inner Anthropic events → translateStream
    for await (const ev of this._streamFromBedrock(resp.body!)) yield ev
    return
  }
}
```

`_streamFromBedrock` chains `parseEventStream` → base64-decode payloads → JSON-parse → `AnthropicProvider.translateStream`.

- [ ] **Step 4: Implement `listRemoteModels()`**

GET `https://bedrock.${region}.amazonaws.com/foundation-models?byInferenceType=ON_DEMAND` (signed). Decode response, prefix model ids with `bedrock:`.

- [ ] **Step 5: Test**
```bash
npx vitest run test/core/provider/bedrock.translate.test.ts test/core/provider/bedrock.refresh.test.ts
```

**Acceptance criteria:**
- Translation fixture green.
- Refresh-once path green.
- `cache_control` stripping verified.

**Estimated LOC:** ~220 LOC src, ~280 LOC test. **Estimated time:** 5 hr.

---

## **Milestone M3 complete.** Gate: SigV4 100% coverage; bedrock end-to-end fixture green.

---

## Task 16: M4.T1 — Implement service-account JWT minter (`aws/jwt.ts`)

**Files:**
- Replace stub: `src/core/provider/aws/jwt.ts` (rename to `gcp/jwt.ts` for clarity)
- Test: `test/core/provider/vertex.jwt.test.ts`

- [ ] **Step 1: Write test**

```ts
import { mintServiceAccountJwt, exchangeJwtForBearer } from '../../../src/core/provider/gcp/jwt'

describe('Service-account JWT', () => {
  it('mints a stable JWT for fixed clock + key', () => {
    const fakeKey = readFileSync('test/fixtures/providers/fake-sa.pem')  // generated test key
    const jwt = mintServiceAccountJwt({
      clientEmail: 'sa@p.iam.gserviceaccount.com',
      privateKey: fakeKey,
      now: new Date('2030-01-01T00:00:00Z'),
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    })
    // Decode header + payload, assert iss/aud/exp/iat/scope
    const [header, payload] = jwt.split('.').slice(0, 2).map(p => JSON.parse(Buffer.from(p, 'base64url').toString()))
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(payload.iss).toBe('sa@p.iam.gserviceaccount.com')
    expect(payload.iat).toBe(Math.floor(new Date('2030-01-01T00:00:00Z').getTime() / 1000) - 60) // skew absorption
    expect(payload.exp).toBe(payload.iat + 3600)
  })
  it('produces a valid RS256 signature (verifiable with public key)', () => { /* ... */ })
  it('exchangeJwtForBearer POSTs to oauth2.googleapis.com/token', async () => {
    // MSW intercept; assert grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
  })
})
```

Generate a 2048-bit RSA test key once (via `openssl genrsa`) and commit `fake-sa.pem`. The accompanying public key is used to verify in the test.

- [ ] **Step 2: Implement minter**

```ts
import { createSign } from 'node:crypto'

export function mintServiceAccountJwt(opts: {
  clientEmail: string; privateKey: Buffer | string;
  now: Date; scope: string
}): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const iat = Math.floor(opts.now.getTime() / 1000) - 60
  const payload = {
    iss: opts.clientEmail,
    scope: opts.scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: iat + 3600,
    iat,
  }
  const b64u = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64u(header)}.${b64u(payload)}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(opts.privateKey).toString('base64url')
  return `${unsigned}.${sig}`
}

export async function exchangeJwtForBearer(jwt: string, fetchFn = fetch): Promise<{ token: string; exp: number }> {
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
  const body = await res.json() as { access_token: string; expires_in: number }
  return { token: body.access_token, exp: Date.now() + body.expires_in * 1000 }
}
```

- [ ] **Step 3: Test**
```bash
npx vitest run test/core/provider/vertex.jwt.test.ts
```

**Acceptance criteria:**
- Stable JWT produced.
- Public-key verification passes.
- Token-exchange MSW path green.

**Estimated LOC:** ~60 LOC src, ~140 LOC test. **Estimated time:** 2 hr.

---

## Task 17: M4.T2 — Implement VertexProvider

**Files:**
- Replace stub: `src/core/provider/vertex.ts`
- Test: `test/core/provider/vertex.translate.test.ts`, `vertex.tokenrefresh.test.ts`

- [ ] **Step 1: Write tests**

```ts
describe('VertexProvider', () => {
  it('reads service-account JSON, mints JWT, exchanges for token, calls streamRawPredict', async () => { /* ... */ })
  it('caches the bearer token across calls', async () => {
    // Two calls; assert mintServiceAccountJwt called once
  })
  it('re-mints when cached token expires (exp < now + 5 min)', async () => { /* ... */ })
  it('re-mints on 401 response and retries once', async () => { /* ... */ })
  it('translates Anthropic envelope events identically to AnthropicProvider', async () => {
    // Reuse anthropic-stream.ndjson fixture; pipe through VertexProvider's stream entry point
  })
  it('honours cache_control markers (cachePolicy=anthropic-explicit)', async () => { /* ... */ })
})
```

- [ ] **Step 2: Implement**

Per spec §6.3. Key code:

```ts
private async _ensureToken(): Promise<string> {
  const auth = this.auth as Extract<AuthConfig, { kind: 'serviceAccount' }>
  if (auth.cachedToken && auth.cachedToken.exp > Date.now() + 300_000) {
    return auth.cachedToken.token
  }
  const sa = JSON.parse(readFileSync(auth.filePath, 'utf8'))
  const jwt = mintServiceAccountJwt({
    clientEmail: sa.client_email, privateKey: sa.private_key,
    now: new Date(), scope: 'https://www.googleapis.com/auth/cloud-platform',
  })
  const { token, exp } = await exchangeJwtForBearer(jwt)
  auth.cachedToken = { token, exp }
  return token
}

async *stream(req, signal) {
  const auth = this.auth as Extract<AuthConfig, { kind: 'serviceAccount' }>
  const url = `https://${auth.location}-aiplatform.googleapis.com/v1/projects/${auth.project}/locations/${auth.location}/publishers/anthropic/models/${this._stripVertexPrefix(req.model)}:streamRawPredict`
  const body = JSON.stringify({
    anthropic_version: 'vertex-2023-10-16',
    stream: true,
    ...this._buildAnthropicBody(req, /*honourCacheControl*/ true),
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await this._ensureToken()
    const resp = await fetch(url, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'content-type': 'application/json',
    }, body, signal })
    if (resp.status === 401 && attempt === 0) {
      // Force re-mint
      ;(this.auth as any).cachedToken = undefined
      continue
    }
    if (!resp.ok) {
      yield { type: 'error', code: this._mapHttpToCode(resp.status),
              message: `${resp.status} ${resp.statusText}`, retriable: resp.status >= 500 }
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
      return
    }
    // Parse SSE → JSON parsing → translate via AnthropicProvider's translateStream
    for await (const ev of this._streamSseToAnthropic(resp.body!)) yield ev
    return
  }
}
```

`_buildAnthropicBody` is borrowed from `anthropic.ts` `_buildBody` (Task 2) but exposed as a shared helper; the Vertex variant honours cache_control because Vertex pipes to the Anthropic backend.

- [ ] **Step 3: Test**
```bash
npx vitest run test/core/provider/vertex.translate.test.ts test/core/provider/vertex.tokenrefresh.test.ts
```

**Acceptance criteria:**
- Token cache + re-mint paths green.
- Cache_control passes through.

**Estimated LOC:** ~180 LOC src, ~260 LOC test. **Estimated time:** 4 hr.

---

## **Milestone M4 complete.**

---

## Task 18: M5.T1 — Implement LocalProvider native-tools path

**Files:**
- Replace stub: `src/core/provider/local.ts`
- Test: `test/core/provider/local.translate.test.ts`, `local.health.test.ts`
- Fixtures: `test/fixtures/providers/local-ollama-tags.json`, `local-ollama-chat.ndjson`, `local-llamacpp-models.json`, `local-llamacpp-chat.ndjson`, `.expected.json` siblings

- [ ] **Step 1: Write tests**

```ts
describe('LocalProvider — native tools path', () => {
  it('Ollama: GET /api/tags lists models', async () => { /* ... */ })
  it('llama.cpp: GET /v1/models lists models', async () => { /* ... */ })
  it('streams /v1/chat/completions like OpenAI', async () => {
    // Fixture: local-ollama-chat.ndjson; expected: same translator output as openai-stream.expected.json variant
  })
  it('health: ok when GET /api/tags returns 200', async () => { /* ... */ })
  it('health: ok=false on ECONNREFUSED', async () => { /* ... */ })
})
```

- [ ] **Step 2: Implement**

```ts
class LocalProvider implements LLMProvider {
  // ...
  async listRemoteModels(): Promise<string[]> {
    const url = this.transport === 'ollama'
      ? `${this.baseUrl}/api/tags`
      : `${this.baseUrl}/v1/models`
    const res = await fetch(url)
    if (!res.ok) return []
    const body = await res.json() as any
    if (this.transport === 'ollama') {
      return Array.isArray(body.models)
        ? body.models.map((m: any) => `local:${m.name}`)
        : []
    }
    return Array.isArray(body.data)
      ? body.data.map((m: any) => `local:${m.id}`)
      : []
  }

  async health(signal): Promise<{ ok; latencyMs; reason? }> {
    const url = this.transport === 'ollama'
      ? `${this.baseUrl}/api/tags`
      : `${this.baseUrl}/v1/models`
    const t0 = Date.now()
    try {
      const res = await fetch(url, { signal })
      return { ok: res.ok, latencyMs: Date.now() - t0,
               reason: res.ok ? undefined : `${res.status}` }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, reason: (e as Error).message }
    }
  }

  async *stream(req, signal): AsyncIterable<ProviderEvent> {
    const stripped = req.model.replace(/^local:/, '')
    const body = this._buildOpenAIBody({...req, model: stripped})
    const url = `${this.baseUrl}/v1/chat/completions`
    let resp = await fetch(url, { method: 'POST', headers: {'content-type': 'application/json'},
                                  body: JSON.stringify(body), signal })
    if (!resp.ok && resp.status === 400 && req.tools.length > 0) {
      const txt = (await resp.text().catch(() => '')).toLowerCase()
      if (/tools|functions|tool_calls/.test(txt)) {
        yield* this._streamStubTools(req, signal)
        return
      }
    }
    if (!resp.ok) {
      yield { type: 'error', code: this._mapHttpToCode(resp.status),
              message: `${resp.status} ${resp.statusText}`, retriable: resp.status >= 500 }
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
      return
    }
    // Reuse OpenAIProvider translator
    for await (const ev of this._translateOpenAIStream(resp.body!)) yield ev
  }
}
```

- [ ] **Step 3: Tests**
```bash
npx vitest run test/core/provider/local.translate.test.ts test/core/provider/local.health.test.ts
```

**Acceptance criteria:**
- Both transports green.
- Health probe correctly distinguishes refused / 4xx / 200.

**Estimated LOC:** ~150 LOC src, ~220 LOC test. **Estimated time:** 3 hr.

---

## Task 19: M5.T2 — Implement stub-tools fallback

**Files:**
- Modify: `src/core/provider/local.ts`
- Test: `test/core/provider/local.stubtools.test.ts`
- Fixture: `test/fixtures/providers/local-stub-tools-roundtrip.txt`, `.expected.json`

- [ ] **Step 1: Write tests**

```ts
describe('LocalProvider stub-tools fallback', () => {
  it('emits cache_hit{degraded:true} on first attempt failure', async () => { /* ... */ })
  it('synthesizes the system-prompt tool schema and re-prompts', async () => {
    // Assert the second request body has a system message containing
    // "<tool_call>" and the tool's JSON Schema
  })
  it('extracts tool calls from streamed text via <tool_call>...</tool_call> tags', async () => {
    // Fixture streams: "<tool_call>{\"tool\":\"Edit\",\"input\":{\"path\":\"/x\"}}</tool_call>"
    // Expected: tool_use_start{name:'Edit'} + tool_use_args_delta + tool_use_stop{input:{path:'/x'}}
  })
  it('handles split tags across stream chunks', async () => { /* ... */ })
  it('multi-tool-call: emits stop for each <tool_call> block', async () => { /* ... */ })
  it('text outside tags is forwarded as text_delta', async () => { /* ... */ })
})
```

- [ ] **Step 2: Implement extractor**

```ts
async *_streamStubTools(req: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
  yield { type: 'cache_hit', degraded: true }
  const stubSystem = this._buildStubToolsSystemPrompt(req.system, req.tools)
  const reqNoTools = { ...req, system: stubSystem, tools: [] }
  const body = this._buildOpenAIBody(reqNoTools)
  const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify(body), signal,
  })
  if (!resp.ok) {
    yield { type: 'error', code: 'unknown',
            message: `stub-tools fallback failed: ${resp.status}`, retriable: false }
    yield { type: 'message_stop', stopReason: 'end_turn',
            usage: { inputTokens: 0, outputTokens: 0 } }
    return
  }
  // State machine: scan text_delta for <tool_call>...</tool_call>
  let mode: 'text' | 'in_tag' = 'text'
  let buffer = ''
  let toolCounter = 0
  let activeId: string | null = null
  for await (const ev of this._translateOpenAIStream(resp.body!)) {
    if (ev.type !== 'text_delta') { yield ev; continue }
    const incoming = ev.text
    let i = 0
    while (i < incoming.length) {
      if (mode === 'text') {
        const open = incoming.indexOf('<tool_call>', i)
        if (open < 0) {
          yield { type: 'text_delta', text: incoming.slice(i) }
          break
        }
        if (open > i) yield { type: 'text_delta', text: incoming.slice(i, open) }
        i = open + '<tool_call>'.length
        mode = 'in_tag'
        buffer = ''
        activeId = `local-tc-${toolCounter++}`
      } else {
        const close = incoming.indexOf('</tool_call>', i)
        if (close < 0) {
          buffer += incoming.slice(i)
          break
        }
        buffer += incoming.slice(i, close)
        i = close + '</tool_call>'.length
        // Parse buffer
        try {
          const parsed = JSON.parse(buffer.trim())
          yield { type: 'tool_use_start', id: activeId!, name: parsed.tool ?? 'unknown' }
          const argsJson = JSON.stringify(parsed.input ?? {})
          yield { type: 'tool_use_args_delta', id: activeId!, delta: argsJson }
          yield { type: 'tool_use_stop', id: activeId!, input: parsed.input ?? {} }
        } catch {
          // Malformed; surface as text
          yield { type: 'text_delta', text: `<tool_call>${buffer}</tool_call>` }
        }
        mode = 'text'
        buffer = ''
        activeId = null
      }
    }
  }
}

private _buildStubToolsSystemPrompt(originalSystem: string, tools: ToolSpec[]): string {
  const intro = '\n\nYou have access to the following tools. To call a tool, emit a single JSON object on its own line, surrounded by <tool_call> and </tool_call> tags:\n\n<tool_call>{"tool":"<name>","input":{...}}</tool_call>\n\nTools:'
  const list = tools.map(t => `- ${t.name}: ${JSON.stringify(t.parameters)}`).join('\n')
  return `${originalSystem}${intro}\n${list}\n\nWhen done, respond normally without any <tool_call> tag.`
}
```

- [ ] **Step 3: Tests**
```bash
npx vitest run test/core/provider/local.stubtools.test.ts
```

**Acceptance criteria:**
- All extraction edge cases (split tags, multi-call, text-around-tags, malformed JSON) green.

**Estimated LOC:** +110 LOC src, +260 LOC test. **Estimated time:** 4 hr.

---

## **Milestone M5 complete.**

---

## Task 20: M6.T1 — Migrate `pricing.ts` to registry-driven lookup

**Files:**
- Modify: `src/core/cost/pricing.ts`
- Test: `test/core/cost/pricing.test.ts` (existing) + `test/core/cost/pricing.registry.test.ts` (NEW)

- [ ] **Step 1: Write failing test**

```ts
import { findPricing, setProviderPricingOverlay } from '../../../src/core/cost/pricing'
import { MODEL_REGISTRY } from '../../../src/core/provider/registry'

describe('findPricing — registry-driven', () => {
  for (const e of MODEL_REGISTRY) {
    it(`returns pricing for ${e.id}`, () => {
      expect(findPricing(e.id)).toEqual({
        input: e.capabilities.pricing.input,
        output: e.capabilities.pricing.output,
        cacheCreate: e.capabilities.pricing.cacheCreate,
        cacheRead: e.capabilities.pricing.cacheRead,
      })
    })
  }
  it('returns undefined for unknown model', () => {
    expect(findPricing('xyz')).toBeUndefined()
  })
  it('strips provider/ prefix', () => {
    expect(findPricing('anthropic/claude-opus-4-7')).not.toBeUndefined()
  })
  it('overlay shadows registry', () => {
    setProviderPricingOverlay({ providers: [{
      id: 'a', pricing: { 'gpt-4o': { input: 999, output: 999 } },
    }] } as any)
    expect(findPricing('gpt-4o')?.input).toBe(999)
    setProviderPricingOverlay({ providers: [] } as any)
    expect(findPricing('gpt-4o')?.input).toBe(2.5)
  })
})
```

- [ ] **Step 2: Implement**

Replace `pricing.ts` body:
```ts
import { findModel } from '../provider/registry'
import type { Config } from '../config/schema'

export type ModelPricing = {
  input: number; output: number;
  cacheCreate?: number; cacheRead?: number;
}

let providerOverlay = new Map<string, ModelPricing>()

export function setProviderPricingOverlay(cfg: Pick<Config, 'providers'>): void {
  providerOverlay = new Map()
  for (const p of cfg.providers) {
    if (!p.pricing) continue
    for (const [model, price] of Object.entries(p.pricing)) {
      providerOverlay.set(model, {
        input: price.input, output: price.output,
        cacheCreate: price.cacheWrite, cacheRead: price.cacheRead,
      })
    }
  }
}

export function findPricing(model: string): ModelPricing | undefined {
  if (!model) return undefined
  if (providerOverlay.has(model)) return providerOverlay.get(model)
  const exact = findModel(model)
  if (exact) {
    const p = exact.capabilities.pricing
    return { input: p.input, output: p.output,
             cacheCreate: p.cacheCreate, cacheRead: p.cacheRead }
  }
  const slash = model.lastIndexOf('/')
  if (slash >= 0) {
    const tail = model.slice(slash + 1)
    const e = findModel(tail)
    if (e) {
      const p = e.capabilities.pricing
      return { input: p.input, output: p.output,
               cacheCreate: p.cacheCreate, cacheRead: p.cacheRead }
    }
  }
  return undefined
}
```

Remove the legacy `PRICING` table.

- [ ] **Step 3: Test**
```bash
npx vitest run test/core/cost/pricing.test.ts test/core/cost/pricing.registry.test.ts
```

**Acceptance criteria:**
- Existing pricing test green (table-equivalent assertions still match because registry has the same numbers).
- Overlay test green.

**Estimated LOC:** -40 / +30 LOC src, +120 LOC test. **Estimated time:** 1 hr.

---

## Task 21: M6.T2 — Extend `providerProbe.ts` with 4 new probe variants

**Files:**
- Modify: `src/core/onboarding/providerProbe.ts:1-92`
- Test: `test/core/onboarding/probes.gemini.test.ts`, `probes.bedrock.test.ts`, `probes.vertex.test.ts`, `probes.local.test.ts`

- [ ] **Step 1: Write tests** (one per new probe; mock fetch via the existing `FetchLike` interface)

- [ ] **Step 2: Extend `ProviderTemplate.type` union**

```ts
export type ProviderTemplateId =
  | 'anthropic' | 'openai' | 'gemini' | 'bedrock' | 'vertex' | 'local' | 'custom'
export type ProviderTemplate = {
  id: ProviderTemplateId
  type: 'anthropic' | 'openai' | 'gemini' | 'bedrock' | 'vertex' | 'local'
  // ...rest same
}
```

- [ ] **Step 3: Implement probes**

```ts
async function probeGemini(t, key, fetch): Promise<ProbeResult> {
  const url = `${t.baseUrl.replace(/\/$/, '')}/models?key=${encodeURIComponent(key)}&pageSize=1`
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) return { ok: false, reason: `${res.status} ${res.statusText ?? ''}`.trim() }
  return { ok: true }
}

async function probeBedrock(t, awsCreds: { accessKeyId, secretAccessKey, region }, fetch): Promise<ProbeResult> {
  const url = `https://bedrock.${awsCreds.region}.amazonaws.com/foundation-models?byInferenceType=ON_DEMAND`
  const { headers } = signV4({ method: 'GET', url, region: awsCreds.region, service: 'bedrock',
                               accessKeyId: awsCreds.accessKeyId,
                               secretAccessKey: awsCreds.secretAccessKey })
  const res = await fetch(url, { method: 'GET', headers })
  if (!res.ok) return { ok: false, reason: `${res.status}` }
  const body = await res.json()
  const ids = (body.modelSummaries ?? []).map((m: any) => `bedrock:${m.modelId}`)
  return ids.length > 0 ? { ok: true, models: ids } : { ok: true }
}

async function probeVertex(t, sa: { filePath, project, location }, fetch): Promise<ProbeResult> {
  try {
    const json = JSON.parse(await fs.readFile(sa.filePath, 'utf8'))
    const jwt = mintServiceAccountJwt({
      clientEmail: json.client_email, privateKey: json.private_key,
      now: new Date(), scope: 'https://www.googleapis.com/auth/cloud-platform',
    })
    const exch = await exchangeJwtForBearer(jwt, fetch)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}

async function probeLocal(t, fetch): Promise<ProbeResult> {
  try {
    const url = `${t.baseUrl}/api/tags`  // ollama
    const res = await fetch(url, { method: 'GET' })
    if (res.ok) return { ok: true, models: [] }
    // Try llama.cpp
    const res2 = await fetch(`${t.baseUrl}/v1/models`, { method: 'GET' })
    return res2.ok ? { ok: true } : { ok: false, reason: `${res2.status}` }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}
```

Wire into the main `probeProvider` switch.

- [ ] **Step 4: Test**
```bash
npx vitest run test/core/onboarding/probes.*.test.ts
```

**Acceptance criteria:**
- All 4 new probes green.
- Existing OpenAI + Anthropic probes still green.

**Estimated LOC:** +120 LOC src, +280 LOC test. **Estimated time:** 2 hr.

---

## Task 22: M6.T3 — Extend onboarding wizard templates

**Files:**
- Modify: `src/core/onboarding/templates.ts`
- Test: `test/core/onboarding/templates.test.ts`

- [ ] **Step 1: Add 4 new templates per spec §6.10**

(see spec for exact entries)

- [ ] **Step 2: Test**

```ts
it('templates list contains gemini, bedrock, vertex, local', () => {
  const ids = PROVIDER_TEMPLATES.map(t => t.id)
  expect(ids).toEqual(expect.arrayContaining(['gemini', 'bedrock', 'vertex', 'local']))
})
it('findTemplate returns each one', () => { /* ... */ })
```

**Acceptance criteria:**
- Templates listed.
- Each has the right shape (`type`, `baseUrl`, `defaultModel`, etc.).

**Estimated LOC:** +60 LOC src, +60 LOC test. **Estimated time:** 0.5 hr.

---

## Task 23: M6.T4 — Extend `runDoctor` with per-provider health checks

**Files:**
- Modify: `src/core/doctor/run.ts` (read first to determine current shape)
- Test: extend `test/core/doctor/run.test.ts`

- [ ] **Step 1: Read current implementation**

```bash
# From the worker — use Read tool on src/core/doctor/run.ts
```

- [ ] **Step 2: Add per-provider probe section**

For each `cfg.providers[i]`, call the appropriate probe (or `provider.health()` if implemented). Aggregate results into `report.providers: { id, ok, reason?, latencyMs }[]`.

- [ ] **Step 3: TUI rendering**

The existing `<DoctorReport>` Ink component renders `report.providers` as a list with green/red dots. If the list is empty (no providers configured), render "no providers configured".

- [ ] **Step 4: Test**
```bash
npx vitest run test/core/doctor/run.test.ts
```

**Acceptance criteria:**
- Doctor lists all 6 providers when configured.
- Failing probes show reason.
- Local probe failure shows "server not running" yellow.

**Estimated LOC:** +60 LOC src, +120 LOC test. **Estimated time:** 1.5 hr.

---

## **Milestone M6 complete.**

---

## Task 24: M7.T1 — Implement `/model` slash dialog `applyModelSelection`

**Files:**
- Modify: `src/slash/model.ts`
- Modify: model-picker dialog handler (find via Grep for `model-picker` in App.tsx)
- Test: `test/core/slash/model.applyselection.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { applyModelSelection } from '../../../src/slash/model'

describe('applyModelSelection', () => {
  it('records a providerSwitch when providerId changes', () => {
    const session = { providerId: 'anthropic', model: 'claude-sonnet-4-6',
                      providerSwitches: [], cacheKey: 'cachedContents/abc' }
    applyModelSelection(session as any,
      { id: 'gemini-2.0-flash', providerId: 'gemini' } as any)
    expect(session.providerId).toBe('gemini')
    expect(session.model).toBe('gemini-2.0-flash')
    expect(session.cacheKey).toBeUndefined()
    expect(session.providerSwitches).toHaveLength(1)
    expect(session.providerSwitches[0].cacheInvalidated).toBe(true)
  })
  it('does not record when only model changes within same provider', () => {
    const session = { providerId: 'anthropic', model: 'claude-sonnet-4-6',
                      providerSwitches: [], cacheKey: 'something' }
    applyModelSelection(session as any,
      { id: 'claude-haiku-4-5', providerId: 'anthropic' } as any)
    expect(session.providerSwitches).toHaveLength(1)
    expect(session.providerSwitches[0].cacheInvalidated).toBe(false)
    expect(session.cacheKey).toBe('something')   // preserved
  })
  it('clock injectable for testability', () => { /* ... */ })
})
```

- [ ] **Step 2: Implement per spec §6.8**

Export `applyModelSelection(session, sel, clock?)` from `src/slash/model.ts`. Wire the model-picker dialog handler in `App.tsx` (or wherever the `kind: 'model-picker'` dialog is dispatched) to call this on accept.

- [ ] **Step 3: TUI surface**

When `cacheInvalidated === true`, append a system-message to the conversation:
`[switched from ${prev.providerId}/${prev.model} to ${sel.providerId}/${sel.id}; prompt cache reset]`.

- [ ] **Step 4: Test**
```bash
npx vitest run test/core/slash/model.applyselection.test.ts
```

**Acceptance criteria:**
- All test cases green.
- TUI renders the cache-reset notice.

**Estimated LOC:** +50 LOC src, +120 LOC test. **Estimated time:** 1.5 hr.

---

## Task 25: M7.T2 — End-to-end integration test

**Files:**
- NEW: `test/integration/provider-expansion.test.ts`

- [ ] **Step 1: Build a 6-provider test harness**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { ProviderResolver } from '../../src/core/provider/resolver'
import { runAgent } from '../../src/core/agent/loop'

const server = setupServer(
  http.post('https://api.anthropic.com/v1/messages', () => HttpResponse.text(...)),
  http.post('https://api.openai.com/v1/chat/completions', () => HttpResponse.text(...)),
  http.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent', () => HttpResponse.text(...)),
  http.post('https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-sonnet-4-6-v1/invoke-with-response-stream', () => HttpResponse.arrayBuffer(...)),
  http.post('https://us-central1-aiplatform.googleapis.com/.../streamRawPredict', () => HttpResponse.text(...)),
  http.post('https://oauth2.googleapis.com/token', () => HttpResponse.json({access_token:'t', expires_in:3600})),
  http.post('http://localhost:11434/v1/chat/completions', () => HttpResponse.text(...)),
)
beforeAll(() => server.listen())
afterAll(() => server.close())

describe('provider-expansion integration', () => {
  it('all 6 providers complete a 1-turn conversation via the same loop code', async () => {
    const cfg = { providers: [/* 6 entries */], active: { providerId: 'anthropic' } }
    const resolver = new ProviderResolver(cfg as any)
    for (const pid of ['anthropic','openai','gemini','bedrock','vertex','local']) {
      const session = makeSession({ providerId: pid, model: registryModelFor(pid) })
      const events: any[] = []
      for await (const ev of runAgent({text:'hi'}, session, fakeDeps(resolver), new AbortController().signal)) {
        events.push(ev)
      }
      expect(events.find(e => e.type === 'turn_end')).toBeTruthy()
    }
  })
  it('mid-session switch from anthropic→gemini→bedrock invalidates cache twice', () => { /* ... */ })
  it('forkedAgent forks each provider and reuses Gemini cache on second fork', () => { /* ... */ })
})
```

- [ ] **Step 2: Wire fixtures**

Reuse the per-provider fixtures from M2–M5.

- [ ] **Step 3: Run**
```bash
npx vitest run test/integration/provider-expansion.test.ts
```

**Acceptance criteria:**
- All 6 providers stream a `turn_end` event.
- Mid-session-switch cache-invalidation count matches expected.
- Gemini second fork hits cache.

**Estimated LOC:** ~400 LOC test. **Estimated time:** 4 hr.

---

## Task 26: M7.T3 — Documentation + commit checklist

**Files:**
- Modify: `README.md` § Providers (append new rows)
- Modify: docs/superpowers/specs/2026-05-02-spec-d-provider-expansion-design.md (append "Implementation notes" appendix if any unexpected findings)

- [ ] **Step 1: Update README provider table**

| Provider | Status | Auth      | Cache  | Tools  |
| -------- | ------ | --------- | ------ | ------ |
| Anthropic| ✅     | apiKey    | explic.| native |
| OpenAI   | ✅     | apiKey    | none   | native |
| Gemini   | ✅ NEW | apiKey    | context| native |
| Bedrock  | ✅ NEW | awsCreds  | none   | native |
| Vertex   | ✅ NEW | servAcct  | explic.| native |
| Local    | ✅ NEW | none      | none   | native or stub |

- [ ] **Step 2: Final test sweep**
```bash
npx vitest run
npx tsc --noEmit
```

**Acceptance criteria:**
- All tests green; 0 type errors.
- README updated.

**Estimated LOC:** +60 LOC docs. **Estimated time:** 0.5 hr.

---

## **Milestone M7 complete. Spec D done.**

---

## Cross-cutting verification checklist

After all tasks land, run these acceptance checks:

- [ ] `npx vitest run` — all suites green
- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npx eslint src test` — 0 errors (if lint config exists)
- [ ] Bundle size delta: `npm run build && du -sh dist/` — should be within +5% of pre-spec-D baseline (we added ~1500 LOC core; no new deps)
- [ ] Round-trip `~/.nuka/config.yaml` with a v0 (string-apiKey) entry — loads and rewrites correctly
- [ ] `nuka /doctor` against a real Anthropic key — green check, no regression
- [ ] `nuka /doctor` against a fake Bedrock + fake Vertex + reachable Ollama localhost — accurate red/green status per provider
- [ ] `nuka /model` opens picker, lists all 6 providers grouped, switching between them updates `Session.providerSwitches`
- [ ] forkedAgent fork from a Gemini session reuses the parent's `cachedContents` name on the second invocation
- [ ] SigV4 signer 100% line coverage
- [ ] No new entries in `package.json` `dependencies` (everything is platform / existing)

---

## Risk register (cross-task)

| Risk                                                            | Affected task | Mitigation                                                 |
| --------------------------------------------------------------- | ------------- | ---------------------------------------------------------- |
| MSW interception of native `fetch` not stable on Node 20.x      | M7.T2         | Pin MSW 2.4+; document Node version requirement.           |
| Bedrock event-stream fixture goes stale (AWS changes wire)      | M3.T2         | Pin fixture; CI runs only against fixture, not live AWS.   |
| Gemini context-cache TTL changes without notice                 | M2.T2         | Default ttl='300s' is documented; renew on 404.            |
| Vertex `streamRawPredict` JSON shape diverges from Anthropic    | M4.T2         | Translation reuses `AnthropicProvider.translateStream`; if shape diverges, intercept before delegation. |
| Local stub-tools extractor mis-parses model output              | M5.T2         | Best-effort; failures emit text_delta passthrough; no infinite loop. |
| Cost-tracker overlay leaks across tests                         | M6.T1         | `setProviderPricingOverlay({providers:[]})` in test cleanup. |
| `applyModelSelection` mutates session in-place (vs immutable)   | M7.T1         | Codebase pattern is mutation (see `loop.ts` `appendMessage`); consistent. |

---

## Parallelization plan (subagent dispatch)

After M1 lands, M2/M3/M4/M5 can run as independent subagents:

- **Subagent A (M2 — Gemini)**: Tasks 11–12 (~7 hr)
- **Subagent B (M3 — Bedrock)**: Tasks 13–15 (~11 hr)
- **Subagent C (M4 — Vertex)**: Tasks 16–17 (~6 hr)
- **Subagent D (M5 — Local)**: Tasks 18–19 (~7 hr)

Each subagent is given:
1. The completed M1 (post-Task 10 main).
2. The relevant spec section (§6.1, §6.2, §6.3, §6.4).
3. The fixtures it owns.
4. An instruction to leave `resolver.ts` and shared types untouched — only its provider file + tests.

Sequential merge order: A → B → C → D (alphabetical). Each merge re-runs the full test suite.

After all four merge: M6 (Tasks 20–23) and M7 (Tasks 24–26) run sequentially in main.

**Calendar estimate:** ~3 days (11 hr longest path B + 1 day M6 + 1 day M7 + slack).

---

## Total estimate

- **LOC:** ~1500 src + ~3000 test + ~150 docs.
- **Time:** ~9 working days serial; ~4 days with subagent parallelization.
- **Files touched:** ~25 core + ~30 test + ~20 fixture.
- **New dependencies:** 0.
