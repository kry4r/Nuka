// src/core/toolSearch/tool.ts
//
// ToolSearch — agent-facing search over the tool registry.
//
// Upstream (Nuka-Code) ships this as a discovery surface for "deferred"
// tools — MCP-style tools whose schema isn't shipped in the initial
// prompt. The agent asks ToolSearch for a keyword and gets back the
// matching tool names (and indirectly, their schemas).
//
// Nuka doesn't have a hard deferred/non-deferred split at the agent
// surface — every registered tool is visible — but the same problem
// shows up once the registry grows (plugins, MCP tools, dynamic
// skills). ToolSearch here functions as agent-facing introspection:
// "given a need, which tool(s) should I reach for?" with a score so
// the agent can fall back to the next best match when its first guess
// doesn't fit.
//
// Differences from upstream:
//
//   1. We don't filter to a "deferred" subset — the registry list is
//      the search domain. The agent already knows the names of loaded
//      tools, but it does NOT know their tags / searchHint / description
//      at a glance, and that's the discovery value here.
//
//   2. Score weights match upstream's heuristic shape (name parts > full
//      name > hint > description), with one Nuka-specific addition:
//      `tags` get name-part weight, because Nuka tools carry curated
//      capability tags (`core`, `fs.read`, etc.) that map directly onto
//      what the model usually asks for.
//
//   3. The `select:` short-circuit returns whichever names resolve
//      (including via aliases) — same "harmless no-op if already
//      loaded" stance upstream took.
//
// Side-effects: none. Read-only, parallel-safe.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import { ToolRegistry } from '../tools/registry'

export const TOOL_SEARCH_TOOL_NAME = 'ToolSearch'

export const TOOL_SEARCH_DEFAULT_MAX = 5
export const TOOL_SEARCH_HARD_MAX = 50

export type ToolSearchInput = {
  query: string
  max_results?: number
}

/**
 * One scored match. Exported so tests (and callers wanting structured
 * output) don't have to re-parse the textual `output`.
 */
export type ToolSearchMatch = {
  name: string
  score: number
  /** Brief description (trimmed) for caller display. */
  description: string
}

/**
 * Parse a tool name into searchable parts. Handles three name styles:
 *
 *   - MCP-ish `mcp__server__action` → ["server", "action", ...]
 *   - CamelCase `WebFetch`           → ["web", "fetch"]
 *   - snake_case `web_fetch`         → ["web", "fetch"]
 *
 * Returned `full` is a space-joined lowercase form for substring fallback
 * scoring; `isMcp` lets us bump the weight on MCP server-name matches,
 * matching upstream's hint that `mcp__slack` should beat `slackbot` for
 * the query "slack".
 */
