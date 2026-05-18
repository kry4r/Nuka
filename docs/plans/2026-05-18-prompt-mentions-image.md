# PromptMentions Image Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `@image` mention tokens through the provider message payload as real image content (base64 for Anthropic + OpenAI; URL passthrough where supported) instead of the current `[image: …] (resolution deferred)` placeholder.

**Architecture:** Extend `Message.ContentBlock` with a third variant `{ type: 'image'; mediaType: string; dataBase64?: string; url?: string }` so the existing `runAgent({ text, images? }) → makeUserMessage → provider.stream` path can carry image content end-to-end with no sidecar fields. `inlineReferencesIntoText` returns the new `images: ImageBlock[]` alongside the resolved text; the App forwards it through `runAgent`. Provider converters get an `image` branch in `blocksToAnthropic` (base64 source block) and in `toOpenAIMessages` (multipart `content` array with `image_url`). Size cap + missing-file rejection happen in `inlineReferencesIntoText` BEFORE attaching to the draft so the resolver dep stays generic.

**Tech Stack:** TypeScript (strict), Vitest

**Out-of-band decisions (load-bearing):**
- `Message.ContentBlock` is extended in-place (NOT a sidecar on `UserMessage`). All filter-by-type call sites (auto-compact, synth, agent summary, dispatch) are audited in Task 2.
- `clipboard_asset` + `local_path` → base64 with size cap. `remote_url` → OpenAI passes URL through verbatim; Anthropic falls back to text marker `[image: <url> (remote URL not supported by Anthropic)]`. `provider_file_id` → text marker on both providers (out of scope for this plan).
- Size cap default 5 MiB (5 * 1024 * 1024 bytes), configurable via `NUKA_PROMPT_IMAGE_MAX_BYTES`. Oversize → `errors` entry + skip image attachment (text marker emitted in its place).
- Reading + base64-encoding happens inside `inlineReferencesIntoText` (consumes `ResolvedImageArtifact` from `resolvePromptDraft`) — the existing `readLocalImage` dep already returns `{ mimeType, dataBase64 }`, but the new size check runs on the resolver output before the encoded data is forwarded.

---

## File Structure

```
src/
  core/
    message/
      types.ts                       MODIFY  add image variant to ContentBlock
      factories.ts                   MODIFY  makeUserMessage accepts images
      __tests__/
        factories.image.test.ts      CREATE  user-message factory carries image
    provider/
      anthropic.ts                   MODIFY  blocksToAnthropic image branch
      openai.ts                      MODIFY  toOpenAIMessages multipart branch
      __tests__/
        anthropic.image.test.ts      CREATE  anthropic payload shape
        openai.image.test.ts         CREATE  openai payload shape
    agent/
      loop.ts                        MODIFY  runAgent input shape + thread images
      __tests__/
        loop.image.test.ts           CREATE  runAgent forwards images
  promptContextReferences/
    inlineReferences.ts              MODIFY  emit imageArtifacts as ImageBlock[]
    imageBudget.ts                   CREATE  size cap helper
    __tests__/
      inlineReferences.image.test.ts CREATE  base64 + cap + remote_url
      imageBudget.test.ts            CREATE  budget parsing + clamping
  tui/
    App.tsx                          MODIFY  forward images through stream.send
```

---

## Task 1 — Extend `Message.ContentBlock` with image variant

**Files:**
- Create: `src/core/message/__tests__/factories.image.test.ts`
- Modify: `src/core/message/types.ts`, `src/core/message/factories.ts`

- [ ] **Step 1.1** — Write failing test

```ts
// src/core/message/__tests__/factories.image.test.ts
import { describe, expect, it } from 'vitest'
import { makeUserMessage } from '../factories'

describe('makeUserMessage', () => {
  it('returns a text-only block when no images are provided', () => {
    const m = makeUserMessage({ text: 'hello' })
    expect(m.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('appends image blocks after the text block', () => {
    const m = makeUserMessage({
      text: 'look at this',
      images: [
        { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
        { type: 'image', mediaType: 'image/jpeg', url: 'https://example.test/x.jpg' },
      ],
    })
    expect(m.content).toEqual([
      { type: 'text', text: 'look at this' },
      { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
      { type: 'image', mediaType: 'image/jpeg', url: 'https://example.test/x.jpg' },
    ])
  })

  it('omits the text block when text is empty but images are present', () => {
    const m = makeUserMessage({
      text: '',
      images: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' }],
    })
    expect(m.content).toEqual([
      { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
    ])
  })
})
```

- [ ] **Step 1.2** — Run failing

```bash
npx vitest run src/core/message/__tests__/factories.image.test.ts
```

- [ ] **Step 1.3** — Implement

Update `src/core/message/types.ts` `ContentBlock` union:

```ts
export type ImageContentBlock = {
  type: 'image'
  mediaType: string
  /** base64-encoded image bytes; mutually exclusive with `url` in practice. */
  dataBase64?: string
  /** Remote URL passthrough. OpenAI consumes natively; Anthropic falls back to text. */
  url?: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | ImageContentBlock
```

