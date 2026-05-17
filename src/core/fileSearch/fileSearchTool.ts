// src/core/fileSearch/fileSearchTool.ts
//
// FileSearch — agent-facing fuzzy file search over a project directory.
//
// Wraps the existing fileSearch infrastructure (walker + FileIndex + the
// fzf-style ranker in `searchPaths.ts`) into a Tool the agent can invoke
// via tool-use. This converts a pure-library surface into user-visible
// functionality: the model can ask "where does the registry live?" and
// get a ranked path list back without spawning ripgrep or Bash.
//
// Why a dedicated Tool (vs. GlobTool / GrepTool)?
//
//   - Glob is exact-pattern, not fuzzy. The model often only remembers
//     a partial / mis-cased name (`fsearch`, `searchpath`); fuzzy
//     ranking surfaces the right file anyway.
//   - Grep is content-search, expensive when the model only needs
//     a path. We hand back paths only, no file IO beyond the walk.
//   - Our internal palette / typeahead already uses this ranker
//     (see Iter N — fuzzyFileSearch upgrade); exposing it as a Tool
//     means the agent sees the same ordering the human user would.
//
// AbortSignal behavior (from spec):
//
//   walkFiles already polls `signal?.aborted` between directory reads,
//   so an abort mid-walk returns whatever was gathered so far instead
//   of throwing. We mirror that on the Tool surface: when the signal
//   aborts before/during the walk, we still build an index from the
//   partial path list, run the query against it, and flag the result
//   with `aborted: true` so the model can choose to retry.
//
// Side-effects: filesystem reads under `rootDir` only. No writes,
// no network. `readOnly: true`, `parallelSafe: true`.

import type { Tool, ToolContext, ToolResult } from '../tools/types.js'
import { defineTool } from '../tools/define.js'
import { FileIndex } from './fileIndex.js'
import { walkFiles } from './walker.js'
import { promoteRecent } from './searchPaths.js'

export const FILE_SEARCH_TOOL_NAME = 'FileSearch'

/** Default cap on returned matches. Mirrors `searchPaths`'s own default. */
export const FILE_SEARCH_DEFAULT_MAX = 20

/**
 * Hard cap on `maxResults` — guards against the model asking for
 * a thousand matches and choking the transcript. Tools.runtime trims
 * any value above this regardless of what the schema allowed.
 */
export const FILE_SEARCH_HARD_MAX = 200

export type FileSearchInput = {
  query: string
  rootDir?: string
  maxResults?: number
  respectGitignore?: boolean
  includeDotfiles?: boolean
  recentPaths?: ReadonlyArray<string>
}

/** One scored match. Mirrors the shape of `SearchResult` plus an optional
 *  display path for callers that want to render absolute paths. */
export type FileSearchMatch = {
  path: string
  score: number
  /**
   * Same as `path` today (relative, forward-slash). Kept on the type so
   * future iterations can swap in a renderer that abbreviates `~/...`
   * or shortens long prefixes without breaking the structured output
   * shape. Callers should display `displayPath ?? path`.
   */
  displayPath?: string
}

/** Structured output payload (also serialised as JSON in `output`). */
export type FileSearchResult = {
  matches: FileSearchMatch[]
  totalIndexed: number
  indexBuildMs: number
  /** True if `ctx.signal` aborted before/during the walk. */
  aborted?: boolean
}

/**
 * Run the search end-to-end. Exported so tests (and potentially other
 * internal callers) can hit the logic without going through the Tool's
 * input validation / output formatting.
 *
 * Mirrors `searchPaths` but tolerates an aborted signal by indexing
 * whatever the walker gathered before the abort and continuing to
 * search against the partial index.
 */
