// test/promptContextReferences/inlineReferences.test.ts
//
// Follow-up integration test for the PromptMentions resolver wiring.
//
// Verifies the pure helper that App.tsx uses at submit time to lower
// non-file mention tokens (diff / staged / git / url / image / commit)
// into the text channel of the agent input. The helper is the same code
// path executed by App.handleSubmit; tests stub each capability in
// `PromptResolverDeps` so no real fs / network / git call fires.

import { describe, it, expect, vi } from 'vitest'

import { inlineReferencesIntoText } from '../../src/promptContextReferences/inlineReferences'
import type { PromptResolverDeps } from '../../src/promptContextReferences/resolver'
import type { PromptReferenceToken } from '../../src/promptContextReferences/types'

function makeStubDeps(overrides: Partial<PromptResolverDeps> = {}): PromptResolverDeps {
  return {
    readTextFile: vi.fn(async () => ''),
    readDirectory: vi.fn(async () => []),
    getDiff: vi.fn(async () => 'diff --git a/x b/x\n+hi'),
    getStagedDiff: vi.fn(async () => 'diff --git a/y b/y\n+staged'),
    runGit: vi.fn(async () => ({ stdout: 'abc123 subject', stderr: '', code: 0 })),
    fetchUrlText: vi.fn(async (url: string) => ({ url, content: '<html>hi</html>' })),
    readLocalImage: vi.fn(async () => ({ mimeType: 'image/png', dataBase64: 'AA==' })),
    ...overrides,
  }
}

describe('inlineReferencesIntoText', () => {
  it('returns raw text unchanged when no references are pending', async () => {
    const deps = makeStubDeps()
    const res = await inlineReferencesIntoText({
      raw: 'hello world',
      tokens: [],
      deps,
    })
    expect(res.text).toBe('hello world')
    expect(deps.getDiff).not.toHaveBeenCalled()
  })

  it('inlines a diff reference block before the raw prompt', async () => {
    const diffToken: PromptReferenceToken = {
      id: 'diff-current',
      kind: 'diff',
      display: 'diff',
      target: { kind: 'diff' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const deps = makeStubDeps()
    const res = await inlineReferencesIntoText({
      raw: 'please review',
      tokens: [diffToken],
      deps,
    })
    expect(deps.getDiff).toHaveBeenCalledTimes(1)
    // Resolved block comes first, then the user's raw prompt below.
    expect(res.text).toMatch(/\[Current diff\]\ndiff --git a\/x b\/x\n\+hi/)
    expect(res.text.endsWith('please review')).toBe(true)
    expect(res.artifacts.textArtifacts).toHaveLength(1)
    expect(res.artifacts.errors).toHaveLength(0)
  })

  it('inlines a url reference via the injected fetchUrlText stub', async () => {
    const urlToken: PromptReferenceToken = {
      id: 'url-example',
      kind: 'url',
      display: 'https://example.com',
      target: { kind: 'url', url: 'https://example.com' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const fetchUrlText = vi.fn(async (url: string) => ({
      url,
      content: 'fetched body',
    }))
    const deps = makeStubDeps({ fetchUrlText })
    const res = await inlineReferencesIntoText({
      raw: 'summarize this',
      tokens: [urlToken],
      deps,
    })
    expect(fetchUrlText).toHaveBeenCalledWith('https://example.com')
    expect(res.text).toContain('fetched body')
    expect(res.text).toContain('summarize this')
    // Label of a url artifact is the resolved URL.
    expect(res.text).toContain('[https://example.com]')
  })

  it('inlines a staged and a git-revspec reference in one submit', async () => {
    const stagedToken: PromptReferenceToken = {
      id: 'staged-current',
      kind: 'staged',
      display: 'staged',
      target: { kind: 'staged' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const gitToken: PromptReferenceToken = {
      id: 'git-HEAD',
      kind: 'git',
      display: 'HEAD',
      target: { kind: 'git', revspec: 'HEAD' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const getStagedDiff = vi.fn(async () => 'STAGED-PATCH')
    const runGit = vi.fn(async () => ({
      stdout: 'deadbee subject\n\nAuthor: a',
      stderr: '',
      code: 0,
    }))
    const deps = makeStubDeps({ getStagedDiff, runGit })
    const res = await inlineReferencesIntoText({
      raw: 'land?',
      tokens: [stagedToken, gitToken],
      deps,
    })
    expect(getStagedDiff).toHaveBeenCalledTimes(1)
    expect(runGit).toHaveBeenCalled()
    expect(res.text).toContain('[Current staged diff]')
    expect(res.text).toContain('STAGED-PATCH')
    expect(res.text).toContain('[git HEAD]')
    expect(res.text).toContain('deadbee subject')
    expect(res.text.endsWith('land?')).toBe(true)
    expect(res.artifacts.textArtifacts).toHaveLength(2)
  })

  it('surfaces a placeholder block for image references (transport deferred)', async () => {
    const imageToken: PromptReferenceToken = {
      id: 'image-foo',
      kind: 'image',
      display: 'foo.png',
      target: {
        kind: 'image',
        sourceKind: 'local_path',
        path: '/abs/foo.png',
      },
      resolvePolicy: 'live',
      status: 'draft',
      metadata: {},
    }
    const deps = makeStubDeps()
    const res = await inlineReferencesIntoText({
      raw: 'what is in the image?',
      tokens: [imageToken],
      deps,
    })
    expect(res.text).toContain('[image: /abs/foo.png] (resolution deferred)')
    expect(res.text.endsWith('what is in the image?')).toBe(true)
    expect(res.artifacts.imageArtifacts).toHaveLength(1)
  })

  it('inlines an error marker when the resolver throws (e.g. git not a repo)', async () => {
    const gitToken: PromptReferenceToken = {
      id: 'git-bad',
      kind: 'git',
      display: 'HEAD',
      target: { kind: 'git', revspec: 'HEAD' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const runGit = vi.fn(async () => ({
      stdout: '',
      stderr: 'fatal: not a git repository',
      code: 128,
    }))
    const deps = makeStubDeps({ runGit })
    const res = await inlineReferencesIntoText({
      raw: 'fix?',
      tokens: [gitToken],
      deps,
    })
    expect(res.artifacts.errors).toHaveLength(1)
    expect(res.text).toContain('[reference error:')
    expect(res.text).toContain('Not a git repository')
    expect(res.text.endsWith('fix?')).toBe(true)
  })

  it('deduplicates tokens with the same id (insertion order wins)', async () => {
    const t: PromptReferenceToken = {
      id: 'diff-current',
      kind: 'diff',
      display: 'diff',
      target: { kind: 'diff' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const deps = makeStubDeps()
    const res = await inlineReferencesIntoText({
      raw: 'q',
      tokens: [t, t, t],
      deps,
    })
    // getDiff called once (not three times) because the synthetic draft
    // collapses duplicate ids.
    expect(deps.getDiff).toHaveBeenCalledTimes(1)
    expect(res.artifacts.textArtifacts).toHaveLength(1)
  })
})