Update `src/core/message/factories.ts` `makeUserMessage`:

```ts
import { ulid } from 'ulid'
import type {
  UserMessage,
  AssistantMessage,
  ToolMessage,
  SystemMessage,
  ToolContentBlock,
  ImageContentBlock,
  ContentBlock,
} from './types'

export function makeUserMessage(input: {
  text: string
  images?: readonly ImageContentBlock[]
}): UserMessage {
  const blocks: ContentBlock[] = []
  if (input.text.length > 0) {
    blocks.push({ type: 'text', text: input.text })
  }
  if (input.images && input.images.length > 0) {
    for (const img of input.images) {
      blocks.push({ ...img })
    }
  }
  return {
    role: 'user',
    content: blocks,
    id: ulid(),
    ts: Date.now(),
  }
}
```

- [ ] **Step 1.4** — Run passing

```bash
npx vitest run src/core/message/__tests__/factories.image.test.ts
npx tsc --noEmit
```

- [ ] **Step 1.5** — Commit

```bash
git add src/core/message/types.ts src/core/message/factories.ts \
        src/core/message/__tests__/factories.image.test.ts
git commit -m "feat(message): add image ContentBlock variant + makeUserMessage images param"
```

---

## Task 2 — Audit existing `content` filters for the new variant

**Files:**
- Modify: any `content.filter(b => b.type === 'text')` site that must skip image blocks gracefully

- [ ] **Step 2.1** — Find call sites

```bash
grep -RnE "type === 'text'|type === 'tool_use'" src/core | head -40
```

Expected hits (from current audit): `core/provider/openai.ts:157`, `core/provider/openai.ts:163-172`, `core/agent/autoCompact.ts` (filter text content for token estimation), `core/agent/agentSummary.ts`, `core/memdir/synth.ts`. For each, the rule is: if the site computes a text summary, ignore image blocks; if the site serialises content for transport, route through the provider converters in Task 3/4.

- [ ] **Step 2.2** — Add regression test for autoCompact text extraction

```ts
// src/core/agent/__tests__/autoCompact.image.test.ts
import { describe, expect, it } from 'vitest'
import type { Message } from '../../message/types'
import { extractTextForCompaction } from '../autoCompact'

describe('extractTextForCompaction', () => {
  it('ignores image content blocks', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
        ],
      },
    ]
    expect(extractTextForCompaction(messages)).toContain('hello')
    expect(extractTextForCompaction(messages)).not.toContain('AAA=')
  })
})
```

- [ ] **Step 2.3** — Implement / re-export helper

If `extractTextForCompaction` does not exist, add it as a small named export in `src/core/agent/autoCompact.ts`:

```ts
import type { Message } from '../message/types'

export function extractTextForCompaction(messages: readonly Message[]): string {
  const parts: string[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      parts.push(m.content)
      continue
    }
    for (const b of m.content) {
      if (b.type === 'text') parts.push(b.text)
    }
  }
  return parts.join('\n')
}
```

If `autoCompact.ts` already has a private helper doing this, surface it and update existing call sites to use the named export.

- [ ] **Step 2.4** — Run passing

```bash
npx vitest run src/core/agent/__tests__/autoCompact.image.test.ts
npx tsc --noEmit
```

- [ ] **Step 2.5** — Commit

```bash
git add src/core/agent/autoCompact.ts \
        src/core/agent/__tests__/autoCompact.image.test.ts
git commit -m "test(autoCompact): pin text-only extraction across image ContentBlocks"
```

---

## Task 3 — Anthropic provider: emit `image` content blocks

**Files:**
- Modify: `src/core/provider/anthropic.ts`
- Create: `src/core/provider/__tests__/anthropic.image.test.ts`

- [ ] **Step 3.1** — Write failing test

```ts
// src/core/provider/__tests__/anthropic.image.test.ts
import { describe, expect, it } from 'vitest'
import { __test_toAnthropicMessages } from '../anthropic'
import type { Message } from '../../message/types'

describe('toAnthropicMessages — image blocks', () => {
  it('emits base64 source for image with dataBase64', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
        ],
      },
    ]
    const out = __test_toAnthropicMessages(messages) as Array<{
      role: string
      content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>
    }>
    expect(out).toHaveLength(1)
    expect(out[0]?.role).toBe('user')
    expect(out[0]?.content).toEqual([
      { type: 'text', text: 'see this' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAA=' },
      },
    ])
  })

  it('falls back to a text marker for url-only image (Anthropic does not accept remote URLs)', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'image', mediaType: 'image/jpeg', url: 'https://example.test/x.jpg' },
        ],
      },
    ]
    const out = __test_toAnthropicMessages(messages) as Array<{
      content: Array<{ type: string; text?: string }>
    }>
    expect(out[0]?.content).toEqual([
      { type: 'text', text: '[image: https://example.test/x.jpg (remote URL not supported by Anthropic)]' },
    ])
  })
})
```

- [ ] **Step 3.2** — Run failing

```bash
npx vitest run src/core/provider/__tests__/anthropic.image.test.ts
```