export function parseToolName(name: string): {
  parts: string[]
  full: string
  isMcp: boolean
} {
  if (name.startsWith('mcp__')) {
    const withoutPrefix = name.replace(/^mcp__/, '').toLowerCase()
    const parts = withoutPrefix
      .split('__')
      .flatMap(p => p.split('_'))
      .filter(Boolean)
    return {
      parts,
      full: withoutPrefix.replace(/__/g, ' ').replace(/_/g, ' '),
      isMcp: true,
    }
  }

  const parts = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  return {
    parts,
    full: parts.join(' '),
    isMcp: false,
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build word-boundary regexes once per search rather than per tool×term. */
function compileTermPatterns(terms: string[]): Map<string, RegExp> {
  const out = new Map<string, RegExp>()
  for (const term of terms) {
    if (!out.has(term)) {
      out.set(term, new RegExp(`\\b${escapeRegExp(term)}\\b`))
    }
  }
  return out
}

/**
 * Score one tool against the query terms. Pure — no I/O, no async.
 *
 * Weights (loosely follow upstream ToolSearchTool.ts):
 *   - exact name-part match:     10 (MCP server names: 12)
 *   - partial name-part match:    5 (MCP: 6)
 *   - full-name substring:        3 (only when no part hit, kept for edge cases)
 *   - tag exact match:           10 (Nuka-specific — tags are curated)
 *   - tag substring:              5
 *   - searchHint pattern match:   4
 *   - description pattern match:  2
 *   - alias exact match:          8 (curated alternate name)
 */
export function scoreTool(
  tool: Tool,
  query: string,
  termPatterns?: Map<string, RegExp>,
): number {
  const queryLower = query.toLowerCase().trim()
  if (!queryLower) return 0

  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 0)
  if (queryTerms.length === 0) return 0

  const patterns = termPatterns ?? compileTermPatterns(queryTerms)

  const parsed = parseToolName(tool.name)
  const descNormalized = (tool.description ?? '').toLowerCase()
  const hintNormalized = (tool.searchHint ?? []).join(' ').toLowerCase()
  const tagSet = new Set((tool.tags ?? []).map(t => t.toLowerCase()))
  const aliasSet = new Set((tool.aliases ?? []).map(a => a.toLowerCase()))

  let score = 0
  for (const term of queryTerms) {
    const pattern = patterns.get(term)!

    // Name parts
    if (parsed.parts.includes(term)) {
      score += parsed.isMcp ? 12 : 10
    } else if (parsed.parts.some(p => p.includes(term))) {
      score += parsed.isMcp ? 6 : 5
    } else if (parsed.full.includes(term)) {
      // Full-name fallback only when no part hit registered yet.
      // Upstream gates this on `score === 0` per term loop; we keep the
      // same gating by checking against name parts (the only other
      // name-side signal so far).
      score += 3
    }

    // Tags
    if (tagSet.has(term)) {
      score += 10
    } else {
      for (const t of tagSet) {
        if (t.includes(term)) {
          score += 5
          break
        }
      }
    }

    // Aliases
    if (aliasSet.has(term)) {
      score += 8
    }

    // searchHint
    if (hintNormalized && pattern.test(hintNormalized)) {
      score += 4
    }

    // Description
    if (descNormalized && pattern.test(descNormalized)) {
      score += 2
    }
  }

  return score
}

/**
 * Search the registry and return scored matches, descending by score.
 * Pure with respect to `registry`; exported for direct callers (e.g.
 * the /toolsearch slash command, if one is ever added).
 */
export function searchTools(
  registry: ToolRegistry,
  query: string,
  maxResults: number = TOOL_SEARCH_DEFAULT_MAX,
): ToolSearchMatch[] {
  const queryLower = query.toLowerCase().trim()
  if (!queryLower) return []

  const all = registry.list()

  // Fast path: exact name (or alias) match — return just that one tool.
  // Matches upstream's "subagent / post-compaction sends a bare tool
  // name" handling: cheaper than running the whole scoring loop.
  for (const tool of all) {
    if (tool.name.toLowerCase() === queryLower) {
      return [
        {
          name: tool.name,
          score: 100,
          description: (tool.description ?? '').trim(),
        },
      ]
    }
    const aliases = (tool.aliases ?? []).map(a => a.toLowerCase())
    if (aliases.includes(queryLower)) {
      return [
        {
          name: tool.name,
          score: 100,
          description: (tool.description ?? '').trim(),
        },
      ]
    }
  }

  // MCP prefix path: `mcp__server` — return prefix matches (top-N by
  // alphabetical, since they're all equally "matched" on prefix).
  if (queryLower.startsWith('mcp__') && queryLower.length > 5) {
    const prefix = all
      .filter(t => t.name.toLowerCase().startsWith(queryLower))
      .slice(0, maxResults)
      .map(t => ({
        name: t.name,
        score: 50,
        description: (t.description ?? '').trim(),
      }))
    if (prefix.length > 0) return prefix
  }

  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 0)
  const termPatterns = compileTermPatterns(queryTerms)

  const scored = all
    .map(t => ({
      name: t.name,
      score: scoreTool(t, queryLower, termPatterns),
      description: (t.description ?? '').trim(),
    }))
    .filter(m => m.score > 0)

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.name.localeCompare(b.name)
  })

  return scored.slice(0, maxResults)
}

