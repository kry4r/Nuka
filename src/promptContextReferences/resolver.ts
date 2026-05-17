/**
 * Resolver contract + dispatch for the prompt-mention module.
 *
 * `resolvePromptDraft` takes a `PromptDraft` plus a `PromptResolverDeps`
 * bundle of capability functions, and dispatches per element kind:
 *
 *   file/folder   → readTextFile / readDirectory
 *   diff/staged   → getDiff / getStagedDiff
 *   git/commit    → runGit (rev parsing, range vs single)
 *   url           → fetchUrlText
 *   image         → readLocalImage / clipboard asset lookup
 *
 * Iteration 1 ships only the contract + dispatch. Real resolver
 * implementations (a node fs reader, a git-CLI driver, a URL fetcher,
 * an image loader) are deferred to a later iteration; tests cover the
 * dispatch shape with in-test stub `deps`.
 */

import type {
  PromptDraft,
  PromptReferenceToken,
  ResolvedImageArtifact,
  ResolvedPromptArtifacts,
  ResolvedTextArtifact,
} from './types'

type RunGitResult = { stdout: string; stderr: string; code: number }

export type PromptResolverDeps = {
  readTextFile: (path: string) => Promise<string>
  readDirectory: (path: string) => Promise<string[]>
  getDiff: () => Promise<string>
  getStagedDiff: () => Promise<string>
  runGit: (args: string[]) => Promise<RunGitResult>
  fetchUrlText: (url: string) => Promise<{
    url: string
    content: string
  }>
  readLocalImage: (path: string) => Promise<{
    mimeType: string
    dataBase64: string
  }>
}

function translateGitError(stderr: string, revspec: string): string {
  const firstLine = stderr.split('\n').find(line => line.trim().length > 0) ?? ''
  if (/not a git repository/i.test(stderr)) {
    return 'Not a git repository (@commit/@git requires git)'
  }
  if (/unknown revision/i.test(stderr) && revspec.startsWith('HEAD')) {
    return 'Repository has no commits yet'
  }
  if (stderr.length > 0) {
    return `Unknown revision: ${revspec} (${firstLine})`
  }
  return `Unknown revision: ${revspec}`
}

const GIT_SHOW_FORMAT =
  '--format=%h %s%n%nAuthor: %an <%ae>%nDate:   %ad%n%n%B'

function stripElementPlaceholders(draft: PromptDraft): string {
  let cursor = 0
  let output = ''

  for (const element of [...draft.elements].sort(
    (left, right) => left.byteRange.start - right.byteRange.start,
  )) {
    output += draft.text.slice(cursor, element.byteRange.start)
    cursor = element.byteRange.end
  }

  output += draft.text.slice(cursor)
  return output
}

