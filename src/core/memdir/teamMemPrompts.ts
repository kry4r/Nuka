// src/core/memdir/teamMemPrompts.ts
//
// 2026-05-18 — system-prompt section renderer for team memory. The
// section sits between `userMemory` (future tier) and the existing
// project memory (`memory`) in the assembled prompt. When `entries`
// is empty, returns an empty array so the prompt builder can `...spread`
// it unconditionally without emitting an orphan heading.
//
// Format matches the per-cwd memdir bullet style (see
// `src/core/agent/systemPrompt.ts` lines 70-76) so downstream
// consumers parse all three tiers identically.

import type { MemoryEntry } from './parser'

/**
 * Render the `## Team Memory` section as a string[] of lines (no
 * trailing newline). Returns an empty array when there are no entries
 * so callers can spread unconditionally:
 *
 *     lines.push(...renderTeamMemorySection(entries))
 */
export function renderTeamMemorySection(entries: readonly MemoryEntry[]): string[] {
  if (entries.length === 0) return []
  const lines: string[] = ['', '## Team Memory', '']
  for (const e of entries) {
    const kw = e.keywords.length > 0 ? ` [${e.keywords.join(', ')}]` : ''
    lines.push(`- ${e.body}${kw}`)
  }
  return lines
}
