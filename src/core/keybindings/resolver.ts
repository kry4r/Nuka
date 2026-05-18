import { DEFAULT_BINDINGS } from './defaultBindings'
import { matchesKeystroke, type InkLikeKey } from './match'
import { parseChord } from './parser'
import type {
  KeybindingAction,
  KeybindingBlock,
  KeybindingContext,
  ParsedKeystroke,
} from './types'

type Entry = {
  context: KeybindingContext
  chord: ParsedKeystroke[]      // length 1 for Phase 1 (single-keystroke chords)
  action: KeybindingAction | null  // null = explicit unbind
}

/**
 * Merge defaults with user overrides into a flat lookup list.
 * Later entries (user) take precedence over earlier (defaults) for the same
 * (context, chord) pair. The merge key is `${context}|${chordString}`.
 */
function mergeBlocks(user: KeybindingBlock[] | null): Entry[] {
  const byKey = new Map<string, Entry>()
  const ingest = (blocks: KeybindingBlock[]): void => {
    for (const block of blocks) {
      for (const [chordStr, action] of Object.entries(block.bindings)) {
        const chord = parseChord(chordStr)
        byKey.set(`${block.context}|${chordStr}`, {
          context: block.context, chord, action,
        })
      }
    }
  }
  ingest(DEFAULT_BINDINGS)
  if (user) ingest(user)
  return Array.from(byKey.values())
}

export type KeybindingResolver = (
  input: string,
  key: InkLikeKey,
  context: KeybindingContext,
) => KeybindingAction | null

/**
 * Build a resolver closed over a merged (defaults + user) entry list.
 *
 * Matching order per call:
 *   1. Same-context entries (most specific)
 *   2. Global entries (fallback)
 * An entry with `action === null` is treated as an explicit unbind: the
 * resolver returns null and does NOT fall through to a less-specific entry.
 */
export function buildResolver(user: KeybindingBlock[] | null): KeybindingResolver {
  const entries = mergeBlocks(user)
  return (input, key, context) => {
    // Phase 1: only consider length-1 chords.
    const candidates = entries.filter(e => e.chord.length === 1)
    // Pass 1: same context.
    for (const e of candidates) {
      if (e.context !== context) continue
      const ks = e.chord[0]
      if (!ks) continue
      if (matchesKeystroke(input, key, ks)) return e.action
    }
    // Pass 2: Global fallback (only if no same-context match landed).
    for (const e of candidates) {
      if (e.context !== 'Global') continue
      const ks = e.chord[0]
      if (!ks) continue
      if (matchesKeystroke(input, key, ks)) return e.action
    }
    return null
  }
}