export async function runFileSearch(
  input: FileSearchInput,
  signal: AbortSignal,
): Promise<FileSearchResult> {
  const {
    query,
    rootDir,
    maxResults = FILE_SEARCH_DEFAULT_MAX,
    respectGitignore = true,
    includeDotfiles = false,
    recentPaths,
  } = input

  const effectiveRoot = rootDir ?? process.cwd()
  const effectiveMax = Math.max(
    1,
    Math.min(FILE_SEARCH_HARD_MAX, Math.floor(maxResults)),
  )

  const buildStart = performance.now()
  // walkFiles tolerates abort mid-traversal — it returns partial paths
  // instead of throwing. We capture the abort status separately so the
  // caller can decide whether to retry.
  const paths = await walkFiles({
    rootDir: effectiveRoot,
    respectGitignore,
    includeDotfiles,
    signal,
  })
  const aborted = signal.aborted

  const index = new FileIndex()
  index.loadFromFileList(paths)
  const totalIndexed = index.size()

  let matches = index.search(query, effectiveMax)
  if (recentPaths && recentPaths.length > 0 && query.length > 0) {
    matches = promoteRecent(matches, recentPaths, effectiveMax)
  }

  const indexBuildMs = Math.round(performance.now() - buildStart)

  const out: FileSearchResult = {
    matches: matches.map(m => ({
      path: m.path,
      score: m.score,
      displayPath: m.path,
    })),
    totalIndexed,
    indexBuildMs,
  }
  if (aborted) out.aborted = true
  return out
}

/**
 * Format the result as a compact, model-readable string. The full
 * structured payload is included as a trailing JSON line so callers
 * that want the typed object can `JSON.parse` the last line.
 */
function formatResult(r: FileSearchResult, query: string): string {
  const header =
    r.matches.length === 0
      ? `No paths matched "${query}" (indexed ${r.totalIndexed} file(s) in ${r.indexBuildMs}ms${r.aborted ? '; aborted' : ''}).`
      : `Top ${r.matches.length} match(es) for "${query}" (indexed ${r.totalIndexed} file(s) in ${r.indexBuildMs}ms${r.aborted ? '; aborted' : ''}):`

  const lines = r.matches.map(
    m => `  ${m.path}  (score=${m.score.toFixed(3)})`,
  )
  // Trailing JSON line so structured consumers don't have to re-parse
  // the human text. Matches the pattern other Nuka tools use when they
  // want both human + machine output in a single string.
  const json = JSON.stringify(r)
  return [header, ...lines, '', json].join('\n')
}

export const FileSearchTool: Tool<FileSearchInput> = defineTool<FileSearchInput>({
  name: FILE_SEARCH_TOOL_NAME,
  description:
    'Fuzzy-search project files by path. Returns ranked relative paths (forward-slash) with a score. ' +
    'Use this when you remember part of a filename (`searchPaths`, `cli`, `fsearch`) but not the exact location, ' +
    'or when GlobTool patterns are too rigid. Respects `.gitignore` by default and skips dotfiles. ' +
    'Pass `recentPaths` to boost recently-touched files in the ranking.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description:
          'Fuzzy query (case-insensitive unless it contains uppercase). Empty string returns top-level entries.',
      },
      rootDir: {
        type: 'string',
        description: 'Absolute directory to search under. Defaults to the process cwd.',
      },
      maxResults: {
        type: 'number',
        description: `Max matches to return (default ${FILE_SEARCH_DEFAULT_MAX}, hard cap ${FILE_SEARCH_HARD_MAX}).`,
        minimum: 1,
        maximum: FILE_SEARCH_HARD_MAX,
      },
      respectGitignore: {
        type: 'boolean',
        description: 'Skip paths matched by .gitignore. Default `true` (project-internal search).',
      },
      includeDotfiles: {
        type: 'boolean',
        description: 'Include dotfile / dotdir entries (.env, .gitignore, ...). Default `false`.',
      },
      recentPaths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Paths (relative, forward-slash) to promote in the ranking. ' +
          'Only nudges ordering of paths that already passed the fuzzy match.',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.read', 'file-search'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: ['file', 'find', 'fuzzy', 'path', 'search'],
  aliases: ['file_search', 'find_file'],
  async run(
    input: FileSearchInput,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const { query } = input
    if (typeof query !== 'string') {
      return {
        isError: true,
        output: `FileSearch: 'query' must be a string (got ${typeof query}).`,
      }
    }

    if (
      input.maxResults !== undefined &&
      (typeof input.maxResults !== 'number' ||
        !Number.isFinite(input.maxResults) ||
        input.maxResults < 1)
    ) {
      return {
        isError: true,
        output: `FileSearch: 'maxResults' must be a positive number (got ${String(input.maxResults)}).`,
      }
    }

    try {
      const result = await runFileSearch(input, ctx.signal)
      return { isError: false, output: formatResult(result, query) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        isError: true,
        output: `FileSearch: failed to search "${input.rootDir ?? process.cwd()}": ${msg}`,
      }
    }
  },
})
