// src/core/outputStyles/loader.ts
//
// Markdown + YAML-frontmatter loader for user-defined output styles —
// ported from Nuka-Code's `src/outputStyles/loadOutputStylesDir.ts` but
// rewritten against Nuka's existing patterns (skill loader at
// `src/core/skill/loader.ts` is the immediate template).
//
// Search paths (each is optional — missing dirs return no entries):
//   • $HOME/.nuka/output-styles/*.md      — global / user-scope
//   • <cwd>/.nuka/output-styles/*.md      — project-scope
//
// Project entries override globals with the same `name`. Per-file
// errors (broken YAML, missing/extra `---`, unreadable bytes) are
// isolated — that single file is dropped and the rest of the batch
// still loads, matching the "malformed file tolerance" invariant.
//
// This module is loader infrastructure only — it has no caller
// integration with the agent system prompt. Future follow-up wiring
// is tracked separately in the feature-port plan doc.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { outputStyleFrontmatterSchema } from './types'
import type { OutputStyle, OutputStyleSource } from './types'

const FRONTMATTER_OPEN = '---\n'
const FRONTMATTER_CLOSE = '\n---\n'

/**
 * Pull a short, single-line description out of the markdown body when
 * the frontmatter doesn't supply one. Mirrors Nuka-Code's
 * `extractDescriptionFromMarkdown`: uses the first non-blank line,
 * strips leading `#` headers, and truncates to ~100 chars.
 */
function deriveDescriptionFromBody(body: string, fallbackName: string): string {
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const headerMatch = line.match(/^#+\s+(.+)$/)
    const text = headerMatch?.[1] ?? line
    return text.length > 100 ? text.slice(0, 97) + '...' : text
  }
  return `Custom ${fallbackName} output style`
}

/**
 * Parse one markdown-with-frontmatter blob into an OutputStyle. Returns
 * `null` for any structural problem — missing/incomplete frontmatter,
 * invalid YAML, or a frontmatter shape that doesn't match the Zod
 * schema. The caller treats `null` as "skip this file" without
 * stopping the wider scan.
 */
export function parseOutputStyle(
  content: string,
  meta: { path: string; source: OutputStyleSource },
): OutputStyle | null {
  // Require the canonical opening fence at the very start. Anything
  // else (BOM, leading blank line, no frontmatter at all) is malformed
  // by definition — same hard check the skill loader uses.
  if (!content.startsWith(FRONTMATTER_OPEN)) return null

  const closeIdx = content.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length)
  if (closeIdx === -1) return null

  const yamlText = content.slice(FRONTMATTER_OPEN.length, closeIdx)
  const body = content.slice(closeIdx + FRONTMATTER_CLOSE.length).trim()

  let raw: unknown
  try {
    raw = parseYaml(yamlText)
  } catch {
    return null
  }

  const result = outputStyleFrontmatterSchema.safeParse(raw)
  if (!result.success) return null

  const { name, description, keepCodingInstructions } = result.data
  const resolvedDescription =
    description !== undefined && description.trim().length > 0
      ? description
      : deriveDescriptionFromBody(body, name)

  const style: OutputStyle = {
    name,
    description: resolvedDescription,
    prompt: body,
    source: meta.source,
    path: meta.path,
  }
  if (keepCodingInstructions !== undefined) {
    style.keepCodingInstructions = keepCodingInstructions
  }
  return style
}

/**
 * Walk a single `.nuka/output-styles/` directory and parse every `.md`
 * file inside it. Missing directory → `[]`. Per-file read or parse
 * failures are dropped silently — see module header for rationale.
 *
 * Non-recursive on purpose: matches the skill loader and keeps the
 * surface area (a flat namespace of style names) predictable.
 */
async function loadFromDir(
  dir: string,
  source: OutputStyleSource,
): Promise<OutputStyle[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const mdFiles = entries.filter((e) => e.endsWith('.md')).sort()
  const styles: OutputStyle[] = []

  for (const file of mdFiles) {
    const filePath = path.join(dir, file)
    let content: string
    try {
      content = await readFile(filePath, 'utf8')
    } catch {
      continue
    }
    const style = parseOutputStyle(content, { path: filePath, source })
    if (style) styles.push(style)
  }

  return styles
}

/**
 * Public API. Loads global + project output styles and merges them
 * with project-wins-by-name semantics. Identical to the skill loader's
 * `loadSkills` so the two stay consistent for end users.
 *
 * Callers pass `home` and `cwd` explicitly rather than relying on
 * `process.env`/`process.cwd()` — keeps the loader trivially testable
 * (the test suite injects temp dirs) and lets future agent-loop
 * callers thread their already-resolved values straight through.
 */
export async function loadOutputStyles(opts: {
  home: string
  cwd: string
}): Promise<OutputStyle[]> {
  const globalDir = path.join(opts.home, '.nuka', 'output-styles')
  const projectDir = path.join(opts.cwd, '.nuka', 'output-styles')

  const [globals, projects] = await Promise.all([
    loadFromDir(globalDir, 'global'),
    loadFromDir(projectDir, 'project'),
  ])

  // Last-wins by name. Globals seeded first; project entries with the
  // same name silently override (no console warn — matches skill
  // loader, and overriding is the *expected* use case here).
  const byName = new Map<string, OutputStyle>()
  for (const style of globals) byName.set(style.name, style)
  for (const style of projects) byName.set(style.name, style)

  return [...byName.values()]
}
