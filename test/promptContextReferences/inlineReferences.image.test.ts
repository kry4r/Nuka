// test/promptContextReferences/inlineReferences.image.test.ts
//
// New coverage for `inlineReferencesIntoText.images`. The helper now
// returns a structured `ImageContentBlock[]` alongside the resolved text
// so callers can hand the user-message factory both channels. The image
// payload travels through the provider message, not the text prompt.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inlineReferencesIntoText } from '../../src/promptContextReferences/inlineReferences'
import type { PromptResolverDeps } from '../../src/promptContextReferences/resolver'
import type { PromptReferenceToken } from '../../src/promptContextReferences/types'

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

  describe('with NUKA_PROMPT_IMAGE_MAX_BYTES override', () => {
    const orig = process.env['NUKA_PROMPT_IMAGE_MAX_BYTES']
    beforeEach(() => { process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = '4' })
    afterEach(() => {
      if (orig === undefined) delete process.env['NUKA_PROMPT_IMAGE_MAX_BYTES']
      else process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = orig
    })

    it('rejects images larger than the cap', async () => {
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
    })
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

  it('emits a text marker for provider_file_id (transport out of scope)', async () => {
    const token: PromptReferenceToken = {
      id: 'img-pfid',
      kind: 'image',
      display: 'file_123',
      target: {
        kind: 'image',
        sourceKind: 'provider_file_id',
        providerFileId: 'file_123',
        mimeType: 'image/png',
      },
      resolvePolicy: 'snapshot',
      status: 'valid',
      metadata: {},
    }
    const result = await inlineReferencesIntoText({
      raw: 'pfid',
      tokens: [token],
      deps: noopDeps(),
    })
    expect(result.images).toEqual([])
    expect(result.text).toContain('[image: file_123 (provider_file_id transport not wired)]')
  })
})
