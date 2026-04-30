// src/core/recap/consolidationPrompt.ts — Phase 14c §6.5
export function buildConsolidationPrompt(memdirEntries: string[]): string {
  return `You are consolidating the following ${memdirEntries.length} memory entries into a single, denser entry. Preserve all factually distinct information. Drop duplication and verbosity. Output ONE paragraph.

Entries:
${memdirEntries.join('\n---\n')}

Consolidated:`
}
