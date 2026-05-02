# Spec D — Provider Expansion: Gemini, Bedrock, Vertex, Local (Ollama / llama.cpp)

**Date:** 2026-05-02
**Status:** Spec
**Author:** Brainstorming session 2026-05-02 (Spec D in the 2026-05-02-spec-{a..e} family)

> **Sibling specs (cross-reference by filename, written in parallel):**
> - `2026-05-02-spec-a-finish-the-promise-design.md`
> - `2026-05-02-spec-b-modernize-core-design.md`
> - `2026-05-02-spec-c-cron-primitive-design.md`
> - `2026-05-02-spec-e-context-audit-design.md`

---

## 1. Problem

Nuka's provider layer ships exactly two adapters: `AnthropicProvider` (`src/core/provider/anthropic.ts:20`) and `OpenAIProvider` (`src/core/provider/openai.ts:19`). Both implement the same `LLMProvider` interface (`src/core/provider/types.ts:36-42`) and are wired through a thin `ProviderResolver` (`src/core/provider/resolver.ts:18`) that picks an instance by `session.providerId`. The interface and the resolver are fine for two providers but bake in three assumptions that block expansion to the four other providers users routinely ask for:

1. **Auth is single-shape.** Every concrete provider class takes `{ id, apiKey, baseUrl, extraHeaders }` (see `anthropic.ts:13-18`, `openai.ts:12-17`). The shape is fine for static API keys but cannot express:
   - **AWS Bedrock**: SigV4 signature derived from `(accessKeyId, secretAccessKey, sessionToken?)` per request, with periodic STS-style refresh; the canonical signed URL is `https://bedrock-runtime.<region>.amazonaws.com/model/<modelId>/invoke-with-response-stream`.
   - **Vertex AI**: Google Cloud service-account JWT exchange yielding a Bearer token with a 1-hour TTL; the request URL embeds project + location + model id (`https://<location>-aiplatform.googleapis.com/v1/projects/<project>/locations/<location>/publishers/anthropic/models/<modelId>:streamRawPredict`).
   - **Gemini (AI Studio)**: API-key auth like OpenAI but with the key passed as `?key=<apiKey>` querystring on `:streamGenerateContent`.
   - **Local (Ollama / llama.cpp)**: no auth; localhost; tool-calling support varies per model and degrades to schema-prompt fallback.

2. **The `format` discriminator is overloaded.** `ProviderFormat = 'anthropic' | 'openai'` (`types.ts:4`) is read in two places that conflate "wire shape" with "auth + transport":
   - `remoteModels.ts:20-32` — endpoint branching for `/v1/models`.
   - `resolver.ts:38-52` — class selection.

   To add Gemini/Bedrock/Vertex/local without churning callers, we keep `format` as a *wire-shape* enum (which subset of message conventions: tool-call shape, role names, streaming chunk shape) and split out *auth + transport* into a discriminated `AuthConfig`.

3. **Cache-control is hardcoded to Anthropic explicit markers.** `forkedAgent.ts:23-37` builds a "cache-safe" parameter bundle by trimming `parentSession.messages` to the trailing N entries. The semantics depend on the *Anthropic* model adding `cache_control: {type: 'ephemeral'}` markers automatically on the last few message blocks (the SDK does this for us today). For Gemini, prompt caching is **opaque** — you POST to `cachedContents.create` with the message prefix, get back a `name`, and reference it on later `generateContent` calls; you must garbage-collect when stale. For OpenAI / local, cache is implicit (gpt-4o, llama.cpp) or absent. `forkedAgent.ts` cannot keep working unmodified across providers without a normalized `CacheHint` translation step.

4. **Streaming and tool-call event shapes diverge.** Today both providers translate into `ProviderEvent` (`types.ts:25-34`) — five variants: `text_delta | tool_use_start | tool_use_args_delta | tool_use_stop | message_stop`. The four new providers introduce two events the existing union does not cover:
   - **Reasoning / thinking deltas.** Gemini exposes `thoughtSummary` parts; OpenAI's `o*` and `gpt-5` lines emit `reasoning` deltas distinct from `content`. We currently swallow these by collapsing into `text_delta`, which costs the TUI any ability to fold or hide them.
   - **Errors mid-stream.** Bedrock and Gemini both surface `serviceUnavailableException` / `RESOURCE_EXHAUSTED` mid-stream (after some tokens have already streamed). Today these become uncaught exceptions. We need an `error` variant the loop can fold into the assistant message as a clean turn-end.

5. **No model registry.** `/model` slash (`src/slash/model.ts:3-10`) opens a picker that lists `cfg.providers[i].models`. The data has no capability fields (cache, tools, vision, max_tokens, cost). Cost tracking (`src/core/cost/pricing.ts:30-40`) hardcodes 6 entries. Adding 4 providers × ~6 models each balloons this list; without a `registry.ts` that owns the schema, every consumer (slash, cost, doctor, onboarding) re-encodes the same tuples.

6. **Onboarding only probes Anthropic + OpenAI.** `providerProbe.ts:34-91` switches on `t.type === 'openai'` / `t.type === 'anthropic'`. Adding providers requires probing AWS STS, Vertex token endpoint, Gemini AI Studio, and the local server's `/api/tags` (Ollama) or `/v1/models` (llama.cpp). Missing this means users discover bad creds at first turn instead of at boot.

7. **Mid-session model switch invalidates cache silently.** `/model` already lets the user re-select a provider/model (`slash/model.ts`). Today both surviving providers share the Anthropic-style messages array shape, so the switch happens to be lossless. If the user switches `claude-sonnet-4-6` → `gemini-2.0-flash` mid-session, the next turn would silently drop all explicit cache markers (Anthropic) and fail to set up Gemini's opaque cache. We need an explicit invalidation step.

This spec defines the abstraction extensions and four new adapters that close those seven gaps without breaking any of the existing two providers' callers.

---

## 2. Goals

1. **Six providers behind one resolver.** `anthropic`, `openai`, `gemini`, `bedrock`, `vertex`, `local` — each implementing the (extended) `LLMProvider` interface, registered into the same `ProviderResolver`, addressable by either `providerId` (existing) or by model-id prefix (new convenience routing).
2. **Discriminated `AuthConfig`.** Five auth variants: `apiKey`, `awsCreds` (Bedrock), `serviceAccount` (Vertex), `bearerRefresh` (Vertex/Bedrock w/ refresh hook), `none` (local). Per-provider builder code is a one-screen switch.
3. **`ProviderEvent` extended additively.** Three new variants: `reasoning_delta`, `error`, `cache_hit`. All existing consumers in `loop.ts:184-201` (`applyToAssistant`) tolerate unknown variants — verified empirically by reading the if/else-if chain — so this is a purely additive extension.
4. **`CacheHint` normalization.** `LLMRequest` gains a `cacheBreakpoints?: number[]` field (message indices). Each provider adapter translates: Anthropic injects `cache_control` markers; Gemini calls `cachedContents.create` with the prefix and references the returned `name`; OpenAI / local ignore. `forkedAgent.ts` always emits a hint and does not branch on provider.
5. **Hand-rolled SigV4 for Bedrock.** ~200 LOC under `src/core/provider/aws/sigv4.ts`. We do **not** pull `@aws-sdk/client-bedrock-runtime` (>50 KB transitive deps for one signature algorithm). The HTTP transport uses Node's native `fetch`, matching `remoteModels.ts:38`.
6. **Model registry** at `src/core/provider/registry.ts` — single source of truth for `(modelId, providerId, capabilities, maxTokens, pricing)`. Both the `/model` picker and the cost tracker read from it.
7. **Cost tracking extended.** `pricing.ts` table is generalized to per-provider; `findPricing` falls back through `(provider/model)` → `model` → unknown.
8. **Onboarding probes all 6.** `providerProbe.ts` grows three new branches; `/doctor` lists per-provider health.
9. **Mid-session `/model` switch is explicit and safe.** When the new selection's `providerId` differs from the previous, the resolver emits an `OnProviderSwitch` event; the agent loop drops `session.cacheKey` (new optional field) so the next turn opens a fresh prompt cache slot under the new provider.
10. **No regression in the two existing providers.** All existing tests under `test/core/provider/` continue to pass without modification.

---

## 3. Non-Goals

- ❌ **OAuth flows for Vertex.** This phase requires the user to supply a service-account JSON file path (`auth.serviceAccountFile`). Three-legged OAuth (`gcloud auth login` style) is out of scope and tracked separately.
- ❌ **Bedrock cross-region routing.** Bedrock model availability differs by region; we let the user pin `region` and surface a clear "model X not available in region Y" error if it 404s. No automatic region failover.
- ❌ **Gemini Vision native input.** Existing `image` content block already serializes to `[image: ...]` text fallback for OpenAI (`openai.ts:198-208`); we keep that fallback for Gemini/Bedrock/Vertex/local and defer multi-modal native paths.
- ❌ **Tool-call schema-prompt fallback for OpenAI-format models that don't natively tool-call.** We provide it for `local` only, since most local models lack native tool-calling. Cloud providers are expected to support tools natively in 2026.
- ❌ **Multi-key load balancing.** Multiple Anthropic providers (two API keys) are *configurable* but routing across them per-turn (round-robin / cost-aware) is deferred.
- ❌ **Streaming JSON repair.** If a tool-call's `input` JSON arrives truncated due to mid-stream `error`, we surface `tool_use_args_delta` deltas as-is and let the existing `JSON.parse` fallback in `anthropic.ts:111` / `openai.ts:120-122` produce `{}`.
- ❌ **Bedrock prompt caching.** Bedrock-Anthropic supports prompt caching only on certain regions and models; we ship with `cachePolicy: 'none'` for Bedrock in v1 and revisit when AWS GA's it on the Anthropic-via-Bedrock path. Vertex-Anthropic gets `cachePolicy: 'anthropic-explicit'` (it pipes through to the Anthropic backend).