- [ ] **Step 3.3** — Implement

In `src/core/provider/anthropic.ts`, extend `blocksToAnthropic`:

```ts
function blocksToAnthropic(blocks: ContentBlock[]): unknown[] {
  return blocks.map((b): unknown => {
    if (b.type === 'text') return { type: 'text', text: b.text }
    if (b.type === 'tool_use') {
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
    }
    if (b.type === 'image') {
      if (b.dataBase64) {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: b.mediaType,
            data: b.dataBase64,
          },
        }
      }
      if (b.url) {
        return {
          type: 'text',
          text: `[image: ${b.url} (remote URL not supported by Anthropic)]`,
        }
      }
      return { type: 'text', text: '[image: (no data)]' }
    }
    return b
  })
}

/** Test-only re-export. Not part of the public provider API. */
export const __test_toAnthropicMessages = toAnthropicMessages
```

Update the parameter type of `blocksToAnthropic` from `any[]` to `ContentBlock[]` and import `ContentBlock` from `'../message/types'`. Remove the existing `any` casts in `toAnthropicMessages` that funneled blocks through.

- [ ] **Step 3.4** — Run passing

```bash
npx vitest run src/core/provider/__tests__/anthropic.image.test.ts
npx tsc --noEmit
```

- [ ] **Step 3.5** — Commit

```bash
git add src/core/provider/anthropic.ts \
        src/core/provider/__tests__/anthropic.image.test.ts
git commit -m "feat(provider/anthropic): emit base64 image blocks from ContentBlock.image"
```

---

## Task 4 — OpenAI provider: emit multipart `content` array with `image_url`

**Files:**
- Modify: `src/core/provider/openai.ts`
- Create: `src/core/provider/__tests__/openai.image.test.ts`

- [ ] **Step 4.1** — Write failing test

```ts
// src/core/provider/__tests__/openai.image.test.ts
import { describe, expect, it } from 'vitest'
import { __test_toOpenAIMessages } from '../openai'
import type { Message } from '../../message/types'

describe('toOpenAIMessages — image blocks', () => {
  it('emits multipart content with image_url base64 data URI', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
        ],
      },
    ]
    const out = __test_toOpenAIMessages('sys', messages) as Array<{
      role: string
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
    }>
    const user = out.find(m => m.role === 'user')
    expect(user).toBeDefined()
    expect(user?.content).toEqual([
      { type: 'text', text: 'see this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA=' } },
    ])
  })

  it('passes a remote url through verbatim', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'image', mediaType: 'image/jpeg', url: 'https://example.test/x.jpg' },
        ],
      },
    ]
    const out = __test_toOpenAIMessages('sys', messages) as Array<{
      role: string
      content: Array<{ type: string; image_url?: { url: string } }>
    }>
    const user = out.find(m => m.role === 'user')
    expect(user?.content).toEqual([
      { type: 'image_url', image_url: { url: 'https://example.test/x.jpg' } },
    ])
  })

  it('keeps the legacy plain-string content shape when no images are present', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [{ type: 'text', text: 'hello' }],
      },
    ]
    const out = __test_toOpenAIMessages('sys', messages) as Array<{ role: string; content: string }>
    expect(out.find(m => m.role === 'user')?.content).toBe('hello')
  })
})
```

- [ ] **Step 4.2** — Run failing

```bash
npx vitest run src/core/provider/__tests__/openai.image.test.ts
```

- [ ] **Step 4.3** — Implement

In `src/core/provider/openai.ts`, rewrite the user-branch of `toOpenAIMessages`:

```ts
import type { Message, ContentBlock, ImageContentBlock } from '../message/types'

type OpenAIPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

function imageBlockToOpenAIPart(b: ImageContentBlock): OpenAIPart {
  if (b.dataBase64) {
    return {
      type: 'image_url',
      image_url: { url: `data:${b.mediaType};base64,${b.dataBase64}` },
    }
  }
  if (b.url) {
    return { type: 'image_url', image_url: { url: b.url } }
  }
  return { type: 'text', text: '[image: (no data)]' }
}

function userContentForOpenAI(blocks: ContentBlock[]): string | OpenAIPart[] {
  const hasImage = blocks.some(b => b.type === 'image')
  if (!hasImage) {
    return blocks
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map(b => b.text)
      .join('')
  }
  const parts: OpenAIPart[] = []
  for (const b of blocks) {
    if (b.type === 'text') parts.push({ type: 'text', text: b.text })
    else if (b.type === 'image') parts.push(imageBlockToOpenAIPart(b))
  }
  return parts
}

function toOpenAIMessages(system: string, messages: Message[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      out.push({ role: 'user', content: userContentForOpenAI(m.content) })
    } else if (m.role === 'assistant') {
      const text = m.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map(b => b.text)
        .join('')
      const toolCalls = m.content
        .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
        .map(b => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }))
      out.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      })
    } else if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolUseId,
        content: typeof m.content === 'string'
          ? m.content
          : toolContentBlocksToOpenAI(m.content),
      })
    }
  }
  return out
}

/** Test-only re-export. */
export const __test_toOpenAIMessages = toOpenAIMessages
```

