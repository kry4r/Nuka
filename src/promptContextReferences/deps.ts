/**
 * Default real-resolver bundle for the prompt-mentions module.
 *
 * `buildDefaultResolverDeps()` returns a `PromptResolverDeps` whose
 * implementations bind to:
 *
 *   - `node:fs/promises` for file/folder/image reads
 *   - the global `fetch` for URL mentions
 *   - `execa`-wrapped `git` for diff/staged/commit/git revspec mentions
 *
 * Every dep is overridable via the options bag so callers (TUI wiring,
 * tests) can swap individual capabilities — e.g. provide a workspace
 * cwd, a custom git binary, or a stub `fetch`.
 *
 * Ported from Nuka-Code's inline factory in `utils/handlePromptSubmit.ts`,
 * extracted into its own module so it can be reused by the TUI wiring
 * in iter 3 without dragging in handlePromptSubmit dependencies.
 */

import { readFile, readdir } from 'node:fs/promises'

import { detectImageFormatFromBuffer } from './imageFormat'
import type { PromptResolverDeps } from './resolver'
import { buildPromptResolverRunGit, type RunGit } from './runGit'

export type BuildResolverDepsOptions = Partial<PromptResolverDeps> & {
  /**
   * Optional alternative `runGit`. If omitted, a fresh `runGit` from
   * `buildPromptResolverRunGit()` is bound for the git/diff/staged
   * resolvers, so callers don't have to construct one themselves.
   */
  runGit?: RunGit
}

export function buildDefaultResolverDeps(
  options: BuildResolverDepsOptions = {},
): PromptResolverDeps {
  const runGit = options.runGit ?? buildPromptResolverRunGit()

  const readTextFile =
    options.readTextFile ??
    (async (path: string) => readFile(path, 'utf8'))

  const readDirectory =
    options.readDirectory ??
    (async (path: string) => readdir(path))

  const getDiff =
    options.getDiff ??
    (async () => {
      const res = await runGit(['diff', '--no-ext-diff'])
      return res.stdout
    })

  const getStagedDiff =
    options.getStagedDiff ??
    (async () => {
      const res = await runGit(['diff', '--cached', '--no-ext-diff'])
      return res.stdout
    })

  const fetchUrlText =
    options.fetchUrlText ??
    (async (url: string) => {
      const response = await fetch(url)
      return {
        url: response.url,
        content: await response.text(),
      }
    })

  const readLocalImage =
    options.readLocalImage ??
    (async (path: string) => {
      const buffer = await readFile(path)
      return {
        mimeType: detectImageFormatFromBuffer(buffer),
        dataBase64: buffer.toString('base64'),
      }
    })

  return {
    readTextFile,
    readDirectory,
    getDiff,
    getStagedDiff,
    runGit,
    fetchUrlText,
    readLocalImage,
  }
}