---

## 4. High-level Architecture

```
                ┌──────────────── Nuka Agent Loop (loop.ts) ────────────────┐
                │                                                            │
                │   provider.stream(req, signal): AsyncIterable<ProviderEvent>│
                │                  │                                          │
                └──────────────────┼──────────────────────────────────────────┘
                                   ▼
                  ┌──────────────────────────────────┐
                  │       ProviderResolver           │   resolver.ts (extended)
                  │ resolveFor(session): {provider}  │   prefix-routing (new)
                  │ map: providerId → LLMProvider    │   model-id prefix → providerId
                  │ registry: ModelRegistry          │
                  └─────────┬──────────────────────┬─┘
                            │                      │
            ┌───────────────┼───────────┬──────────┼──────────────┐
            ▼               ▼           ▼          ▼              ▼
   ┌───────────────┐ ┌────────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐
   │  Anthropic    │ │   OpenAI   │ │ Gemini │ │ Bedrock  │ │  Vertex    │ │   Local    │
   │  (existing)   │ │ (existing) │ │  (new) │ │  (new)   │ │   (new)    │ │   (new)    │
   │ format=anthro │ │format=openai│ │ google │ │ anthropic│ │ anthropic  │ │ openai-    │
   │ apiKey        │ │ apiKey     │ │ apiKey │ │ awsCreds │ │ serviceAcct│ │ compatible │
   │ cache=expl.   │ │ cache=none │ │ cache= │ │ +SigV4   │ │  + JWT     │ │ none /     │
   │               │ │            │ │ context│ │ cache=   │ │ cache=expl.│ │ stub-tools │
   │               │ │            │ │        │ │  none    │ │            │ │            │
   └──────┬────────┘ └──────┬─────┘ └───┬────┘ └────┬─────┘ └─────┬──────┘ └─────┬──────┘
          │                 │            │           │             │              │
          │                 │            │           ▼             │              │
          │                 │            │    ┌─────────────┐      │              │
          │                 │            │    │  SigV4      │      │              │
          │                 │            │    │  (new,      │      │              │
          │                 │            │    │   handroll) │      │              │
          │                 │            │    └─────────────┘      │              │
          │                 │            │                         │              │
          ▼                 ▼            ▼          ▼              ▼              ▼
       Anthropic       OpenAI       Gemini API   AWS Bedrock   Vertex AI      Ollama HTTP
       SDK             SDK          (REST)       (REST + sig)  (REST + JWT)   (OpenAI shape)
       /v1/messages    /chat/comp   :stream      /invoke-with- :streamRaw     /v1/chat/comp
                                    GenerateCnt  response-     Predict        + /api/tags
                                                 stream

                  ┌──────────────────────────────────┐
                  │       ModelRegistry              │   registry.ts (NEW)
                  │ {modelId,providerId,caps,        │
                  │  maxTokens, pricing}             │
                  └─────────────┬────────────────────┘
                                │ used by
                ┌───────────────┴───────────────┬─────────────────┐
                ▼                               ▼                 ▼
        slash/model.ts              core/cost/pricing.ts    slash/doctor.ts
        (picker capabilities)       (per-provider rates)    (health x6 prov.)

                  ┌──────────────────────────────────┐
                  │       AuthConfig (5 variants)    │   types.ts (NEW)
                  │ apiKey | awsCreds | serviceAcct  │
                  │ | bearerRefresh | none           │
                  └──────────────────────────────────┘
```

**Architectural invariants:**

- **Single point of construction.** `ProviderResolver.buildInstance(pc)` is the only place that maps `format` (extended to 4 values: `anthropic | openai | google | local-openai`) and `auth.kind` to a concrete adapter class. Tests can substitute via `opts.providers` (existing extension point at `resolver.ts:14-16`).
- **All providers stream.** Even Bedrock invokes the streaming endpoint by default. Non-streaming response is treated as a single-chunk stream.
- **Cache-hint is wire-shape-agnostic.** `forkedAgent.ts` builds `cacheBreakpoints: [parentSession.messages.length - 1]` and never branches on `provider.cachePolicy`. The provider adapter swallows or honours.
- **Auth refresh is provider-internal.** `LLMProvider.stream()` is allowed to await up to one synchronous `auth.refresh()` call before issuing the HTTP request. Refresh hooks have a 30 s budget; failures translate to a `ProviderEvent { type: 'error', code: 'auth_refresh_failed', message }`.
- **Local providers degrade gracefully.** When a local model rejects the `tools` field with HTTP 400, `LocalProvider` retries once with tools rendered as a system-prompt schema (the "stub-tools" fallback), and tags the resulting events with `degraded: true` flags via the `cache_hit` event variant (re-purposed: see §5.3).

---

## 5. Data schemas

### 5.1 Extended `LLMProvider` interface (replaces `types.ts:36-42`)

```ts
// src/core/provider/types.ts
import type { Message, StopReason, TokenUsage } from '../message/types'

export type ProviderFormat =
  | 'anthropic'      // wire shape: messages.create / SSE block events
  | 'openai'         // wire shape: chat.completions / SSE delta chunks
  | 'google'         // wire shape: streamGenerateContent / candidates parts
  | 'local-openai'   // wire shape: openai-compatible, local transport, may stub tools

export type CachePolicy =
  | 'anthropic-explicit'  // inject cache_control markers on hinted message indices
  | 'gemini-context'      // create CachedContent and reference by name
  | 'none'                // best-effort implicit caching or no caching at all

export type AuthConfig =
  | { kind: 'apiKey';        apiKey: string; envVar?: string }
  | { kind: 'awsCreds';      accessKeyId: string; secretAccessKey: string;
                             sessionToken?: string; region: string;
                             /** Optional async refresh hook; called when SigV4
                              *  signing detects a 403 InvalidSignatureException. */
                             refresh?: () => Promise<{ accessKeyId: string;
                                                       secretAccessKey: string;
                                                       sessionToken?: string }> }
  | { kind: 'serviceAccount'; filePath: string;   // path to GCP service-acct JSON
                              project: string;
                              location: string;   // e.g. 'us-central1'
                              cachedToken?: { token: string; exp: number } }
  | { kind: 'bearerRefresh'; token: string; exp: number;
                             refresh: () => Promise<{ token: string; exp: number }> }
  | { kind: 'none' }

export type CacheHint = {
  /** Indices into `messages[]` that the provider may use as cache breakpoints.
   *  Anthropic translates each into a `cache_control: {type: 'ephemeral'}` on the
   *  message at that index. Gemini uses the *first* breakpoint as the prefix
   *  boundary for `CachedContent`. OpenAI / local ignore. */
  breakpoints: number[]
  /** Optional opaque cache id from a prior call. Gemini stores the
   *  `cachedContents/<id>` name here so the next turn skips the create round-trip. */
  cacheId?: string
}

export type ToolSpec = {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
}

export type Effort = 'low' | 'medium' | 'high'

export type LLMRequest = {
  model: string
  messages: Message[]
  system: string
  tools: ToolSpec[]
  maxTokens?: number
  temperature?: number
  effort?: Effort
  /** Per-turn cache hint from the loop / forkedAgent. Adapter is free to ignore. */
  cacheHint?: CacheHint
}

export type ProviderEvent =
  // Existing — unchanged.
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_args_delta'; id: string; delta: string }
  | { type: 'tool_use_stop'; id: string; input: unknown }
  | { type: 'message_stop'; stopReason: StopReason; usage: TokenUsage }
  // New, additive variants — `loop.ts:applyToAssistant` is an if/else-if chain
  // that silently ignores unknown types, so consumers tolerate these without
  // churn until a UI deliberately handles them (e.g. recap fold for reasoning,
  // error toast for error, debug log for cache_hit).
  | { type: 'reasoning_delta'; text: string }
  | { type: 'error'; code: ProviderErrorCode; message: string; retriable: boolean }
  | { type: 'cache_hit'; cacheId?: string; bytesReused?: number; degraded?: boolean }

export type ProviderErrorCode =
  | 'auth_refresh_failed'
  | 'rate_limited'
  | 'service_unavailable'
  | 'model_not_found'
  | 'context_too_large'
  | 'tool_schema_unsupported'
  | 'unknown'

export type ModelCapabilities = {
  cache: boolean         // honours cache_control / context-cache
  tools: boolean         // native tool / function calling
  vision: boolean        // accepts image content blocks natively
  reasoning: boolean     // emits reasoning_delta (o-series, gemini, claude-thinking)
  maxTokens: number      // documented context window
  /** USD per 1M tokens (input/output/cacheRead/cacheCreate). */
  pricing: { input: number; output: number;
             cacheRead?: number; cacheCreate?: number }
}

export type ModelInfo = {
  id: string                          // canonical model id, e.g. 'gemini-2.0-flash'
  providerId: string                  // points into config.providers[].id
  displayName: string                 // for the picker
  capabilities: ModelCapabilities
}

export interface LLMProvider {
  readonly id: string
  readonly format: ProviderFormat
  readonly cachePolicy: CachePolicy
  /** Discriminated auth config, frozen after construction. Adapters may mutate
   *  internal token caches but must NOT replace the config object. */
  readonly auth: AuthConfig
  stream(req: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
  listRemoteModels(): Promise<string[]>
  countTokens?(messages: Message[]): Promise<number>
  /** Optional health probe: lightweight request that returns OK iff auth is live. */
  health?(signal: AbortSignal): Promise<{ ok: boolean; latencyMs: number; reason?: string }>
}
```