- [ ] **Step 4.4** — Run passing

```bash
npx vitest run src/core/provider/__tests__/openai.image.test.ts
npx tsc --noEmit
```

- [ ] **Step 4.5** — Commit

```bash
git add src/core/provider/openai.ts \
        src/core/provider/__tests__/openai.image.test.ts
git commit -m "feat(provider/openai): emit multipart content with image_url for image blocks"
```

---

## Task 5 — Image budget helper (size cap + env override)

**Files:**
- Create: `src/promptContextReferences/imageBudget.ts`
- Create: `src/promptContextReferences/__tests__/imageBudget.test.ts`

- [ ] **Step 5.1** — Write failing test

```ts
// src/promptContextReferences/__tests__/imageBudget.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getImageMaxBytes, base64Bytes } from '../imageBudget'

describe('getImageMaxBytes', () => {
  const orig = process.env['NUKA_PROMPT_IMAGE_MAX_BYTES']
  beforeEach(() => { delete process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] })
  afterEach(() => {
    if (orig === undefined) delete process.env['NUKA_PROMPT_IMAGE_MAX_BYTES']
    else process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = orig
  })

  it('defaults to 5 MiB when env is unset', () => {
    expect(getImageMaxBytes()).toBe(5 * 1024 * 1024)
  })

  it('honors a positive integer override', () => {
    process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = '1024'
    expect(getImageMaxBytes()).toBe(1024)
  })

  it('falls back to default on non-numeric env value', () => {
    process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = 'abc'
    expect(getImageMaxBytes()).toBe(5 * 1024 * 1024)
  })

  it('falls back to default on zero or negative', () => {
    process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = '0'
    expect(getImageMaxBytes()).toBe(5 * 1024 * 1024)
    process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = '-1'
    expect(getImageMaxBytes()).toBe(5 * 1024 * 1024)
  })
})

describe('base64Bytes', () => {
  it('computes decoded byte length without decoding', () => {
    // 4 base64 chars → 3 bytes; each `=` reduces by 1
    expect(base64Bytes('AAAA')).toBe(3)
    expect(base64Bytes('AAA=')).toBe(2)
    expect(base64Bytes('AA==')).toBe(1)
    expect(base64Bytes('')).toBe(0)
  })
})
```

- [ ] **Step 5.2** — Run failing

```bash
npx vitest run src/promptContextReferences/__tests__/imageBudget.test.ts
```

- [ ] **Step 5.3** — Implement

```ts
// src/promptContextReferences/imageBudget.ts
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

/** Resolve the per-image byte cap, with `NUKA_PROMPT_IMAGE_MAX_BYTES` opt-in. */
export function getImageMaxBytes(): number {
  const raw = process.env['NUKA_PROMPT_IMAGE_MAX_BYTES']
  if (raw === undefined) return DEFAULT_MAX_BYTES
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_BYTES
  return parsed
}

/**
 * Compute the decoded byte length of a base64 string without actually
 * decoding it. The standard formula: `floor(len * 3 / 4) - paddingCount`.
 */
export function base64Bytes(b64: string): number {
  if (b64.length === 0) return 0
  let padding = 0
  if (b64.endsWith('==')) padding = 2
  else if (b64.endsWith('=')) padding = 1
  return Math.floor((b64.length * 3) / 4) - padding
}
```

- [ ] **Step 5.4** — Run passing

```bash
npx vitest run src/promptContextReferences/__tests__/imageBudget.test.ts
npx tsc --noEmit
```

- [ ] **Step 5.5** — Commit

```bash
git add src/promptContextReferences/imageBudget.ts \
        src/promptContextReferences/__tests__/imageBudget.test.ts
git commit -m "feat(prompt-mentions): add image budget helper with env opt-in cap"
```

---

## Task 6 — `inlineReferencesIntoText` returns `images: ImageContentBlock[]`

**Files:**
- Modify: `src/promptContextReferences/inlineReferences.ts`
- Create: `src/promptContextReferences/__tests__/inlineReferences.image.test.ts`

- [ ] **Step 6.1** — Write failing test

