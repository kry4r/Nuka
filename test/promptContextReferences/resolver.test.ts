import { describe, expect, test } from 'vitest'

import {
  createPromptDraft,
  insertPromptElement,
} from '../../src/promptContextReferences/draft'
import { resolvePromptDraft } from '../../src/promptContextReferences/resolver'
import type { PromptReferenceToken } from '../../src/promptContextReferences/types'

const fileToken: PromptReferenceToken = {
  id: 'file-src-main',
  kind: 'file',
  display: 'src/main.ts',
  target: {
    kind: 'file',
    path: 'src/main.ts',
  },
  resolvePolicy: 'live',
  status: 'valid',
  metadata: {},
}

const imageToken: PromptReferenceToken = {
  id: 'image-2',
  kind: 'image',
  display: '[Image #2]',
  target: {
    kind: 'image',
    sourceKind: 'clipboard_asset',
    pastedContentId: 2,
    mimeType: 'image/png',
  },
  resolvePolicy: 'snapshot',
  status: 'valid',
  metadata: {},
}

describe('prompt resolver', () => {
  test('resolves live file references and strips chip labels from the outgoing prompt text', async () => {
    const draft = insertPromptElement(createPromptDraft('Summarize '), {
      elementId: fileToken.id,
      token: fileToken,
      kind: 'mention',
      placeholderLabel: '@src/main.ts',
      cursorOffset: 10,
    })

    const resolved = await resolvePromptDraft(draft, {
      readTextFile: async filePath => `// file:${filePath}\nexport const ready = true\n`,
      readDirectory: async () => [],
      getDiff: async () => '',
      getStagedDiff: async () => '',
      runGit: async () => ({ stdout: '', stderr: '', code: 0 }),
      fetchUrlText: async url => ({
        url,
        content: '',
      }),
      readLocalImage: async () => ({
        mimeType: 'image/png',
        dataBase64: 'ignored',
      }),
    })

    expect(resolved.promptText).toBe('Summarize ')
    expect(resolved.textArtifacts).toEqual([
      expect.objectContaining({
        originTokenId: 'file-src-main',
        label: 'src/main.ts',
      }),
    ])
    expect(resolved.textArtifacts[0]?.content).toContain(
      'export const ready = true',
    )
  })

  test('materializes snapshot image tokens into canonical image artifacts', async () => {
    const draft = insertPromptElement(createPromptDraft('Compare '), {
      elementId: imageToken.id,
      token: imageToken,
      kind: 'image',
      placeholderLabel: '[Image #2]',
      cursorOffset: 8,
      asset: {
        id: 2,
        type: 'image',
        content: 'ZmFrZS1pbWFnZQ==',
        mediaType: 'image/png',
        filename: 'diagram.png',
      },
    })

    const resolved = await resolvePromptDraft(draft, {
      readTextFile: async () => '',
      readDirectory: async () => [],
      getDiff: async () => '',
      getStagedDiff: async () => '',
      runGit: async () => ({ stdout: '', stderr: '', code: 0 }),
      fetchUrlText: async url => ({
        url,
        content: '',
      }),
      readLocalImage: async () => ({
        mimeType: 'image/png',
        dataBase64: 'unused',
      }),
    })

    expect(resolved.promptText).toBe('Compare ')
    expect(resolved.imageArtifacts).toEqual([
      expect.objectContaining({
        originTokenId: 'image-2',
        sourceKind: 'clipboard_asset',
        mimeType: 'image/png',
        dataBase64: 'ZmFrZS1pbWFnZQ==',
      }),
    ])
  })
})

const stubDeps = {
  readTextFile: async () => '',
  readDirectory: async () => [],
  getDiff: async () => '',
  getStagedDiff: async () => '',
  fetchUrlText: async (url: string) => ({ url, content: '' }),
  readLocalImage: async () => ({ mimeType: '', dataBase64: '' }),
}

function draftWithToken(token: PromptReferenceToken, label: string) {
  return insertPromptElement(createPromptDraft(''), {
    elementId: token.id,
    token,
    kind: 'mention',
    placeholderLabel: label,
    cursorOffset: 0,
  })
}