**Migration impact on existing code:**

- `anthropic.ts:13-18` — opts type extended with `auth: AuthConfig` (kind=`apiKey`); existing `apiKey` field becomes `auth.apiKey`. Backward-compatible adapter in `resolver.ts:38-52`.
- `openai.ts:12-17` — same pattern.
- `loop.ts:252-261` — pass `cacheHint` through to `provider.stream()`; loop computes `[messages.length - 1]` by default (last user message) but the hint is overridable per-call.
- `forkedAgent.ts:62-72` — pass `cacheHint: { breakpoints: [params.forkContextMessages.length - 1] }`.

### 5.2 `ProviderConfig` extension (replaces `config/schema.ts:13-23`)

```ts
export const AuthConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('apiKey'), apiKey: z.string(), envVar: z.string().optional() }),
  z.object({ kind: z.literal('awsCreds'),
             accessKeyId: z.string(), secretAccessKey: z.string(),
             sessionToken: z.string().optional(),
             region: z.string() }),
  z.object({ kind: z.literal('serviceAccount'),
             filePath: z.string(), project: z.string(), location: z.string() }),
  z.object({ kind: z.literal('bearerRefresh'),
             token: z.string(), exp: z.number(),
             refreshUrl: z.string().url().optional() }),
  z.object({ kind: z.literal('none') }),
])

export const ProviderFormatSchema = z.enum(['anthropic', 'openai', 'google', 'local-openai'])

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  format: ProviderFormatSchema,
  baseUrl: z.string().url(),
  /** Replaces the old `apiKey?: string`. Backward-compatible: a string-only
   *  `apiKey` field at the top level is accepted by the loader and rewritten
   *  to `auth: { kind: 'apiKey', apiKey }`. */
  auth: AuthConfigSchema,
  models: z.array(z.string()).default([]),
  selectedModel: z.string().optional(),
  extraHeaders: z.record(z.string(), z.string()).optional(),
  pricing: z.record(z.string(), PricingSchema).optional(), // overrides registry
  /** Provider-specific knobs, validated per-format by the adapter constructor. */
  options: z.record(z.string(), z.unknown()).optional(),
})
```

**Per-provider `options` keys:**

| `format`        | Required `options` keys                              | Optional                      |
| --------------- | ---------------------------------------------------- | ----------------------------- |
| `anthropic`     | —                                                    | `betas: string[]`             |
| `openai`        | —                                                    | `organization: string`        |
| `google`        | `flavor: 'aiStudio' \| 'vertex'`                     | `safetyOff: boolean`          |
| `local-openai`  | `transport: 'ollama' \| 'llamacpp'`                  | `stubToolsAlways: boolean`    |
| (Bedrock)       | (uses `format: 'anthropic'` + `auth.kind: awsCreds`) | `runtimeUrl: string` override |

Bedrock is **not** a separate `format`: its wire-shape on the input is a tweaked Anthropic envelope (`anthropic_version: "bedrock-2023-05-31"` field added). The differentiator is `auth.kind === 'awsCreds'`, which `resolver.ts` uses to construct `BedrockProvider` instead of `AnthropicProvider`. See §6.4.

### 5.3 `ProviderEvent` JSON wire shape

The exact JSON encoding when these events cross a process boundary (e.g. for the existing `events/<session>.ndjson` flusher):

```json
// text_delta (existing)
{ "type": "text_delta", "text": "Hello" }

// reasoning_delta (NEW)
{ "type": "reasoning_delta", "text": "I should first check..." }

// error (NEW)
{ "type": "error",
  "code": "rate_limited",
  "message": "429: please retry after 12s",
  "retriable": true }

// cache_hit (NEW) — emitted at most once per stream, before the first content
{ "type": "cache_hit",
  "cacheId": "cachedContents/3xy7q9",
  "bytesReused": 8421,
  "degraded": false }

// cache_hit re-purposed for local-openai stub-tools degraded path
{ "type": "cache_hit", "degraded": true }
```

**Why `cache_hit` carries the local-degraded flag:** the local stub-tools path is an out-of-band shape change the consumer might want to surface. Rather than introduce a fourth new event variant, we let `cache_hit` carry a `degraded` boolean. The semantics are: "the provider is signalling a structural property of this turn that the consumer may want to render differently." `cacheId`/`bytesReused` are absent on the local path; `degraded` is absent on the cache-hit path.

### 5.4 `ModelRegistry` (NEW: `src/core/provider/registry.ts`)

```ts
export type RegistryEntry = ModelInfo & {
  /** Optional canonical alias prefix that auto-routes when the user enters a
   *  model id without an explicit providerId. e.g. 'gemini-' → providerId='gemini'. */
  routePrefix?: string
}

export const MODEL_REGISTRY: readonly RegistryEntry[] = [
  // Anthropic (Cloud)
  { id: 'claude-opus-4-7',   providerId: 'anthropic', displayName: 'Claude Opus 4.7',
    routePrefix: 'claude-',
    capabilities: { cache: true, tools: true, vision: true, reasoning: true,
                    maxTokens: 200_000,
                    pricing: { input: 15.0, output: 75.0,
                               cacheCreate: 18.75, cacheRead: 1.50 } } },
  { id: 'claude-sonnet-4-6', providerId: 'anthropic', displayName: 'Claude Sonnet 4.6',
    capabilities: { cache: true, tools: true, vision: true, reasoning: true,
                    maxTokens: 200_000,
                    pricing: { input: 3.0, output: 15.0,
                               cacheCreate: 3.75, cacheRead: 0.30 } } },
  { id: 'claude-haiku-4-5',  providerId: 'anthropic', displayName: 'Claude Haiku 4.5',
    capabilities: { cache: true, tools: true, vision: true, reasoning: false,
                    maxTokens: 200_000,
                    pricing: { input: 0.25, output: 1.25,
                               cacheCreate: 0.30, cacheRead: 0.025 } } },
  // OpenAI
  { id: 'gpt-5',             providerId: 'openai', displayName: 'GPT-5',
    routePrefix: 'gpt-',
    capabilities: { cache: false, tools: true, vision: true, reasoning: true,
                    maxTokens: 256_000,
                    pricing: { input: 3.0, output: 15.0 } } },
  { id: 'gpt-4o',            providerId: 'openai', displayName: 'GPT-4o',
    capabilities: { cache: false, tools: true, vision: true, reasoning: false,
                    maxTokens: 128_000,
                    pricing: { input: 2.5, output: 10.0 } } },
  { id: 'gpt-4o-mini',       providerId: 'openai', displayName: 'GPT-4o mini',
    capabilities: { cache: false, tools: true, vision: true, reasoning: false,
                    maxTokens: 128_000,
                    pricing: { input: 0.15, output: 0.60 } } },
  { id: 'o3-mini',           providerId: 'openai', displayName: 'o3-mini',
    routePrefix: 'o',
    capabilities: { cache: false, tools: true, vision: false, reasoning: true,
                    maxTokens: 200_000,
                    pricing: { input: 1.10, output: 4.40 } } },
  // Gemini (AI Studio)
  { id: 'gemini-2.0-flash',  providerId: 'gemini', displayName: 'Gemini 2.0 Flash',
    routePrefix: 'gemini-',
    capabilities: { cache: true, tools: true, vision: true, reasoning: false,
                    maxTokens: 1_048_576,
                    pricing: { input: 0.075, output: 0.30 } } },
  { id: 'gemini-2.0-pro',    providerId: 'gemini', displayName: 'Gemini 2.0 Pro',
    capabilities: { cache: true, tools: true, vision: true, reasoning: true,
                    maxTokens: 2_097_152,
                    pricing: { input: 1.25, output: 5.0 } } },
  // Bedrock (Anthropic-via-Bedrock; SigV4 wrapping the Anthropic envelope)
  { id: 'bedrock:anthropic.claude-sonnet-4-6-v1',
    providerId: 'bedrock', displayName: 'Claude Sonnet 4.6 (Bedrock)',
    routePrefix: 'bedrock:',
    capabilities: { cache: false, tools: true, vision: true, reasoning: true,
                    maxTokens: 200_000,
                    pricing: { input: 3.0, output: 15.0 } } },
  { id: 'bedrock:meta.llama-3-3-70b-instruct',
    providerId: 'bedrock', displayName: 'Llama 3.3 70B (Bedrock)',
    capabilities: { cache: false, tools: true, vision: false, reasoning: false,
                    maxTokens: 8_192,
                    pricing: { input: 2.65, output: 3.50 } } },
  // Vertex AI (Anthropic-via-Vertex; service-account JWT)
  { id: 'vertex:claude-sonnet-4-6@20260301',
    providerId: 'vertex', displayName: 'Claude Sonnet 4.6 (Vertex)',
    routePrefix: 'vertex:',
    capabilities: { cache: true, tools: true, vision: true, reasoning: true,
                    maxTokens: 200_000,
                    pricing: { input: 3.0, output: 15.0,
                               cacheCreate: 3.75, cacheRead: 0.30 } } },
  // Local
  { id: 'local:llama-3.1-70b',
    providerId: 'local', displayName: 'Llama 3.1 70B (Ollama)',
    routePrefix: 'local:',
    capabilities: { cache: false, tools: false, vision: false, reasoning: false,
                    maxTokens: 8_192,
                    pricing: { input: 0, output: 0 } } },
  { id: 'local:qwen2.5-coder-32b',
    providerId: 'local', displayName: 'Qwen 2.5 Coder 32B (llama.cpp)',
    capabilities: { cache: false, tools: true, vision: false, reasoning: false,
                    maxTokens: 32_768,
                    pricing: { input: 0, output: 0 } } },
] as const

/** Look up by canonical model id, with `provider/model` and prefix tolerance. */
export function findModel(id: string): RegistryEntry | undefined { /* ... */ }

/** Resolve a model id to a providerId via routePrefix. */
export function routeProviderId(modelId: string): string | undefined { /* ... */ }
```