```ts
// src/promptContextReferences/__tests__/inlineReferences.image.test.ts
import { describe, expect, it } from 'vitest'
import { inlineReferencesIntoText } from '../inlineReferences'
import type { PromptReferenceToken } from '../types'
import type { PromptResolverDeps } from '../resolver'

function noopDeps(over: Partial<PromptResolverDeps> = {}): PromptResolverDeps {
  return {
    readTextFile: async () => '',
    readDirectory: async () => [],
    getDiff: async () => '',
    getStagedDiff: async () => '',
    runGit: async () => ({ stdout: '', stderr: '', code: 0 }),
    fetchUrlText: async (url) => ({ url, content: '' }),
    readLocalImage: async () => ({ mimeType: 'image/png', dataBase64: '' }),
    ...over,
  }
}

const localImageToken = (path: string): PromptReferenceToken => ({
  id: 'img-1',
  kind: 'image',
  display: path,
  target: { kind: 'image', sourceKind: 'local_path', path, mimeType: 'image/png' },
  resolvePolicy: 'snapshot',
  status: 'valid',
  metadata: {},
})

describe('inlineReferencesIntoText — images', () => {
  it('attaches base64 image as a structured ImageContentBlock and DOES NOT inline placeholder text', async () => {
    const result = await inlineReferencesIntoText({
      raw: 'check this out',
      tokens: [localImageToken('/tmp/a.png')],
      deps: noopDeps({
        readLocalImage: async () => ({ mimeType: 'image/png', dataBase64: 'AAA=' }),
      }),
    })
    expect(result.text).toBe('check this out')
    expect(result.images).toEqual([
      { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
    ])
    expect(result.artifacts.errors).toEqual([])
  })

  it('records an error and emits a text marker when the file is missing', async () => {
    const result = await inlineReferencesIntoText({
      raw: 'check this',
      tokens: [localImageToken('/does/not/exist.png')],
      deps: noopDeps({
        readLocalImage: async () => { throw new Error('ENOENT: no such file') },
      }),
    })
    expect(result.images).toEqual([])
    expect(result.text).toContain('[reference error: ENOENT: no such file]')
    expect(result.artifacts.errors).toHaveLength(1)
  })

  it('rejects images larger than the cap', async () => {
    process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = '4'
    try {
      // 'AAAAAAAA' is 8 base64 chars → 6 decoded bytes, over the 4-byte cap
      const result = await inlineReferencesIntoText({
        raw: 'check',
        tokens: [localImageToken('/tmp/big.png')],
        deps: noopDeps({
          readLocalImage: async () => ({ mimeType: 'image/png', dataBase64: 'AAAAAAAA' }),
        }),
      })
      expect(result.images).toEqual([])
      expect(result.text).toContain('[image rejected: /tmp/big.png exceeds 4 bytes')
      expect(result.artifacts.errors[0]?.message).toContain('exceeds')
    } finally {
      delete process.env['NUKA_PROMPT_IMAGE_MAX_BYTES']
    }
  })

  it('passes through a remote_url image without reading bytes', async () => {
    const token: PromptReferenceToken = {
      id: 'img-r',
      kind: 'image',
      display: 'https://example.test/x.jpg',
      target: { kind: 'image', sourceKind: 'remote_url', url: 'https://example.test/x.jpg', mimeType: 'image/jpeg' },
      resolvePolicy: 'snapshot',
      status: 'valid',
      metadata: {},
    }
    const result = await inlineReferencesIntoText({
      raw: 'r',
      tokens: [token],
      deps: noopDeps(),
    })
    expect(result.images).toEqual([
      { type: 'image', mediaType: 'image/jpeg', url: 'https://example.test/x.jpg' },
    ])
  })
})
```

- [ ] **Step 6.2** — Run failing

```bash
npx vitest run src/promptContextReferences/__tests__/inlineReferences.image.test.ts
```

- [ ] **Step 6.3** — Implement

Rewrite `src/promptContextReferences/inlineReferences.ts`:

