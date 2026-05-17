// src/core/memdir/memoryScan.ts
//
// Memory-directory scanning primitives. Ported from upstream Nuka-Code
// `src/memdir/memoryScan.ts`, with two adjustments for Nuka:
//
//  1. Upstream uses `parseFrontmatter` (a shared util) + `readFileInRange`
//     (read first N lines + return mtimeMs in one syscall). Neither exists
//     in Nuka, and the upstream readFileInRange dragged in a 6-file utility
//     chain. We inline a minimal `parseFrontmatter` using `yaml` (already a
//     Nuka dep — see parser.ts / synth.ts) and substitute a plain
//     `fs.readFile` + `fs.stat` pair. Frontmatter files are small (<100
//     lines, usually <20), so the slight syscall difference is not material.
//
//  2. Same export shape: `MemoryHeader`, `scanMemoryFiles`,
//     `formatMemoryManifest`. Callers (findRelevantMemories) keep the
//     upstream signature.
//
// No MCP references; the only relevant cleanup vs. upstream is the dep
// substitution above.

import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { type MemoryType, parseMemoryType } from './memoryTypes'

export type MemoryHeader = {
  filename: string
  filePath: string
  mtimeMs: number
  description: string | null
  type: MemoryType | undefined
}

const MAX_MEMORY_FILES = 200
const FRONTMATTER_MAX_LINES = 30

type ParsedFrontmatter = {
  description?: string
  type?: unknown
}

/**
 * Parse a leading YAML frontmatter block from the head of a markdown file.
 * Returns an empty record for files with no `---`-fenced block, malformed
 * YAML, or unterminated fences — matches the upstream `parseFrontmatter`
 * "lossy" contract: never throw, never crash the scan.
 */
function parseHeadFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---')) return {}
  const afterOpen = content.slice(3)
  if (!afterOpen.startsWith('\n') && !afterOpen.startsWith('\r\n')) return {}
  // Body of the frontmatter ends at the next line containing only `---`.
  const lines = afterOpen.replace(/^\r?\n/, '').split(/\r?\n/)
  const closeIdx = lines.findIndex(l => l === '---')
  if (closeIdx < 0) return {}
  const yamlText = lines.slice(0, closeIdx).join('\n')
  let parsed: unknown
  try {
    parsed = parseYaml(yamlText)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  const obj = parsed as Record<string, unknown>
  const out: ParsedFrontmatter = {}
  if (typeof obj['description'] === 'string') {
    out.description = obj['description']
  }
  if ('type' in obj) {
    out.type = obj['type']
  }
  return out
}

/**
 * Read the first `maxLines` lines of `filePath` and return the slice plus
 * its mtime. We read the whole file then slice — the upstream
 * `readFileInRange` would stream, but memory files cap at a few KB and the
 * simpler implementation lets us avoid porting the streaming util.
 *
 * Returns null if the file cannot be read (deleted between readdir and now,
 * permission denied, …) — `scanMemoryFiles` filters these out.
 */
async function readHead(
  filePath: string,
  maxLines: number,
  signal: AbortSignal,
): Promise<{ content: string; mtimeMs: number } | null> {
  if (signal.aborted) return null
  try {
    const [raw, stat] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.stat(filePath),
    ])
    const lines = raw.split(/\r?\n/)
    const head = lines.slice(0, maxLines).join('\n')
    return { content: head, mtimeMs: stat.mtimeMs }
  } catch {
    return null
  }
}

/**
 * Scan a memory directory for .md files, read their frontmatter, and return
 * a header list sorted newest-first (capped at MAX_MEMORY_FILES). Shared by
 * findRelevantMemories (query-time recall) and any future extract-memories
 * agent that wants the listing pre-injected.
 *
 * Excludes `MEMORY.md` — it is the entrypoint index, already loaded into the
 * system prompt by the caller.
 */
export async function scanMemoryFiles(
  memoryDir: string,
  signal: AbortSignal,
): Promise<MemoryHeader[]> {
  if (signal.aborted) return []
  let entries: string[]
  try {
    entries = await fs.readdir(memoryDir, { recursive: true })
  } catch {
    return []
  }
  const mdFiles = entries.filter(
    f => f.endsWith('.md') && basename(f) !== 'MEMORY.md',
  )

  const headerResults = await Promise.allSettled(
    mdFiles.map(async (relativePath): Promise<MemoryHeader | null> => {
      const filePath = join(memoryDir, relativePath)
      const head = await readHead(filePath, FRONTMATTER_MAX_LINES, signal)
      if (!head) return null
      const frontmatter = parseHeadFrontmatter(head.content)
      return {
        filename: relativePath,
        filePath,
        mtimeMs: head.mtimeMs,
        description: frontmatter.description ?? null,
        type: parseMemoryType(frontmatter.type),
      }
    }),
  )

  const headers: MemoryHeader[] = []
  for (const r of headerResults) {
    if (r.status === 'fulfilled' && r.value !== null) {
      headers.push(r.value)
    }
  }
  return headers
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_MEMORY_FILES)
}

/**
 * Format memory headers as a text manifest: one line per file with
 * [type] filename (timestamp): description. Used by the recall selector
 * prompt to give the LLM enough info to pick relevant entries.
 */
export function formatMemoryManifest(memories: readonly MemoryHeader[]): string {
  return memories
    .map(m => {
      const tag = m.type ? `[${m.type}] ` : ''
      const ts = new Date(m.mtimeMs).toISOString()
      return m.description
        ? `- ${tag}${m.filename} (${ts}): ${m.description}`
        : `- ${tag}${m.filename} (${ts})`
    })
    .join('\n')
}