/**
 * Parse the `select:A,B,C` form. Returns the requested names, or `null`
 * when the input isn't in select form. Exported for tests.
 */
export function parseSelectQuery(query: string): string[] | null {
  const m = query.match(/^select:(.+)$/i)
  if (!m) return null
  return m[1]!
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Format the matches into a single string for the model. We render one
 * tool per line as `<name> (score=N): <description>`, with the
 * description truncated to keep the response compact. The agent can
 * then call the named tool directly.
 */
function formatMatches(matches: ToolSearchMatch[], query: string): string {
  if (matches.length === 0) {
    return `No tools matched "${query}".`
  }
  const lines = matches.map(m => {
    const desc = m.description.length > 200
      ? m.description.slice(0, 197) + '...'
      : m.description
    return `${m.name} (score=${m.score}): ${desc}`
  })
  return lines.join('\n')
}

/**
 * Build a ToolSearch tool bound to a specific registry instance. The
 * registry is captured at construction time — same pattern as
 * `makeCronTools(store)` / `makeTaskTools(store)`.
 */
export function makeToolSearchTool(registry: ToolRegistry): Tool<ToolSearchInput> {
  return defineTool<ToolSearchInput>({
    name: TOOL_SEARCH_TOOL_NAME,
    description:
      'Search the tool registry by keyword, tag, or description. Returns matching tool names with a score so you can pick the most relevant. Use `select:Name1,Name2` to look up specific tools by name (handy when you know the name but not the exact spelling/casing). Use a keyword query (`schedule`, `cron remind`, `tokens estimate`) to discover tools you may not have seen yet.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description:
            'Either `select:Name1,Name2` for direct name lookup, or one-or-more keywords for ranked search.',
          minLength: 1,
        },
        max_results: {
          type: 'number',
          description: `Maximum number of matches to return (default ${TOOL_SEARCH_DEFAULT_MAX}, hard cap ${TOOL_SEARCH_HARD_MAX}).`,
          minimum: 1,
          maximum: TOOL_SEARCH_HARD_MAX,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'tool-search'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: ['tool', 'search', 'find', 'discover', 'registry'],
    aliases: ['tool_search'],
    async run(
      input: ToolSearchInput,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const { query } = input
      if (typeof query !== 'string' || query.trim().length === 0) {
        return {
          isError: true,
          output: 'ToolSearch: `query` must be a non-empty string.',
        }
      }

      const requestedMax = input.max_results ?? TOOL_SEARCH_DEFAULT_MAX
      if (typeof requestedMax !== 'number' || !Number.isFinite(requestedMax) || requestedMax < 1) {
        return {
          isError: true,
          output: `ToolSearch: 'max_results' must be a positive number (got ${String(requestedMax)}).`,
        }
      }
      const maxResults = Math.min(Math.floor(requestedMax), TOOL_SEARCH_HARD_MAX)

      const selectNames = parseSelectQuery(query)
      if (selectNames !== null) {
        // Direct selection — preserve order, deduplicate, attribute misses
        const found: ToolSearchMatch[] = []
        const seen = new Set<string>()
        const missing: string[] = []
        for (const requestedName of selectNames) {
          const tool = registry.find(requestedName)
          if (tool) {
            if (!seen.has(tool.name)) {
              seen.add(tool.name)
              found.push({
                name: tool.name,
                score: 100,
                description: (tool.description ?? '').trim(),
              })
            }
          } else {
            missing.push(requestedName)
          }
        }

        if (found.length === 0) {
          return {
            isError: false,
            output: `No tools found for select query. Missing: ${missing.join(', ') || '(empty)'}.`,
          }
        }

        const header = missing.length > 0
          ? `Selected ${found.length} tool(s); missing: ${missing.join(', ')}.`
          : `Selected ${found.length} tool(s).`
        return {
          isError: false,
          output: header + '\n' + formatMatches(found.slice(0, maxResults), query),
        }
      }

      const matches = searchTools(registry, query, maxResults)
      return {
        isError: false,
        output: formatMatches(matches, query),
      }
    },
  })
}