describe('resolvePromptDraft — commit kind', () => {
  test('invokes git show --stat --no-patch with the hash', async () => {
    const calls: string[][] = []
    const runGit = async (args: string[]) => {
      calls.push(args)
      return { stdout: 'a1b2c3d feat: foo\n\n stats here', stderr: '', code: 0 }
    }
    const token: PromptReferenceToken = {
      id: 'commit-a1b2c3d',
      kind: 'commit',
      display: 'a1b2c3d',
      target: { kind: 'commit', hash: 'a1b2c3d', subject: 'feat: foo' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const draft = draftWithToken(token, '@commit:a1b2c3d')
    const result = await resolvePromptDraft(draft, { ...stubDeps, runGit })
    expect(calls).toEqual([
      [
        'show',
        '--stat',
        '--no-patch',
        '--format=%h %s%n%nAuthor: %an <%ae>%nDate:   %ad%n%n%B',
        'a1b2c3d',
      ],
    ])
    expect(result.textArtifacts).toHaveLength(1)
    expect(result.textArtifacts[0]).toMatchObject({
      label: 'commit feat: foo',
      content: 'a1b2c3d feat: foo\n\n stats here',
      provenance: { kind: 'commit', target: 'a1b2c3d' },
    })
    expect(result.errors).toEqual([])
  })

  test('unknown revision surfaces friendly error', async () => {
    const runGit = async () => ({
      stdout: '',
      stderr: "fatal: bad revision 'zzzz'",
      code: 128,
    })
    const token: PromptReferenceToken = {
      id: 'commit-zzzz',
      kind: 'commit',
      display: 'zzzz',
      target: { kind: 'commit', hash: 'zzzz' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const draft = draftWithToken(token, '@commit:zzzz')
    const result = await resolvePromptDraft(draft, { ...stubDeps, runGit })
    expect(result.errors[0]?.message).toContain('Unknown revision: zzzz')
  })
})

describe('resolvePromptDraft — git kind (single)', () => {
  test('revspec without .. goes through git show --stat --no-patch', async () => {
    const calls: string[][] = []
    const runGit = async (args: string[]) => {
      calls.push(args)
      return { stdout: 'HEAD output', stderr: '', code: 0 }
    }
    const token: PromptReferenceToken = {
      id: 'git-head',
      kind: 'git',
      display: 'HEAD',
      target: { kind: 'git', revspec: 'HEAD' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const draft = draftWithToken(token, '@git:HEAD')
    const result = await resolvePromptDraft(draft, { ...stubDeps, runGit })
    expect(calls).toEqual([
      [
        'show',
        '--stat',
        '--no-patch',
        '--format=%h %s%n%nAuthor: %an <%ae>%nDate:   %ad%n%n%B',
        'HEAD',
      ],
    ])
    expect(result.textArtifacts[0]).toMatchObject({
      label: 'git HEAD',
      content: 'HEAD output',
      provenance: { kind: 'git', target: 'HEAD' },
    })
  })

  test('not-a-git-repo stderr mapped to friendly message', async () => {
    const runGit = async () => ({
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      code: 128,
    })
    const token: PromptReferenceToken = {
      id: 'git-head',
      kind: 'git',
      display: 'HEAD',
      target: { kind: 'git', revspec: 'HEAD' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const draft = draftWithToken(token, '@git:HEAD')
    const result = await resolvePromptDraft(draft, { ...stubDeps, runGit })
    expect(result.errors[0]?.message).toContain('Not a git repository')
  })
})

describe('resolvePromptDraft — git kind (range)', () => {
  test('revspec with .. runs log --oneline and diff in parallel', async () => {
    const calls: string[][] = []
    const runGit = async (args: string[]) => {
      calls.push(args)
      if (args[0] === 'log') {
        return { stdout: 'e4f5678 fix: bar\na1b2c3d feat: foo', stderr: '', code: 0 }
      }
      return { stdout: 'diff --git a/foo b/foo\n…', stderr: '', code: 0 }
    }
    const token: PromptReferenceToken = {
      id: 'git-range',
      kind: 'git',
      display: 'main..feature',
      target: { kind: 'git', revspec: 'main..feature' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const draft = draftWithToken(token, '@git:main..feature')
    const result = await resolvePromptDraft(draft, { ...stubDeps, runGit })
    expect(calls).toContainEqual(['log', '--oneline', 'main..feature'])
    expect(calls).toContainEqual(['diff', 'main..feature'])
    expect(result.textArtifacts[0]).toMatchObject({
      label: 'git range main..feature',
      provenance: { kind: 'git', target: 'main..feature' },
    })
    expect(result.textArtifacts[0]?.content).toBe(
      'commits in main..feature:\n' +
        'e4f5678 fix: bar\na1b2c3d feat: foo\n\n' +
        'diff main..feature:\n' +
        'diff --git a/foo b/foo\n…',
    )
  })

  test('three-dot range (A...B) is also treated as range', async () => {
    const calls: string[][] = []
    const runGit = async (args: string[]) => {
      calls.push(args)
      return { stdout: '', stderr: '', code: 0 }
    }
    const token: PromptReferenceToken = {
      id: 'git-sym',
      kind: 'git',
      display: 'main...feature',
      target: { kind: 'git', revspec: 'main...feature' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: {},
    }
    const draft = draftWithToken(token, '@git:main...feature')
    await resolvePromptDraft(draft, { ...stubDeps, runGit })
    expect(calls).toContainEqual(['log', '--oneline', 'main...feature'])
    expect(calls).toContainEqual(['diff', 'main...feature'])
  })
})
