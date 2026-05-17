// src/core/memdir/findRelevantMemories.ts
//
// LLM-driven memory recall — ported from upstream Nuka-Code
// `src/memdir/findRelevantMemories.ts`. Two adaptations for Nuka:
//
//  1. Upstream calls `sideQuery({ model: getDefaultSonnetModel(), ... })`,
//     a Claude-Code-specific dispatch that owns the API client + model
//     routing. Nuka has no equivalent. Instead we follow the existing
//     `synthMemoryEntry` (synth.ts) pattern: the caller passes an
//     `LLMProvider` + `model` string. This keeps every Nuka memdir LLM
//     call routed through the same caller-controlled provider surface.
//
//  2. Upstream optionally fires `MEMORY_SHAPE_TELEMETRY` via a dynamic
//     `feature(...)`-gated `require`. Nuka has no analytics layer; the
//     telemetry block is dropped. Selection result is returned plain.
//
// The selector contract is preserved:
//   - Returns up to 5 RelevantMemory entries (`{ path, mtimeMs }`)
//   - Excludes MEMORY.md (handled inside scanMemoryFiles)
//   - `alreadySurfaced` filters out paths the caller has shown in prior
//     turns *before* the LLM call, so the 5-slot budget is spent on
//     fresh candidates
//   - `recentTools` lets callers say "Claude is actively using these
//     tools — don't surface their reference docs as memory"
//
// No MCP imports or types. The single mention of "mcp__" in upstream
// was a code comment giving an example tool prefix; we keep an
// equivalent generic comment.

import type { LLMProvider } from '../provider/types'
import {
  formatMemoryManifest,
  type MemoryHeader,
  scanMemoryFiles,
} from './memoryScan'

export type RelevantMemory = {
  path: string
  mtimeMs: number
}

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful as the assistant processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful as the assistant processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (the assistant is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.

Respond with ONLY a JSON object of the form: {"selected_memories": ["file1.md", "file2.md"]} — no surrounding prose, no markdown fences.`

const SELECT_TIMEOUT_MS = 8_000

export type FindRelevantMemoriesOpts = {
  /** Tools the caller has used recently — surfacing their reference docs is noise. */
  recentTools?: readonly string[]
  /** Paths already shown in prior turns; the selector will never re-pick them. */
  alreadySurfaced?: ReadonlySet<string>
  /** Override the default 8s LLM-call timeout (mostly for tests). */
  timeoutMs?: number
}

/**
 * Find memory files relevant to a query by scanning memory file headers
 * and asking the provider to select the most relevant ones.
 *
 * Returns absolute file paths + mtime of the most relevant memories
 * (up to 5). Excludes MEMORY.md (already loaded by the caller's prompt
 * builder). `mtimeMs` is threaded through so callers can surface
 * freshness via `memoryAge()` / `memoryFreshnessNote()` without a
 * second stat.
 *
 * On any failure (provider error, timeout, malformed JSON) returns []
 * rather than throwing — the caller treats "no relevant memories" as
 * a non-error degraded state.
 */
export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  provider: LLMProvider,
  model: string,
  signal: AbortSignal,
  opts: FindRelevantMemoriesOpts = {},
): Promise<RelevantMemory[]> {
  const alreadySurfaced = opts.alreadySurfaced ?? new Set<string>()
  const recentTools = opts.recentTools ?? []

  const memories = (await scanMemoryFiles(memoryDir, signal)).filter(
    m => !alreadySurfaced.has(m.filePath),
  )
  if (memories.length === 0) return []

  const selectedFilenames = await selectRelevantMemories(
    query,
    memories,
    provider,
    model,
    signal,
    recentTools,
    opts.timeoutMs ?? SELECT_TIMEOUT_MS,
  )
  if (selectedFilenames.length === 0) return []

  const byFilename = new Map(memories.map(m => [m.filename, m]))
  const selected: MemoryHeader[] = []
  for (const filename of selectedFilenames) {
    const m = byFilename.get(filename)
    if (m !== undefined) selected.push(m)
  }
  return selected.map(m => ({ path: m.filePath, mtimeMs: m.mtimeMs }))
}

async function selectRelevantMemories(
  query: string,
  memories: readonly MemoryHeader[],
  provider: LLMProvider,
  model: string,
  signal: AbortSignal,
  recentTools: readonly string[],
  timeoutMs: number,
): Promise<string[]> {
  const validFilenames = new Set(memories.map(m => m.filename))
  const manifest = formatMemoryManifest(memories)
  // 当 assistant 正在用某个工具时（比如某个 namespaced tool like
  // foo__bar__spawn），把该工具的 reference 当 memory 推出来是噪声 —
  // 对话里已经有可用的实战示例了。selector 默认基于关键词重合度
  // 工作（query 里有 "spawn" + 描述里有 "spawn" → 误报）。
  const toolsSection =
    recentTools.length > 0
      ? `\n\nRecently used tools: ${recentTools.join(', ')}`
      : ''
  const userText = `Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}`

  // Linked controller: abort either when the caller's signal fires or
  // when our local timeout trips. Cleared in `finally` so a fast
  // success doesn't keep a dangling timer.
  const inner = new AbortController()
  const onParentAbort = (): void => inner.abort()
  if (signal.aborted) inner.abort()
  else signal.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => inner.abort(), timeoutMs)

  let raw = ''
  try {
    const stream = provider.stream(
      {
        model,
        system: SELECT_MEMORIES_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            id: 'memdir-recall',
            ts: Date.now(),
            content: [{ type: 'text', text: userText }],
          },
        ],
        tools: [],
        maxTokens: 256,
      },
      inner.signal,
    )
    for await (const ev of stream) {
      if (ev.type === 'text_delta') raw += ev.text
      if (inner.signal.aborted) break
    }
  } catch {
    return []
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onParentAbort)
  }

  return parseSelectedFilenames(raw, validFilenames)
}

/**
 * Parse the model's JSON response and filter to filenames the scan
 * actually produced. Exported for tests; defensive against the model
 * wrapping the JSON in a code fence or trailing prose.
 */
export function parseSelectedFilenames(
  rawOutput: string,
  validFilenames: ReadonlySet<string>,
): string[] {
  const text = stripMarkdownFence(rawOutput.trim())
  if (!text) return []
  const obj = tryParseJson(text)
  if (!obj || typeof obj !== 'object') return []
  const list = (obj as { selected_memories?: unknown }).selected_memories
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const item of list) {
    if (typeof item === 'string' && validFilenames.has(item)) {
      out.push(item)
    }
  }
  // Models occasionally exceed the "up to 5" cap; enforce it here too.
  return out.slice(0, 5)
}

function stripMarkdownFence(text: string): string {
  if (!text.startsWith('```')) return text
  // Drop opening ```[lang]\n and the matching closing fence.
  const firstNewline = text.indexOf('\n')
  if (firstNewline < 0) return text
  const body = text.slice(firstNewline + 1)
  const closeIdx = body.lastIndexOf('```')
  return closeIdx < 0 ? body : body.slice(0, closeIdx)
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Model wrapped JSON in prose: try the first {...} balanced segment.
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}