```ts
import { resolvePromptDraft, type PromptResolverDeps } from './resolver'
import { base64Bytes, getImageMaxBytes } from './imageBudget'
import type {
  PromptDraft,
  PromptDraftElement,
  PromptReferenceToken,
  ResolvedImageArtifact,
  ResolvedPromptArtifacts,
} from './types'
import type { ImageContentBlock } from '../core/message/types'

export type InlineReferencesInput = {
  raw: string
  tokens: readonly PromptReferenceToken[]
  deps: PromptResolverDeps
}

export type InlineReferencesResult = {
  /** Resolved artifact blocks + the user's raw prompt. */
  text: string
  /** Structured image attachments to forward to the provider message. */
  images: ImageContentBlock[]
  /** Pass-through warnings / errors so callers may surface them later. */
  artifacts: ResolvedPromptArtifacts
}

function buildSyntheticDraft(tokens: readonly PromptReferenceToken[]): PromptDraft {
  const tokensById: Record<string, PromptReferenceToken> = {}
  const elements: PromptDraftElement[] = []
  for (const token of tokens) {
    if (tokensById[token.id]) continue
    tokensById[token.id] = token
    elements.push({
      id: token.id,
      kind: token.kind === 'image' ? 'image' : 'mention',
      tokenId: token.id,
      byteRange: { start: 0, end: 0 },
      placeholderLabel: '',
    })
  }
  return { text: '', elements, tokensById, assetsById: {}, cursor: { offset: 0 } }
}

function blockForTextArtifact(label: string, content: string): string {
  return `[${label}]\n${content}`
}

function imageDisplayPath(ia: ResolvedImageArtifact): string {
  return ia.localPath ?? ia.remoteUrl ?? ia.providerFileId ?? 'attached'
}

/**
 * Convert a resolved image artifact to an ImageContentBlock, applying the
 * byte-size cap. Returns `null` and pushes an error entry when the artifact
 * cannot be attached.
 */
function imageArtifactToBlock(
  ia: ResolvedImageArtifact,
  maxBytes: number,
  errors: ResolvedPromptArtifacts['errors'],
  textMarkers: string[],
): ImageContentBlock | null {
  if (ia.sourceKind === 'local_path' || ia.sourceKind === 'clipboard_asset') {
    if (!ia.dataBase64 || !ia.mimeType) {
      errors.push({ tokenId: ia.originTokenId, message: `image missing data for ${imageDisplayPath(ia)}` })
      textMarkers.push(`[image: ${imageDisplayPath(ia)} (no data)]`)
      return null
    }
    const decodedBytes = base64Bytes(ia.dataBase64)
    if (decodedBytes > maxBytes) {
      const msg = `${imageDisplayPath(ia)} exceeds ${maxBytes} bytes (image ${decodedBytes} bytes)`
      errors.push({ tokenId: ia.originTokenId, message: `image rejected: ${msg}` })
      textMarkers.push(`[image rejected: ${msg}]`)
      return null
    }
    return { type: 'image', mediaType: ia.mimeType, dataBase64: ia.dataBase64 }
  }
  if (ia.sourceKind === 'remote_url') {
    if (!ia.remoteUrl || !ia.mimeType) {
      textMarkers.push(`[image: ${imageDisplayPath(ia)} (incomplete remote_url)]`)
      return null
    }
    return { type: 'image', mediaType: ia.mimeType, url: ia.remoteUrl }
  }
  // provider_file_id is out of scope: keep a text marker so the model sees the intent.
  textMarkers.push(`[image: ${imageDisplayPath(ia)} (provider_file_id transport not wired)]`)
  return null
}

export async function inlineReferencesIntoText(
  input: InlineReferencesInput,
): Promise<InlineReferencesResult> {
  if (input.tokens.length === 0) {
    return {
      text: input.raw,
      images: [],
      artifacts: {
        promptText: input.raw,
        textArtifacts: [],
        imageArtifacts: [],
        warnings: [],
        errors: [],
      },
    }
  }

  const draft = buildSyntheticDraft(input.tokens)
  const artifacts = await resolvePromptDraft(draft, input.deps)
  const maxBytes = getImageMaxBytes()

  const blocks: string[] = []
  for (const ta of artifacts.textArtifacts) {
    blocks.push(blockForTextArtifact(ta.label, ta.content))
  }

  const images: ImageContentBlock[] = []
  const textMarkers: string[] = []
  for (const ia of artifacts.imageArtifacts) {
    const blk = imageArtifactToBlock(ia, maxBytes, artifacts.errors, textMarkers)
    if (blk) images.push(blk)
  }
  blocks.push(...textMarkers)

  for (const err of artifacts.errors) {
    // Surface errors emitted by the resolver itself (e.g. missing file) as
    // visible markers, in addition to size-rejection markers above.
    if (!textMarkers.some(m => m.includes(err.message))) {
      blocks.push(`[reference error: ${err.message}]`)
    }
  }

  const finalText =
    blocks.length === 0 ? input.raw : `${blocks.join('\n\n')}\n\n${input.raw}`

  return { text: finalText, images, artifacts }
}
```

- [ ] **Step 6.4** — Run passing

```bash
npx vitest run src/promptContextReferences/__tests__/inlineReferences.image.test.ts
npx tsc --noEmit
```

- [ ] **Step 6.5** — Commit

```bash
git add src/promptContextReferences/inlineReferences.ts \
        src/promptContextReferences/__tests__/inlineReferences.image.test.ts
git commit -m "feat(prompt-mentions): return ImageContentBlock[] alongside resolved text"
```

---

## Task 7 — `runAgent` accepts `images?: ImageContentBlock[]`

**Files:**
- Modify: `src/core/agent/loop.ts`
- Create: `src/core/agent/__tests__/loop.image.test.ts`

- [ ] **Step 7.1** — Write failing test (inline fakes, no shared harness)

The `RunAgentDeps` shape has ~20 fields, most optional. The test only needs `provider`, `tools`, and `permission`; everything else stays undefined. The provider is a one-shot stream that emits `message_stop` immediately so the loop body exits after the first iteration.

```ts
// src/core/agent/__tests__/loop.image.test.ts
import { describe, expect, it } from 'vitest'
import { runAgent, type RunAgentDeps } from '../loop'
import type { Session } from '../../session/types'
import type {
  LLMProvider,
  LLMRequest,
  ProviderEvent,
} from '../../provider/types'
import type { ProviderResolver } from '../../provider/resolver'

function makeFakeSession(): Session {
  return {
    id: 'test-session',
    messages: [],
    queue: [],
    mode: 'normal',
    unDeferredToolNames: new Set<string>(),
  } as unknown as Session
}

function makeOneShotProvider(): LLMProvider {
  return {
    id: 'fake',
    format: 'anthropic',
    async *stream(_req: LLMRequest, _signal: AbortSignal): AsyncIterable<ProviderEvent> {
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },
    async listRemoteModels() { return [] },
  }
}

function makeFakeDeps(): RunAgentDeps {
  const provider = makeOneShotProvider()
  const resolver: ProviderResolver = {
    resolveFor: () => ({ provider, model: 'fake-model' }),
  } as unknown as ProviderResolver
  return {
    provider: resolver,
    tools: { list: () => [], get: () => undefined } as unknown as RunAgentDeps['tools'],
    permission: { check: async () => ({ outcome: 'allow' }) } as unknown as RunAgentDeps['permission'],
  }
}

describe('runAgent — image input', () => {
  it('appends a user message whose content carries the image block', async () => {
    const session = makeFakeSession()
    const deps = makeFakeDeps()
    const ctrl = new AbortController()
    const iter = runAgent(
      {
        text: 'look',
        images: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' }],
      },
      session,
      deps,
      ctrl.signal,
    )
    // Drain until message_stop yields and the loop exits.
    for await (const _ev of iter) { /* consume */ }
    const userMsg = session.messages.find(m => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg?.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
    ])
  })
})
```

