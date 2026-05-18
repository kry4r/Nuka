// test/promptContextReferences/e2e.image.test.ts
//
// End-to-end pin: a single @image mention should flow through
// `inlineReferencesIntoText` → `makeUserMessage` → both the Anthropic
// and OpenAI message converters with matching base64 payloads. Catches
// any regression that would re-introduce a [image: …] (resolution
// deferred) text marker on a path that used to carry real bytes.

import { describe, expect, it } from 'vitest'
import { inlineReferencesIntoText } from '../../src/promptContextReferences/inlineReferences'
import { makeUserMessage } from '../../src/core/message/factories'
import { __test_toAnthropicMessages } from '../../src/core/provider/anthropic'
import { __test_toOpenAIMessages } from '../../src/core/provider/openai'
import type { PromptReferenceToken } from '../../src/promptContextReferences/types'
import type { PromptResolverDeps } from '../../src/promptContextReferences/resolver'

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

    const ant = __test_toAnthropicMessages([msg]) as Array<{ content: unknown[] }>
    expect(ant[0]?.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA=' },
    })

    const oai = __test_toOpenAIMessages('sys', [msg]) as Array<{
      role: string
      content: unknown
    }>
    const oaiUser = oai.find(m => m.role === 'user')
    expect(oaiUser).toBeDefined()
    expect(oaiUser?.content).toEqual(expect.arrayContaining([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA=' } },
    ]))
  })
})
