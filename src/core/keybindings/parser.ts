import type {
  Chord,
  KeybindingBlock,
  ParsedBinding,
  ParsedKeystroke,
} from './types'

/**
 * Parse a single keystroke string ("ctrl+shift+k") into a ParsedKeystroke.
 * Modifier aliases:
 *   ctrl / control      → ctrl
 *   alt / opt / option  → alt
 *   shift               → shift
 *   meta                → meta
 *   cmd / command / super / win → super
 * Key aliases: esc → escape, return → enter, space → ' '.
 */
export function parseKeystroke(input: string): ParsedKeystroke {
  const ks: ParsedKeystroke = {
    key: '',
    ctrl: false, alt: false, shift: false, meta: false, super: false,
  }
  for (const part of input.split('+')) {
    const lower = part.toLowerCase()
    switch (lower) {
      case 'ctrl':
      case 'control': ks.ctrl = true; break
      case 'alt':
      case 'opt':
      case 'option': ks.alt = true; break
      case 'shift': ks.shift = true; break
      case 'meta': ks.meta = true; break
      case 'cmd':
      case 'command':
      case 'super':
      case 'win': ks.super = true; break
      case 'esc': ks.key = 'escape'; break
      case 'return': ks.key = 'enter'; break
      case 'space': ks.key = ' '; break
      default: ks.key = lower; break
    }
  }
  return ks
}

/**
 * Parse a chord string into an array of ParsedKeystrokes.
 * A literal single space is the space key (not a chord separator).
 */
export function parseChord(input: string): Chord {
  if (input === ' ') return [parseKeystroke('space')]
  return input.trim().split(/\s+/).map(parseKeystroke)
}

/**
 * Flatten KeybindingBlocks into a list of ParsedBindings, dropping any
 * `null` entries (those are explicit unbindings handled by the resolver).
 */
export function parseBindings(blocks: KeybindingBlock[]): ParsedBinding[] {
  const out: ParsedBinding[] = []
  for (const block of blocks) {
    for (const [chordStr, action] of Object.entries(block.bindings)) {
      if (action === null) continue
      out.push({ chord: parseChord(chordStr), action, context: block.context })
    }
  }
  return out
}