If the actual `Session` / `ProviderResolver` / `ToolRegistry` / `PermissionChecker` shapes have stricter required fields than the casts above paper over, expand the fake constructors until `tsc --noEmit` passes — do NOT add `any`; use `as unknown as <T>` cast at the boundary only.

- [ ] **Step 7.2** — Run failing

```bash
npx vitest run src/core/agent/__tests__/loop.image.test.ts
```

- [ ] **Step 7.3** — Implement

In `src/core/agent/loop.ts`, change the `runAgent` signature:

```ts
import type { ImageContentBlock } from '../message/types'

export type RunAgentInput = {
  text: string
  images?: readonly ImageContentBlock[]
}

export async function* runAgent(
  input: RunAgentInput,
  session: Session,
  deps: RunAgentDeps,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  // ... existing skill/hook/cron logic unchanged, using input.text ...
  appendMessage(session, makeUserMessage({ text: input.text, images: input.images }), deps.persist)
  // ... rest unchanged ...
}
```

Search the file for the existing `appendMessage(session, makeUserMessage(input), deps.persist)` call at line ~354 and replace with the explicit `{ text, images }` destructuring. Confirm the cron-injected synthetic message and the queued-prompts message keep their old `{ text: ... }` shape (cron has no images; queued prompts at line ~843 stay text-only).

- [ ] **Step 7.4** — Run passing

```bash
npx vitest run src/core/agent/__tests__/loop.image.test.ts
npx tsc --noEmit
```

- [ ] **Step 7.5** — Commit

```bash
git add src/core/agent/loop.ts \
        src/core/agent/__tests__/loop.image.test.ts
git commit -m "feat(agent/loop): runAgent forwards prompt images to user message"
```

---

## Task 8 — TUI App forwards `images` through `stream.send`

**Files:**
- Modify: `src/tui/App.tsx`
- Modify: `src/tui/hooks/useAgentStream.ts` (signature change)

- [ ] **Step 8.1** — Read current shape

```bash
grep -RnE "stream\.send|useAgentStream" src/tui | head -20
```

`stream.send(text)` currently takes a single string. Change to `stream.send(text, opts?: { images?: ImageContentBlock[] })`.

- [ ] **Step 8.2** — Write failing test

```ts
// src/tui/hooks/__tests__/useAgentStream.image.test.ts
import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentStream } from '../useAgentStream'
// ... harness wiring to inject a fake runAgent that captures the call args ...

describe('useAgentStream.send', () => {
  it('forwards images through to runAgent', async () => {
    const seen: Array<{ text: string; images?: readonly unknown[] }> = []
    const fakeRunAgent = async function* (input: { text: string; images?: readonly unknown[] }) {
      seen.push({ text: input.text, images: input.images })
      yield { type: 'noop' }
    }
    const { result } = renderHook(() =>
      useAgentStream({ runAgent: fakeRunAgent } as never),
    )
    await act(async () => {
      await result.current.send('look', { images: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' }] })
    })
    expect(seen[0]).toEqual({
      text: 'look',
      images: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' }],
    })
  })
})
```

If the existing `useAgentStream` tests already cover string-only `.send(text)`, keep them passing; the new method should default `opts` to `{}`.

- [ ] **Step 8.3** — Run failing

```bash
npx vitest run src/tui/hooks/__tests__/useAgentStream.image.test.ts
```

- [ ] **Step 8.4** — Implement

In `src/tui/hooks/useAgentStream.ts`, change the `send` signature:

```ts
import type { ImageContentBlock } from '../../core/message/types'

type SendOpts = { images?: readonly ImageContentBlock[] }

// inside the hook body:
const send = useCallback(async (text: string, opts: SendOpts = {}): Promise<void> => {
  // existing logic, but pass through the images:
  const iter = deps.runAgent({ text, images: opts.images }, session, runAgentDeps, signal)
  // ... rest unchanged ...
}, [/* deps */])
```

In `src/tui/App.tsx`, locate the existing block (around line 517–529):

```tsx
const result = await inlineReferencesIntoText({
  raw: text,
  tokens: referenceTokens,
  deps,
})
text = result.text
```

Add a `pendingImages` capture and forward through `stream.send`:

