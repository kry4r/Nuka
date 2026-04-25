// src/core/memdir/parser.ts
//
// Phase 7 §5.3 — MEMORY.md parser.
//
// On disk an entry is a YAML frontmatter block followed by a markdown body,
// concatenated together with a horizontal rule between entries:
//
//   ---
//   ts: 2026-04-25T11:30:00Z
//   sessionId: abc-123
//   keywords: [auth, bcrypt]
//   score: 0.7
//   ---
//
//   <body markdown>
//
//   ---
//   …next entry…
//
// The parser is tolerant: any block whose frontmatter fails to parse, or
// whose required fields are missing, is dropped silently. We never want a
// corrupted MEMORY.md to crash the agent loop's startup.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export type MemoryEntry = {
  ts: string
  sessionId: string
  keywords: string[]
  score?: number
  body: string
}

const FENCE = '---'

/**
 * Parse a MEMORY.md file into structured entries.
 *
 * Splits on top-level `\n---\n` fences, then groups consecutive
 * `---<yaml>---<body>` pairs. Trailing whitespace, blank-line separators,
 * and unfenced preambles are ignored.
 */
export function parseMemoryFile(text: string): MemoryEntry[] {
  if (!text || text.trim().length === 0) return []
  const out: MemoryEntry[] = []
  // Walk through fenced blocks. State: BEFORE_OPEN | IN_FRONT | AFTER_FRONT.
  // We tokenize line-by-line so embedded `---` inside body text only matters
  // when it sits on its own line — same convention Jekyll/Pandoc use.
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    // Find the next opening fence.
    while (i < lines.length && lines[i] !== FENCE) i++
    if (i >= lines.length) break
    // Collect frontmatter until closing fence.
    const frontStart = i + 1
    let j = frontStart
    while (j < lines.length && lines[j] !== FENCE) j++
    if (j >= lines.length) break // unterminated — drop the rest
    const yamlText = lines.slice(frontStart, j).join('\n')
    // Body extends to the next opening fence or EOF.
    const bodyStart = j + 1
    let k = bodyStart
    while (k < lines.length && lines[k] !== FENCE) k++
    const bodyText = lines.slice(bodyStart, k).join('\n').trim()
    i = k

    let parsed: unknown
    try {
      parsed = parseYaml(yamlText)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const fm = parsed as Record<string, unknown>
    if (typeof fm['ts'] !== 'string') continue
    if (typeof fm['sessionId'] !== 'string') continue
    const keywords = Array.isArray(fm['keywords'])
      ? (fm['keywords'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
    const score = typeof fm['score'] === 'number' ? fm['score'] : undefined
    out.push({
      ts: fm['ts'] as string,
      sessionId: fm['sessionId'] as string,
      keywords,
      score,
      body: bodyText,
    })
  }
  return out
}

/** Serialize one entry into the on-disk fence/body form. */
export function formatMemoryEntry(e: MemoryEntry): string {
  const fm: Record<string, unknown> = {
    ts: e.ts,
    sessionId: e.sessionId,
    keywords: e.keywords,
  }
  if (typeof e.score === 'number') fm['score'] = e.score
  // `yaml` emits a trailing newline; trim and re-add to keep output stable.
  const yamlText = stringifyYaml(fm).replace(/\n+$/, '')
  return `${FENCE}\n${yamlText}\n${FENCE}\n\n${e.body.trim()}\n`
}

/** Serialize a list of entries with blank-line separators. */
export function formatMemoryFile(entries: readonly MemoryEntry[]): string {
  if (entries.length === 0) return ''
  return entries.map(formatMemoryEntry).join('\n')
}