The registry is the single source of truth. `pricing.ts` (§5.5) reduces to a thin lookup that defers to `findModel(id).capabilities.pricing`.

### 5.5 Cost-tracking pricing extension (`src/core/cost/pricing.ts`)

```ts
import { findModel } from '../provider/registry'

export function findPricing(model: string, providerId?: string): ModelPricing | undefined {
  // 1. Exact id match in the registry.
  const exact = findModel(model)
  if (exact) return exact.capabilities.pricing
  // 2. provider/model fallback (e.g. 'anthropic/claude-opus-4-7').
  const slash = model.lastIndexOf('/')
  if (slash >= 0) {
    const tail = model.slice(slash + 1)
    const e = findModel(tail)
    if (e) return e.capabilities.pricing
  }
  // 3. Provider-specified override from `cfg.providers[i].pricing`. (Not visible
  //    here; loader injects via a per-process pricing overlay; see §6.5.)
  return undefined
}
```

The legacy `PRICING` table at `pricing.ts:30-40` is removed; tests are updated to read from the registry.

### 5.6 `Session.providerSwitch` field

```ts
// src/core/session/types.ts (extension)
export type ProviderSwitchRecord = {
  ts: number
  fromProviderId: string
  fromModel: string
  toProviderId: string
  toModel: string
  /** Whether this switch invalidated the previous cache slot. */
  cacheInvalidated: boolean
}
export type Session = {
  // ...existing fields
  providerSwitches: ProviderSwitchRecord[]
}
```