async function resolveTextArtifact(
  token: PromptReferenceToken,
  deps: PromptResolverDeps,
): Promise<ResolvedTextArtifact> {
  switch (token.kind) {
    case 'file': {
      if (token.target.kind !== 'file') {
        throw new Error('file token missing file target')
      }
      const content = await deps.readTextFile(token.target.path)
      return {
        originTokenId: token.id,
        label: token.display,
        content,
        provenance: { kind: 'file', target: token.target.path },
      }
    }
    case 'folder': {
      if (token.target.kind !== 'folder') {
        throw new Error('folder token missing folder target')
      }
      const entries = await deps.readDirectory(token.target.path)
      return {
        originTokenId: token.id,
        label: token.display,
        content: entries.join('\n'),
        provenance: { kind: 'folder', target: token.target.path },
      }
    }
    case 'diff':
      return {
        originTokenId: token.id,
        label: 'Current diff',
        content: await deps.getDiff(),
        provenance: { kind: 'diff', target: 'working-tree' },
      }
    case 'staged':
      return {
        originTokenId: token.id,
        label: 'Current staged diff',
        content: await deps.getStagedDiff(),
        provenance: { kind: 'staged', target: 'index' },
      }
    case 'commit': {
      if (token.target.kind !== 'commit') {
        throw new Error('commit token missing commit target')
      }
      const { hash, subject } = token.target
      const res = await deps.runGit([
        'show',
        '--stat',
        '--no-patch',
        GIT_SHOW_FORMAT,
        hash,
      ])
      if (res.code !== 0) {
        throw new Error(translateGitError(res.stderr, hash))
      }
      return {
        originTokenId: token.id,
        label: `commit ${subject ?? hash}`,
        content: res.stdout.trimEnd(),
        provenance: { kind: 'commit', target: hash },
      }
    }
    case 'git': {
      if (token.target.kind !== 'git') {
        throw new Error('git token missing git target')
      }
      const revspec = token.target.revspec
      const isRange = /\.\.\.?/u.test(revspec)
      if (!isRange) {
        const res = await deps.runGit([
          'show',
          '--stat',
          '--no-patch',
          GIT_SHOW_FORMAT,
          revspec,
        ])
        if (res.code !== 0) {
          throw new Error(translateGitError(res.stderr, revspec))
        }
        return {
          originTokenId: token.id,
          label: `git ${revspec}`,
          content: res.stdout.trimEnd(),
          provenance: { kind: 'git', target: revspec },
        }
      }
      const [logRes, diffRes] = await Promise.all([
        deps.runGit(['log', '--oneline', revspec]),
        deps.runGit(['diff', revspec]),
      ])
      if (logRes.code !== 0) {
        throw new Error(translateGitError(logRes.stderr, revspec))
      }
      if (diffRes.code !== 0) {
        throw new Error(translateGitError(diffRes.stderr, revspec))
      }
      const content =
        `commits in ${revspec}:\n${logRes.stdout.trimEnd()}\n\n` +
        `diff ${revspec}:\n${diffRes.stdout.trimEnd()}`
      return {
        originTokenId: token.id,
        label: `git range ${revspec}`,
        content,
        provenance: { kind: 'git', target: revspec },
      }
    }
    case 'url': {
      if (token.target.kind !== 'url') {
        throw new Error('url token missing url target')
      }
      const urlResult = await deps.fetchUrlText(token.target.url)
      return {
        originTokenId: token.id,
        label: urlResult.url,
        content: urlResult.content,
        provenance: { kind: 'url', target: urlResult.url },
      }
    }
    default:
      throw new Error(`Unsupported text token kind: ${token.kind}`)
  }
}

async function resolveImageArtifact(
  draft: PromptDraft,
  token: PromptReferenceToken,
  deps: PromptResolverDeps,
): Promise<ResolvedImageArtifact> {
  if (token.target.kind !== 'image') {
    throw new Error('image token missing image target')
  }
  const asset = draft.assetsById[token.id]

  switch (token.target.sourceKind) {
    case 'clipboard_asset':
      return {
        originTokenId: token.id,
        sourceKind: 'clipboard_asset',
        mimeType: asset?.mediaType,
        dataBase64: asset?.content,
      }
    case 'local_path': {
      if (!token.target.path) {
        throw new Error('local_path image token missing path')
      }
      const local = await deps.readLocalImage(token.target.path)
      return {
        originTokenId: token.id,
        sourceKind: 'local_path',
        localPath: token.target.path,
        mimeType: local.mimeType,
        dataBase64: local.dataBase64,
      }
    }
    case 'remote_url':
      return {
        originTokenId: token.id,
        sourceKind: 'remote_url',
        remoteUrl: token.target.url,
        mimeType: token.target.mimeType,
      }
    case 'provider_file_id':
      return {
        originTokenId: token.id,
        sourceKind: 'provider_file_id',
        providerFileId: token.target.providerFileId,
        mimeType: token.target.mimeType,
      }
  }
}

export async function resolvePromptDraft(
  draft: PromptDraft,
  deps: PromptResolverDeps,
): Promise<ResolvedPromptArtifacts> {
  const textArtifacts: ResolvedTextArtifact[] = []
  const imageArtifacts: ResolvedImageArtifact[] = []
  const warnings: ResolvedPromptArtifacts['warnings'] = []
  const errors: ResolvedPromptArtifacts['errors'] = []

  for (const element of [...draft.elements].sort(
    (left, right) => left.byteRange.start - right.byteRange.start,
  )) {
    const token = draft.tokensById[element.tokenId]
    if (!token) {
      continue
    }

    try {
      if (token.kind === 'image') {
        imageArtifacts.push(await resolveImageArtifact(draft, token, deps))
      } else {
        textArtifacts.push(await resolveTextArtifact(token, deps))
      }
    } catch (error) {
      errors.push({
        tokenId: token.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    promptText: stripElementPlaceholders(draft),
    textArtifacts,
    imageArtifacts,
    warnings,
    errors,
  }
}