```tsx
let pendingImages: ImageContentBlock[] = []
// ...
if (referenceTokens.length > 0) {
  const { inlineReferencesIntoText } = await import('../promptContextReferences/inlineReferences')
  const deps =
    props.resolverDeps ??
    (await import('../promptContextReferences/deps')).buildDefaultResolverDeps()
  const result = await inlineReferencesIntoText({
    raw: text,
    tokens: referenceTokens,
    deps,
  })
  text = result.text
  pendingImages = result.images
}

if (stream.running) {
  session.queue.push(text) // text-only for the queued path
  return
}
await stream.send(text, pendingImages.length > 0 ? { images: pendingImages } : undefined)
```

Add the matching import at the top of `App.tsx`:

```tsx
import type { ImageContentBlock } from '../core/message/types'
```

- [ ] **Step 8.5** — Run passing

```bash
npx vitest run src/tui/hooks/__tests__/useAgentStream.image.test.ts
npx tsc --noEmit
```

- [ ] **Step 8.6** — Commit

```bash
git add src/tui/hooks/useAgentStream.ts src/tui/App.tsx \
        src/tui/hooks/__tests__/useAgentStream.image.test.ts
git commit -m "feat(tui): forward prompt-mention images through stream.send to runAgent"
```

---

## Task 9 — End-to-end smoke test

**Files:**
- Create: `src/promptContextReferences/__tests__/e2e.image.test.ts`

- [ ] **Step 9.1** — Write the test

```ts
// src/promptContextReferences/__tests__/e2e.image.test.ts
import { describe, expect, it } from 'vitest'
import { inlineReferencesIntoText } from '../inlineReferences'
import { makeUserMessage } from '../../core/message/factories'
import { __test_toAnthropicMessages } from '../../core/provider/anthropic'
import { __test_toOpenAIMessages } from '../../core/provider/openai'
import type { PromptReferenceToken } from '../types'
import type { PromptResolverDeps } from '../resolver'

const deps: PromptResolverDeps = {
  readTextFile: async () => '',
  readDirectory: async () => [],
  getDiff: async () => '',
  getStagedDiff: async () => '',
  runGit: async () => ({ stdout: '', stderr: '', code: 0 }),
  fetchUrlText: async (url) => ({ url, content: '' }),
  readLocalImage: async () => ({ mimeType: 'image/png', dataBase64: 'AAA=' }),
}

const token: PromptReferenceToken = {
  id: 'img-1',
  kind: 'image',
  display: '/tmp/a.png',
  target: { kind: 'image', sourceKind: 'local_path', path: '/tmp/a.png', mimeType: 'image/png' },
  resolvePolicy: 'snapshot',
  status: 'valid',
  metadata: {},
}

describe('e2e — mention image flows into provider payloads', () => {
  it('produces matching base64 in both Anthropic and OpenAI shapes', async () => {
    const { text, images } = await inlineReferencesIntoText({
      raw: 'compare',
      tokens: [token],
      deps,
    })
    const msg = makeUserMessage({ text, images })
    const ant = __test_toAnthropicMessages([msg]) as Array<{ content: Array<unknown> }>
    const oai = __test_toOpenAIMessages('sys', [msg]) as Array<{ role: string; content: unknown }>
    expect(ant[0]?.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA=' },
    })
    const oaiUser = oai.find(m => m.role === 'user') as { content: Array<unknown> }
    expect(oaiUser.content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAA=' },
    })
  })
})
```

- [ ] **Step 9.2** — Run passing

```bash
npx vitest run src/promptContextReferences/__tests__/e2e.image.test.ts
npx tsc --noEmit
```

- [ ] **Step 9.3** — Commit

```bash
git add src/promptContextReferences/__tests__/e2e.image.test.ts
git commit -m "test(prompt-mentions): e2e image-mention to provider payload smoke"
```

---

## Self-Review Checklist

- [ ] No `any` in any modified file (verify with `grep -Rn ': any' src/promptContextReferences src/core/message src/core/provider`)
- [ ] No `@ts-ignore` introduced
- [ ] No new npm deps (`git diff package.json` shows no change)
- [ ] All new code uses Vitest (`describe/it/expect` from `'vitest'`)
- [ ] `npx tsc --noEmit` passes at every commit
- [ ] All commit messages omit `Co-Authored-By:` lines (Nuka convention)
- [ ] Additive: legacy `[image: …] (resolution deferred)` text path remains only for `provider_file_id` source (where transport is intentionally not wired) and for size-rejected/missing images, both of which are covered by tests
- [ ] Env opt-in: `NUKA_PROMPT_IMAGE_MAX_BYTES` defaults to 5 MiB; unset → no behavior change vs. spec default
- [ ] No MCP imports introduced
- [ ] Type names consistent across modules: `ImageContentBlock` is the single source of truth in `src/core/message/types.ts`; `ResolvedImageArtifact` (existing) is unchanged
- [ ] Provider unit tests cover BOTH `dataBase64` and `url` branches for each provider
- [ ] Tests cover: anthropic shape, openai shape, missing file (error path), oversized file rejection