`/model` slash command (and the model-picker dialog) appends a record on every switch and clears any opaque `session.cacheKey` (Gemini's `cachedContents/<id>` name).

### 5.7 `ConfigSchema` field additions

```ts
export const ConfigSchema = z.object({
  // ...existing
  /** Per-provider auth refresh policy override. */
  providerAuthRefresh: z.object({
    bedrockMaxLeadSeconds: z.number().default(300),    // refresh creds 5 min before expiry
    vertexMaxLeadSeconds: z.number().default(300),
  }).optional(),
  /** Local provider auto-detection toggle. Default false; if true, onboarding
   *  scans localhost:11434 (Ollama) and localhost:8080 (llama.cpp) and
   *  *suggests* (does not auto-add) a local provider. */
  detectLocal: z.boolean().default(false),
})
```

---

## 6. Component contracts

This section specifies the per-provider adapter signatures and key methods. Every adapter implements `LLMProvider` (§5.1).

### 6.1 GeminiProvider (`src/core/provider/gemini.ts`)

```ts
type GeminiOpts = {
  id: string
  baseUrl: string                 // 'https://generativelanguage.googleapis.com/v1beta'
  auth: Extract<AuthConfig, { kind: 'apiKey' }>
  flavor: 'aiStudio' | 'vertex'   // 'vertex' uses a different baseUrl + bearer auth
  options?: { safetyOff?: boolean }
}

class GeminiProvider implements LLMProvider {
  readonly format = 'google' as const
  readonly cachePolicy = 'gemini-context' as const
  readonly auth: AuthConfig

  constructor(opts: GeminiOpts) { /* ... */ }

  async *stream(req: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    // 1. Translate req.messages → Gemini `contents: [{role, parts: [{text|inlineData|functionCall|functionResponse}]}]`
    // 2. If req.cacheHint?.breakpoints.length > 0 AND cachePolicy active:
    //    a. If req.cacheHint.cacheId is set, attach cachedContent: req.cacheHint.cacheId
    //    b. Else POST :cachedContents.create with prefix; emit { cache_hit, cacheId, bytesReused }
    // 3. POST :streamGenerateContent?key=<apiKey> with SSE parsing
    // 4. Translate each response chunk:
    //    - candidates[0].content.parts[i].text → text_delta
    //    - candidates[0].content.parts[i].thoughtSummary → reasoning_delta
    //    - candidates[0].content.parts[i].functionCall → tool_use_start/_args_delta/_stop
    //    - usageMetadata at end → message_stop
    //    - mid-stream errorResponse → ProviderEvent error (retriable=true for 429/503)
  }

  async listRemoteModels(): Promise<string[]> {
    // GET /models?key=<apiKey> → unique model.name extraction
  }

  async health(signal): Promise<{ ok; latencyMs; reason? }> {
    // GET /models?key=<apiKey>&pageSize=1
  }
}
```

**Key translation table — Gemini message shape:**

| Nuka `Message`                           | Gemini `Content`                                                     |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `{role:'user', content:[{type:'text'}]}` | `{role:'user', parts:[{text}]}`                                      |
| `{role:'assistant', tool_use blocks}`    | `{role:'model', parts:[{functionCall:{name,args}}]}`                 |
| `{role:'tool', content}`                 | `{role:'function', parts:[{functionResponse:{name,response:{...}}}]}`|
| `system` string                          | top-level `systemInstruction: {parts:[{text}]}`                      |

**Gemini context cache integration:**

```
on stream() entry:
  if cachePolicy === 'gemini-context' AND req.cacheHint?.breakpoints?.length:
    breakpoint = max(req.cacheHint.breakpoints)
    if req.cacheHint.cacheId:
      cachedContent = req.cacheHint.cacheId
    else:
      // Create cache for the prefix [0..breakpoint]
      const prefix = req.messages.slice(0, breakpoint+1)
      const create = await POST /cachedContents
        { model, contents: translate(prefix), systemInstruction, ttl: '300s' }
      cachedContent = create.name
      yield { type: 'cache_hit', cacheId: cachedContent }
    body.cachedContent = cachedContent
    body.contents = translate(req.messages.slice(breakpoint+1))
```

The session-level `cacheKey` (§5.6) is the only place the `cachedContent` name persists across turns.

### 6.2 BedrockProvider (`src/core/provider/bedrock.ts`)

```ts
type BedrockOpts = {
  id: string
  auth: Extract<AuthConfig, { kind: 'awsCreds' }>
  options?: { runtimeUrl?: string }   // override for VPC endpoints
}

class BedrockProvider implements LLMProvider {
  readonly format = 'anthropic' as const  // payload shape
  readonly cachePolicy = 'none' as const   // v1 — see §3 non-goal
  readonly auth: AuthConfig

  async *stream(req: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    // 1. Build Anthropic-style body with Bedrock prefix:
    //    { anthropic_version: 'bedrock-2023-05-31', system, messages, tools, max_tokens, ... }
    //    Strip cache_control markers from messages — Bedrock rejects unknown fields.
    // 2. Construct URL: https://bedrock-runtime.<region>.amazonaws.com/model/<modelId>/invoke-with-response-stream
    //    (modelId is req.model with the 'bedrock:' prefix stripped)
    // 3. SigV4-sign the request — see §6.7
    // 4. fetch(url, {method:'POST', headers: signedHeaders, body, signal})
    // 5. Parse application/vnd.amazon.eventstream framing — emit Anthropic SSE
    //    events through the SAME translation logic as AnthropicProvider.translateStream.
    // 6. On 403 InvalidSignatureException with auth.refresh present:
    //    refresh once, retry once, then emit error event.
  }

  async listRemoteModels(): Promise<string[]> {
    // GET https://bedrock.<region>.amazonaws.com/foundation-models — returns
    // a paginated list. We extract modelId and prefix with 'bedrock:'.
  }
}
```

**Bedrock event-stream framing.** Bedrock wraps each inner Anthropic SSE event in an `application/vnd.amazon.eventstream` frame: `[prelude (12 bytes)][headers][payload (JSON {bytes:base64})][crc]`. We implement `parseEventStream(stream): AsyncIterable<{headers, payload}>` in `src/core/provider/aws/eventstream.ts` (~80 LOC). The payload, base64-decoded, is `{"bytes": "<base64-of-anthropic-sse-event>"}` whose decoded body is the same JSON the AnthropicProvider already translates. We reuse `AnthropicProvider.translateStream` from `anthropic.ts:73-135` directly to avoid duplication.

### 6.3 VertexProvider (`src/core/provider/vertex.ts`)

```ts
type VertexOpts = {
  id: string
  auth: Extract<AuthConfig, { kind: 'serviceAccount' }>
}

class VertexProvider implements LLMProvider {
  readonly format = 'anthropic' as const  // Anthropic-on-Vertex uses Anthropic envelope
  readonly cachePolicy = 'anthropic-explicit' as const
  readonly auth: AuthConfig

  async *stream(req: LLMRequest, signal): AsyncIterable<ProviderEvent> {
    // 1. Mint a JWT from the service-account JSON, exchange for a 1h Bearer
    //    token via https://oauth2.googleapis.com/token (cache in auth.cachedToken)
    // 2. Construct URL:
    //    https://<location>-aiplatform.googleapis.com/v1/projects/<project>/
    //      locations/<location>/publishers/anthropic/models/<modelId>:streamRawPredict
    // 3. Body: { anthropic_version: 'vertex-2023-10-16', stream: true, ...AnthropicEnvelope }
    // 4. fetch with Authorization: Bearer <token>; SSE in regular text/event-stream
    // 5. Parse and translate via AnthropicProvider.translateStream
  }

  async listRemoteModels(): Promise<string[]> {
    // Vertex: hardcoded list (registry §5.4) since the Models API doesn't list
    // partner-publisher models in a useful way.
    return MODEL_REGISTRY.filter(m => m.providerId === 'vertex').map(m => m.id)
  }
}
```

**JWT minting (~40 LOC):** RS256 sign of `{iss, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', exp, iat}` using the `private_key` field from the service-account JSON. Node's `crypto.createSign('RSA-SHA256')` covers it; no external dep.

### 6.4 LocalProvider (`src/core/provider/local.ts`)

```ts
type LocalOpts = {
  id: string
  baseUrl: string             // 'http://localhost:11434' or 'http://localhost:8080'
  auth: Extract<AuthConfig, { kind: 'none' }>
  transport: 'ollama' | 'llamacpp'
  stubToolsAlways?: boolean   // skip native-tools attempt; go straight to stub
}

class LocalProvider implements LLMProvider {
  readonly format = 'local-openai' as const
  readonly cachePolicy = 'none' as const
  readonly auth: AuthConfig = { kind: 'none' }

  async *stream(req: LLMRequest, signal): AsyncIterable<ProviderEvent> {
    // 1. POST <baseUrl>/v1/chat/completions with stream=true and tools (if req.tools.length > 0)
    // 2. If 400 with body matching /tools|functions|tool_calls/i AND req.tools.length > 0:
    //    a. Yield { type: 'cache_hit', degraded: true }
    //    b. Retry once with tools synthesized into a system-prompt schema:
    //         "You may call tools by emitting JSON like {\"tool\":\"name\",\"input\":{...}}.
    //          Available tools: <pretty-printed schemas>"
    //    c. Parse tool calls out of the streamed text via a streaming JSON-block
    //       extractor (best-effort; emits `tool_use_start`/`_args_delta`/`_stop` synthetically)
    // 3. Translate via OpenAIProvider.translateStream when not degraded.
  }

  async listRemoteModels(): Promise<string[]> {
    // Ollama: GET <baseUrl>/api/tags → models[].name
    // llamacpp: GET <baseUrl>/v1/models → data[].id
  }

  async health(signal): Promise<{ ok; latencyMs; reason? }> {
    // GET <baseUrl>/api/tags or /v1/models — connection-refused = ok:false
  }
}
```

**Stub-tools fallback transcript (system-prompt addendum):**

```
You have access to the following tools. To call a tool, emit a single JSON
object on its own line, surrounded by <tool_call> and </tool_call> tags:

<tool_call>{"tool":"<name>","input":{...}}</tool_call>

Tools:
- Edit: { ... JSON Schema ... }
- Read: { ... JSON Schema ... }
...

After a tool runs, the user will reply with:
<tool_result>{"id":"...","output":"..."}</tool_result>

When done, respond normally without any <tool_call> tag.
```

We use angle-bracket tags (not bare JSON) so the streaming extractor can lock onto a sentinel and avoid mis-parsing legitimate JSON in the response. The extractor watches for `<tool_call>` in the streamed `text_delta` text, switches to "buffering args" mode, watches for `</tool_call>`, then emits the synthesized tool events.

### 6.5 Pricing overlay (`src/core/cost/pricing.ts`)

```ts
let providerOverlay: Map<string, ModelPricing> = new Map()  // model → ModelPricing

export function setProviderPricingOverlay(cfg: Config): void {
  providerOverlay = new Map()
  for (const p of cfg.providers) {
    if (!p.pricing) continue
    for (const [model, price] of Object.entries(p.pricing)) {
      providerOverlay.set(model, {
        input: price.input,
        output: price.output,
        cacheCreate: price.cacheWrite,
        cacheRead: price.cacheRead,
      })
    }
  }
}

export function findPricing(model: string): ModelPricing | undefined {
  if (providerOverlay.has(model)) return providerOverlay.get(model)
  // ...rest as in §5.5
}
```

### 6.6 ProviderResolver extension (`src/core/provider/resolver.ts`)

```ts
class ProviderResolver {
  // ...existing fields

  constructor(cfg: Config, opts: ProviderResolverOpts = {}) {
    // ...same as today, but buildInstance switches on (format, auth.kind):
  }

  private buildInstance(pc: ProviderConfig): LLMProvider {
    switch (pc.format) {
      case 'anthropic':
        if (pc.auth.kind === 'awsCreds')       return new BedrockProvider({...})
        if (pc.auth.kind === 'serviceAccount') return new VertexProvider({...})
        return new AnthropicProvider({...})
      case 'openai':
        return new OpenAIProvider({...})
      case 'google':
        return new GeminiProvider({...,
          flavor: (pc.options?.flavor as 'aiStudio' | 'vertex') ?? 'aiStudio'})
      case 'local-openai':
        return new LocalProvider({...,
          transport: (pc.options?.transport as 'ollama' | 'llamacpp') ?? 'ollama'})
    }
  }

  /** NEW — convenience routing by model id prefix, when a session has no explicit
   *  providerId yet. The first registered provider whose id matches takes precedence. */
  routeByModel(modelId: string): { providerId: string; model: string } | undefined {
    const entry = findModel(modelId) ?? findModelByPrefix(modelId)
    if (!entry) return undefined
    if (this.byId.has(entry.providerId)) return { providerId: entry.providerId, model: entry.id }
    return undefined
  }
}
```

### 6.7 SigV4 signer (`src/core/provider/aws/sigv4.ts`)

Hand-rolled, ~200 LOC. Signature algorithm `AWS4-HMAC-SHA256` for service `bedrock` is the same as for any other AWS REST API:

```ts
export type SigV4Input = {
  method: 'POST' | 'GET'
  url: string                     // full URL
  region: string
  service: string                 // 'bedrock'
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  body?: string | Uint8Array      // exact bytes that will be sent
  date?: Date                     // for testability
  extraHeaders?: Record<string, string>
}

export type SigV4Output = {
  headers: Record<string, string> // includes Authorization, X-Amz-Date, etc.
  url: string                     // unchanged
}

export function signV4(input: SigV4Input): SigV4Output { /* ... */ }
```

**Algorithm steps (test-anchored):**

1. **Canonical request** = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${SHA256(body)}` (lowercase hex).
2. **String to sign** = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${SHA256(canonicalRequest)}`. `credentialScope = ${date}/${region}/${service}/aws4_request`.
3. **Signing key** = `HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), service), "aws4_request")`.
4. **Signature** = `HMAC(signingKey, stringToSign)` (hex).
5. **Authorization header** = `AWS4-HMAC-SHA256 Credential=...,SignedHeaders=...,Signature=...`.

**Test vectors.** AWS publishes a [SigV4 test suite](https://docs.aws.amazon.com/general/latest/gr/signature-v4-test-suite.html) covering 17 cases. We vendor a JSON-encoded subset of 6 (`get-vanilla`, `post-vanilla`, `post-vanilla-empty-body`, `post-x-www-form-urlencoded`, `get-utf8`, `post-sts-token`) into `test/fixtures/sigv4-suite.json` and assert byte-exact `Authorization` header reproduction.

**Why hand-roll, not `@aws-sdk/client-bedrock-runtime`:**
- AWS SDK v3 client-bedrock-runtime + transitive deps is ~600 KB unzipped; SigV4 alone is ~200 LOC.
- We already use Node's native `fetch` everywhere; the AWS SDK ships its own HTTP client and signing pipeline.
- Bundle size is a stated Phase 10 goal; pulling AWS SDK contradicts it.
- Hand-roll keeps the dependency surface (and CVE blast radius) flat.

Trade-off accepted: we own the algorithm. SigV4 has not changed since 2012 and the test vectors are public.

### 6.8 Mid-session model switch (`src/slash/model.ts` + dialog handler)

```ts
// In the model-picker dialog accept handler:
function applyModelSelection(session: Session, sel: ModelInfo, resolver: ProviderResolver): void {
  const prev = { providerId: session.providerId, model: session.model }
  const cacheInvalidated = prev.providerId !== sel.providerId
  if (cacheInvalidated) {
    session.cacheKey = undefined  // drops Gemini cachedContent name
  }
  session.providerId = sel.providerId
  session.model = sel.id
  session.providerSwitches.push({
    ts: Date.now(),
    fromProviderId: prev.providerId, fromModel: prev.model,
    toProviderId: sel.providerId,    toModel: sel.id,
    cacheInvalidated,
  })
}
```

The TUI surfaces a one-line note in the conversation when `cacheInvalidated === true`:
`[switched to gemini-2.0-flash; prompt cache reset]`.

### 6.9 Onboarding probe extension (`src/core/onboarding/providerProbe.ts`)

Switch grows three new branches; existing two unchanged.

```ts
async function probe(t, key, fetchFn): Promise<ProbeResult> {
  if (t.type === 'openai')      return probeOpenAI(t, key, fetchFn)
  if (t.type === 'anthropic')   return probeAnthropic(t, key, fetchFn)
  if (t.type === 'gemini')      return probeGemini(t, key, fetchFn)
  if (t.type === 'bedrock')     return probeBedrock(t, key, fetchFn)
  if (t.type === 'vertex')      return probeVertex(t, key, fetchFn)
  if (t.type === 'local')       return probeLocal(t, fetchFn)
  return { ok: false, reason: `unsupported provider type: ${t.type}` }
}
```

Probe semantics:
- **Gemini**: GET `${baseUrl}/models?key=${apiKey}&pageSize=1`. 200 → ok with optional model list. 401/403 → bad key.
- **Bedrock**: GET `https://bedrock.${region}.amazonaws.com/foundation-models?byInferenceType=ON_DEMAND` with SigV4 — ListFoundationModels has no per-call cost. Errors map to `auth_refresh_failed` for 403s, `service_unavailable` for 5xx.
- **Vertex**: exchange the JWT for a Bearer token (this is the actual auth boundary), then GET `/v1/projects/${project}/locations/${location}/models` with that token. Caches the token in `auth.cachedToken`.
- **Local**: GET `${baseUrl}/api/tags` (Ollama) or `${baseUrl}/v1/models` (llama.cpp); ECONNREFUSED → "server not running".

Each probe is bounded by a 5 s timeout (Vertex's JWT exchange occasionally is slow on cold starts).

`/doctor` (`src/slash/doctor.ts:13-31` is unchanged; the underlying `runDoctor` extends `providers` to call the new probes per-provider).

### 6.10 Onboarding flow extension (`src/core/onboarding/templates.ts`)

```ts
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  // ...existing 3
  { id: 'gemini',  type: 'gemini',  name: 'Google Gemini (AI Studio)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    defaultModels: ['gemini-2.0-flash', 'gemini-2.0-pro'],
    apiKeyEnvVar: 'GEMINI_API_KEY',
    helpUrl: 'https://aistudio.google.com/apikey' },
  { id: 'bedrock', type: 'bedrock', name: 'AWS Bedrock',
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    defaultModel: 'bedrock:anthropic.claude-sonnet-4-6-v1',
    defaultModels: [/* registry filter */],
    apiKeyEnvVar: 'AWS_ACCESS_KEY_ID',  // wizard then asks for SECRET separately
    helpUrl: 'https://docs.aws.amazon.com/bedrock/' },
  { id: 'vertex',  type: 'vertex',  name: 'Google Cloud Vertex AI',
    baseUrl: 'https://us-central1-aiplatform.googleapis.com',
    defaultModel: 'vertex:claude-sonnet-4-6@20260301',
    defaultModels: [/* registry filter */],
    apiKeyEnvVar: 'GOOGLE_APPLICATION_CREDENTIALS',  // path to JSON
    helpUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts' },
  { id: 'local',   type: 'local',   name: 'Local (Ollama / llama.cpp)',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'local:llama-3.1-70b',
    defaultModels: [/* probed at first run */],
    apiKeyEnvVar: '',
    helpUrl: 'https://github.com/ollama/ollama' },
]
```

**Default-when-local-detected behaviour.** During first-run onboarding, *if and only if* the user has not configured any other provider AND `cfg.detectLocal === true` AND a probe of `localhost:11434` returns 200, the wizard **suggests** (not selects) the local provider. The user must explicitly accept. Sticky behaviour beats clever defaults: existing configs are never auto-modified, and `Local` never auto-becomes the active provider when other providers are present.

### 6.11 Forked-agent integration (`src/core/agent/forkedAgent.ts`)

The change is one line:

```ts
// Existing:
for await (const ev of provider.stream({
  model: params.modelParams.model,
  messages,
  system: params.systemPrompt,
  tools: toolSpecs,
  maxTokens: params.modelParams.maxTokens,
}, signal)) { ... }

// New:
for await (const ev of provider.stream({
  ...
  cacheHint: { breakpoints: [params.forkContextMessages.length - 1] },
}, signal)) { ... }
```

Adapter responsibility:
- **AnthropicProvider**: walks `req.messages` and on the indices in `cacheHint.breakpoints`, attaches `cache_control: {type: 'ephemeral'}` to the *last* content block of each. Implementation lives in `blocksToAnthropic` (`anthropic.ts:192-198`); it grows a third arg.
- **GeminiProvider**: as in §6.1, calls `cachedContents.create` once per (parent-session, breakpoint) pair, caches the returned name in `session.cacheKey`, attaches it to subsequent `streamGenerateContent` calls.
- **OpenAIProvider, BedrockProvider, LocalProvider**: ignore.
- **VertexProvider**: same as AnthropicProvider (it uses the Anthropic envelope through to the Anthropic backend).

`forkedAgent.ts` does not branch on `provider.cachePolicy`; it always emits the hint, and adapters self-select.

### 6.12 Agent-loop integration (`src/core/agent/loop.ts`)

Three targeted edits:

1. **L252-261**: extend `provider.stream(...)` arg construction to include `cacheHint: defaultCacheHint(session)`. `defaultCacheHint` returns `{ breakpoints: [session.messages.length - 1] }` for sessions with at least 4 messages, undefined otherwise (skip caching for very short sessions).
2. **L184-201**: `applyToAssistant` switch grows three new no-op cases (`reasoning_delta` → push to a separate `assistant.reasoning` field; `error` → set `assistant.errorReason` and short-circuit; `cache_hit` → no-op, telemetry handled at L264). All other consumers ignore.
3. **L264**: stream-loop folds new events:
   ```ts
   for await (const ev of stream) {
     if (ev.type === 'text_delta') yield { type: 'text_delta', text: ev.text }
     if (ev.type === 'reasoning_delta') yield { type: 'reasoning_delta', text: ev.text }
     if (ev.type === 'error' && !ev.retriable) yield { type: 'error', code: ev.code, message: ev.message }
     applyToAssistant(assistant, ev)
   }
   ```

`AssistantMessage` (in `core/message/types.ts`) is extended additively:
```ts
export type AssistantMessage = {
  // ...existing
  reasoning?: string         // accumulated reasoning_delta text
  errorReason?: string       // set when a non-retriable error event arrived
}
```

### 6.13 `/model` slash dialog data flow

The picker dialog (`src/tui/.../ModelPickerDialog.tsx`) reads from `MODEL_REGISTRY` and groups by `providerId`. Capability badges (cache, tools, vision, reasoning) render as 4 single-character glyphs. Selection produces a `ModelInfo` object that the caller passes to `applyModelSelection` (§6.8).

---

## 7. Testing strategy

### 7.1 Mock-server plumbing

We use **MSW (msw 2.x, already a Phase 14 test dep)** to intercept Node's native `fetch` for cloud providers and a bare HTTP server (Node `http.createServer`) for local providers. Per-provider fixtures live under `test/fixtures/providers/`:

```
test/fixtures/providers/
  anthropic-stream.ndjson         existing — reused
  openai-stream.ndjson            existing — reused
  gemini-stream.ndjson            new
  gemini-cached-create.json       new — POST :cachedContents response
  bedrock-eventstream.bin         new — application/vnd.amazon.eventstream framed
  bedrock-list-models.json        new
  vertex-token-exchange.json      new
  vertex-stream.ndjson            new
  local-ollama-tags.json          new
  local-ollama-chat.ndjson        new
  local-llamacpp-models.json      new
  local-stub-tools-roundtrip.txt  new — degraded-path scenario
  sigv4-suite.json                new — vendored AWS test vectors
```

Each fixture ships with a sibling `.expected.json` describing the expected `ProviderEvent[]` after translation. Tests assert deep-equality of the translated stream against `.expected.json`.

### 7.2 Per-provider unit tests

Three buckets per provider:

| Bucket          | Target                                                                    |
| --------------- | ------------------------------------------------------------------------- |
| Translation     | `translateStream(fixture)` produces expected `ProviderEvent[]`            |
| Wire shape      | `toProviderMessages(req.messages)` produces expected JSON body            |
| Auth            | `signRequest(...)` / `mintJwt(...)` / `attachApiKey(...)` byte-exact      |

Files under `test/core/provider/`:

- `gemini.translate.test.ts` — fixture replay
- `gemini.cache.test.ts` — `cachedContents.create` round-trip + breakpoint logic
- `bedrock.eventstream.test.ts` — event-stream framing decode
- `bedrock.translate.test.ts` — same fixture as Anthropic, after frame-decode
- `bedrock.sigv4.test.ts` — `sigv4-suite.json` round-trip
- `vertex.jwt.test.ts` — JWT signing with a fake key, exp/iat clocks
- `vertex.translate.test.ts` — same as Anthropic, via Vertex envelope
- `local.translate.test.ts` — Ollama and llama.cpp paths (parametrized)
- `local.stubtools.test.ts` — degraded path: tools rejected → re-prompt with schema → JSON-tag extractor synthesizes events
- `resolver.routing.test.ts` — `routeByModel` for each `routePrefix`
- `registry.test.ts` — registry lookups, prefix tolerance, capability shape

Existing `anthropic.translate.test.ts` and `openai.translate.test.ts` are unchanged.

### 7.3 Integration tests

`test/integration/provider-expansion.test.ts`:
1. Build a `ProviderResolver` with all 6 providers configured against MSW handlers.
2. Run a 3-turn conversation (text → tool-call → text) against each provider; assert the loop produces the same canonical `AgentEvent[]` (modulo `reasoning_delta` for o-series + Gemini Pro).
3. Mid-session switch from anthropic→gemini→bedrock; assert `providerSwitches` records the right entries and `cacheKey` is reset on each.
4. forkedAgent fork off each provider session; assert the hint is forwarded and (for Gemini) the cached-content is reused on the second fork.

`test/integration/onboarding-providers.test.ts`:
- Wizard runs through each new provider template; probe success and probe failure paths covered.

### 7.4 Property-based tests

`test/core/provider/translate.property.test.ts` — for each provider, fast-check generates random valid `LLMRequest`s and asserts:
- Round-trip serialization is total (no unhandled message kinds).
- The translator emits exactly one `message_stop` event per stream.
- Cache breakpoints in `[0, messages.length)` never out-of-bounds the wire body.

### 7.5 Cost-tracker tests

`test/core/cost/pricing.test.ts` (extended):
- Every entry in `MODEL_REGISTRY` has non-undefined `findPricing(id)`.
- Provider-overlay (`setProviderPricingOverlay`) shadows registry; reset clears.

### 7.6 Doctor tests

`test/core/doctor/run.test.ts` (extended):
- Per-provider probe success → green check.
- Per-provider probe failure → red X with reason.
- Local provider unreachable → "skipped (server not running)" yellow note.

### 7.7 Determinism and time

All probe / refresh tests inject a fake clock (`Date.now` via vi.useFakeTimers). SigV4 tests pass `date: new Date('2030-01-01T00:00:00Z')` for stable signatures. JWT tests pass `now: ...` for stable `iat`/`exp`.

### 7.8 Coverage targets

- Provider adapters: ≥ 90% line coverage. Translation path stricter (≥ 95%) since it owns user-visible event shape.
- SigV4 signer: 100% line coverage. The algorithm is small; we owe it bullet-proofing.
- Onboarding probes: ≥ 85% (network errors hard to enumerate).

---

## 8. Milestones

The work splits into seven milestones. M1 is blocking; M2–M5 can run in parallel as subagents; M6 is integration; M7 closes the spec. M8 is "tag and ship" and is identical to other Phase X foundations — covered by the plan.

### M1 — Interface refactor (blocking, ~1 day)

- Extend `LLMProvider`, `LLMRequest`, `ProviderEvent` per §5.1.
- Extend `AuthConfig`, `CacheHint`, `ModelInfo`, `ModelCapabilities` per §5.1.
- Extend `ConfigSchema` per §5.7; loader migration path (string `apiKey` → `auth: {kind: 'apiKey'}`).
- Update `AnthropicProvider` and `OpenAIProvider` to consume the new opts shape (one-line refactor each, plus cache-hint plumbing in Anthropic).
- Update `ProviderResolver.buildInstance` to switch on `(format, auth.kind)`.
- All existing tests in `test/core/provider/` continue to pass.

### M2 — Gemini (~1.5 days)

- `src/core/provider/gemini.ts` adapter (full impl).
- Message and event translators with reasoning support.
- `cachedContents.create` integration with session-level cache-key persistence.
- Fixtures + unit + integration tests.

### M3 — Bedrock + SigV4 (~2 days)

- `src/core/provider/aws/sigv4.ts` (~200 LOC, 100% covered by AWS test vectors).
- `src/core/provider/aws/eventstream.ts` (~80 LOC, framing parser).
- `src/core/provider/bedrock.ts` (full impl, reuses Anthropic translator).
- Fixtures + unit + integration tests including 403-refresh-retry-once path.

### M4 — Vertex (~1 day)

- `src/core/provider/vertex.ts` (full impl, reuses Anthropic translator).
- JWT minting + token caching.
- Fixtures + unit + integration tests.

### M5 — Local (Ollama / llama.cpp) (~1.5 days)

- `src/core/provider/local.ts` (full impl).
- Stub-tools fallback with streaming JSON-tag extractor.
- Both transport variants tested.
- Fixtures + unit + integration tests for degraded path.

### M6 — Cost + onboarding + /doctor (~1 day)

- `src/core/provider/registry.ts` + `findModel` / `routeProviderId`.
- Cost-tracker pricing pivots to registry; provider overlay.
- `providerProbe.ts` extended with three new probe variants + `local`.
- Onboarding wizard templates extended.
- `/doctor` runs all 6 probes.
- Tests across all six.

### M7 — Integration + mid-session switch (~1 day)

- `applyModelSelection` in `slash/model.ts`-side code; `Session.providerSwitches` plumbing.
- `forkedAgent.ts` cache-hint plumbing.
- `loop.ts` cache-hint default + reasoning_delta surface + error fold.
- `test/integration/provider-expansion.test.ts` — 6-provider round-trip.

**Total estimate: ~9 working days, parallelizable to ~4 calendar days** if M2/M3/M4/M5 are dispatched as separate subagents on top of M1.

---

## 9. Risks and mitigations

| Risk                                                                 | Likelihood | Impact | Mitigation                                                                                                                                                                |
| -------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SigV4 hand-roll bug** (signature mismatch, 403s in production)     | Medium     | High   | Vendor 6 AWS test vectors; 100% line coverage on the signer; one canary test that signs a real request against AWS test endpoints in CI (gated by env-secret).            |
| **Bedrock cold start** (>30 s on first turn after region inactivity) | High       | Medium | Surface `service_unavailable` mid-stream as a `ProviderEvent.error{retriable:true}`; the loop renders a yellow "warming up..." note. Don't auto-retry — user decides.     |
| **Vertex JWT clock skew** (NTP drift causes 401)                     | Low        | Medium | Mint with `iat = now - 60s` to absorb ±60 s skew. Document.                                                                                                              |
| **Gemini context cache TTL expiry** mid-session                      | Medium     | Low    | On 404 with `cachedContent`, drop `session.cacheKey`, rebuild cache, retry once. Surface a one-line `[cache reset]` note to the user.                                     |
| **Local provider tool-call drift** (model returns malformed JSON)    | High       | Low    | Extractor is best-effort; tool fails with `invalid_args` and the loop continues. We document the limitation in onboarding.                                                |
| **AWS SDK absence forces us to re-implement event-stream framing**   | Medium     | Medium | Framing is well-specified (12-byte prelude + 4-byte CRC + length-prefixed headers + payload + CRC); 80 LOC. Vendor a fixture from real Bedrock output.                    |
| **Multiple concurrent SigV4 streams using the same creds**           | Low        | Low    | Signer is pure; no shared mutable state. No mitigation needed beyond a regression test.                                                                                   |
| **`format: 'google'` collides with future genuine OpenAI-compatible Google endpoint** | Low        | Low    | Distinguish via `auth.kind`; `format` is wire-shape only. Documented inline.                                                                                              |
| **Provider-overlay pricing loses entries on hot reload**             | Low        | Low    | `setProviderPricingOverlay` is idempotent; reload calls it again with the new config.                                                                                     |
| **Mid-session switch loses tool-result correlation**                 | Medium     | Medium | The Anthropic↔OpenAI tool_use_id space is by-coincidence interoperable (both are opaque strings). Gemini's `functionCall` has no id field — we synthesize `gem-${idx}` ids and require the next turn to round-trip them via `functionResponse`. Documented. |
| **Spec churn during sibling spec landings (a, b, c, e)**             | Medium     | Low    | This spec touches `Session`, `LLMRequest`, `LLMProvider`, `Config`. Sibling specs touch unrelated subsystems (recap, cron, audit). Conflict surface is small — the assistant-message extension is shared with spec-e (context audit) by design. |

---

## 10. Out-of-scope (explicit deferrals)

- **OAuth (3LO) flows for Vertex.** Service-account JSON only this round. The v1 surfaces a clear error if `auth.kind === 'oauth'` is encountered (kind is reserved but unimplemented).
- **Bedrock prompt caching.** Anthropic-via-Bedrock supports caching only on certain regions; we ship `cachePolicy: 'none'` and revisit when AWS GA's it. Vertex-Anthropic gets full cache support (it pipes to the Anthropic backend).
- **Gemini Live (bidi)** streaming. We implement only `streamGenerateContent`. WebSocket-based Live is deferred.
- **Image input native paths.** All providers fall back to text placeholders on image content blocks (see existing `openai.ts:198-208`). Native image paths land per-provider as follow-up.
- **Multi-key load balancing.** Multiple providers of the same `format` are configurable; per-turn routing across them (round-robin / cost-aware) is deferred.
- **Streaming JSON repair.** If `tool_use_args_delta` arrives truncated due to mid-stream `error`, we surface the partial bytes; no in-stream repair logic.
- **Schema-prompt fallback for cloud providers.** Only `local` falls back; cloud is expected to support tools natively.
- **Per-provider rate limiter.** A future "provider request budget" is sketched in spec-b; this spec emits `rate_limited` errors but does not throttle preemptively.
- **Provider-side custom retries.** Only the SigV4 403 → refresh-once path is implemented. Generic retry (429/503 backoff) is the loop's job, not the provider's.
- **Local provider GPU/CPU profile detection.** We don't probe `/api/show` for runtime stats; the user picks a model from the registry's local subset.

---

## 11. Self-review checklist

- [x] Six providers behind one resolver, addressable by `providerId` and by model-id prefix.
- [x] `LLMProvider` extended with `cachePolicy` and `auth: AuthConfig` — additive; existing two providers gain a one-line constructor change.
- [x] `ProviderEvent` extended with `reasoning_delta`, `error`, `cache_hit` — verified additive against `loop.ts:184-201`.
- [x] `CacheHint` is wire-shape-agnostic; per-provider translation table specified in §6.1, §6.11.
- [x] SigV4 hand-rolled, 200 LOC budget, AWS test-vector coverage spelled out.
- [x] Model registry is the single source of truth for cost/picker/doctor.
- [x] Mid-session switch invalidates cache explicitly; `Session.providerSwitches` audited.
- [x] Onboarding probes all 6 (including ECONNREFUSED for local).
- [x] Local provider degrades to stub-tools when native tools rejected; surfaces a `cache_hit{degraded:true}` event.
- [x] Default-when-local-detected behaviour is *suggest only*, never auto-switch existing config.
- [x] No regression in existing two providers — all current tests in `test/core/provider/` continue passing.
- [x] Spec is not normative on multi-modal, OAuth, or load-balancing — explicit deferrals in §10.
- [x] All section headings have content; no TBDs in normative text.

---

## 12. Appendix A — Per-provider cache-hint translation table

The single most-asked question on this spec, captured in one table.

| Provider     | `cachePolicy`           | Translation of `cacheHint.breakpoints`                                                                                                          |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic    | `anthropic-explicit`    | For each `i ∈ breakpoints`, attach `cache_control: {type:'ephemeral'}` to the *last* content block of `messages[i]`. Honoured automatically.    |
| OpenAI       | `none`                  | Hint ignored. OpenAI's prompt cache is implicit and managed server-side; no client-side action.                                                 |
| Gemini       | `gemini-context`        | Take `max(breakpoints)` as prefix boundary. If `cacheId` set, attach as `cachedContent: cacheId`; else POST `:cachedContents` and emit `cache_hit{cacheId}`. |
| Bedrock      | `none` (v1)             | Hint ignored — cache_control markers stripped before signing. Revisit when AWS GA's.                                                            |
| Vertex       | `anthropic-explicit`    | Identical to Anthropic — same envelope all the way through the publisher.                                                                       |
| Local        | `none`                  | Hint ignored. Local servers don't expose cache APIs.                                                                                            |

## 13. Appendix B — Per-provider event-shape mapping

| Source event                                                  | → `ProviderEvent`                          |
| ------------------------------------------------------------- | ------------------------------------------ |
| Anthropic `content_block_delta {type:'text_delta', text}`     | `text_delta`                               |
| Anthropic `content_block_delta {type:'thinking_delta', text}` | `reasoning_delta`                          |
| Anthropic `content_block_start {type:'tool_use',id,name}`     | `tool_use_start`                           |
| Anthropic `content_block_delta {type:'input_json_delta'}`     | `tool_use_args_delta`                      |
| Anthropic `content_block_stop` (with buffered args)           | `tool_use_stop`                            |
| Anthropic `message_stop` + last `message_delta` usage         | `message_stop`                             |
| OpenAI `delta.content`                                        | `text_delta`                               |
| OpenAI `delta.reasoning` (o-series, gpt-5)                    | `reasoning_delta`                          |
| OpenAI `delta.tool_calls[i].function`                         | `tool_use_start` / `tool_use_args_delta`   |
| OpenAI `finish_reason` + `usage`                              | `tool_use_stop` × N + `message_stop`       |
| Gemini `candidates[0].content.parts[i].text`                  | `text_delta`                               |
| Gemini `candidates[0].content.parts[i].thoughtSummary`        | `reasoning_delta`                          |
| Gemini `candidates[0].content.parts[i].functionCall`          | `tool_use_start` + `tool_use_args_delta` (one shot) + `tool_use_stop` |
| Gemini `usageMetadata`                                        | `message_stop`                             |
| Gemini error response                                         | `error{code,message,retriable}`            |
| Gemini cache hit (after `cachedContents.create`)              | `cache_hit{cacheId,bytesReused}`           |
| Bedrock event-stream frame → inner Anthropic event            | (delegate to Anthropic translator)         |
| Bedrock `:exception` frame                                    | `error{code,message,retriable}`            |
| Vertex stream events                                          | (delegate to Anthropic translator)         |
| Local Ollama/llamacpp OpenAI-shape events                     | (delegate to OpenAI translator)            |
| Local stub-tools `<tool_call>` synthesized                    | `tool_use_start` + `tool_use_args_delta` + `tool_use_stop` |
| Local degraded-path entry                                     | `cache_hit{degraded:true}`                 |

## 14. Appendix C — File-by-file change summary

```
NEW:
  src/core/provider/registry.ts          ~180 LOC  — model registry + lookups
  src/core/provider/gemini.ts            ~280 LOC  — Gemini adapter
  src/core/provider/bedrock.ts           ~220 LOC  — Bedrock adapter
  src/core/provider/vertex.ts            ~180 LOC  — Vertex adapter
  src/core/provider/local.ts             ~260 LOC  — Local adapter + stub-tools
  src/core/provider/aws/sigv4.ts         ~200 LOC  — SigV4 signer
  src/core/provider/aws/eventstream.ts   ~80  LOC  — Bedrock frame parser
  src/core/provider/aws/jwt.ts           ~60  LOC  — Vertex service-acct JWT
  src/core/provider/cacheHint.ts         ~40  LOC  — defaultCacheHint helper

MODIFIED:
  src/core/provider/types.ts             +90  LOC  — extended interface
  src/core/provider/anthropic.ts         +40  LOC  — cache_control + auth shape
  src/core/provider/openai.ts            +20  LOC  — auth shape
  src/core/provider/resolver.ts          +60  LOC  — switch on (format, auth.kind), routeByModel
  src/core/provider/remoteModels.ts      +30  LOC  — gemini/local endpoint branches
  src/core/cost/pricing.ts               -40 +30 LOC — registry-driven; overlay
  src/core/onboarding/providerProbe.ts   +120 LOC  — 4 new probe variants
  src/core/onboarding/templates.ts       +60  LOC  — 4 new templates
  src/core/agent/forkedAgent.ts          +5   LOC  — cacheHint pass-through
  src/core/agent/loop.ts                 +30  LOC  — reasoning/error fold + cacheHint default
  src/core/agent/events.ts               +10  LOC  — reasoning_delta + error events
  src/core/message/types.ts              +5   LOC  — assistant.reasoning, errorReason
  src/core/session/types.ts              +15  LOC  — providerSwitches[], cacheKey
  src/slash/model.ts                     +30  LOC  — applyModelSelection
  src/slash/doctor.ts                    +0  LOC   — unchanged; underlying runDoctor extends
  src/core/config/schema.ts              +50  LOC  — extended ProviderConfigSchema, AuthConfigSchema
  src/core/config/load.ts                +30  LOC  — back-compat for string apiKey

NEW TESTS (totals):
  test/core/provider/                    ~14 new files, ~2200 LOC
  test/core/cost/pricing.registry.test.ts ~120 LOC
  test/core/onboarding/probes.test.ts    +200 LOC (extended)
  test/integration/provider-expansion.test.ts ~400 LOC
  test/fixtures/providers/                ~10 fixtures (sized to scenarios)

REMOVED:
  src/core/cost/pricing.ts:30-40 PRICING table — replaced by registry lookup
```

Total new code: ~1500 LOC core + ~2900 LOC test. Total modified: ~600 LOC.
