# Keybindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-configurable keybinding layer (parser + resolver + YAML config) that wraps the existing PromptInput/Vim key handling without replacing it; activated only when `NUKA_KEYBINDINGS=1` so legacy hardcoded behavior is preserved by default.

**Architecture:** A new `src/core/keybindings/` module owns (a) immutable `DEFAULT_BINDINGS` constant, (b) zod schema for `~/.nuka/keybindings.yaml`, (c) a string→`ParsedKeystroke` parser, (d) an `(input, key, context) → KeybindingAction | null` resolver that merges defaults with user overrides. PromptInput.tsx imports `resolveKeybinding`; at the top of its `useInput` handler an env-gated branch dispatches by action string. If `NUKA_KEYBINDINGS` is unset (default) the new branch is skipped and every legacy handler fires unchanged. Note: `src/core/vim/` has no `useInput` of its own — the vim layer is driven by `applyVimKey` calls inside PromptInput's `useInput`, so the single integration point in PromptInput.tsx covers Vim too (via the `Vim` context and the `vim:escape` action).

**Tech Stack:** TypeScript (strict), Vitest, zod, yaml

---

## File Structure

```
src/core/keybindings/
  types.ts              # ParsedKeystroke, ParsedBinding, KeybindingContext, KeybindingAction
  schema.ts             # zod KeybindingsSchema for ~/.nuka/keybindings.yaml
  defaultBindings.ts    # DEFAULT_BINDINGS constant (Nuka action surface)
  parser.ts             # parseKeystroke / parseBindings (string -> ParsedKeystroke[])
  match.ts              # matchesKeystroke(input, inkKey, target) -> boolean
  loadUserBindings.ts   # readUserBindings(home) -> KeybindingBlock[] | null
  resolver.ts           # resolveKeybinding(input, key, context) -> action | null
  index.ts              # public re-exports

test/core/keybindings/
  parser.test.ts
  match.test.ts
  schema.test.ts
  loadUserBindings.test.ts
  resolver.test.ts
  promptInputIntegration.test.tsx

src/tui/PromptInput/PromptInput.tsx    # MODIFY: add env-gated resolver branch
```

---

## Task 1 — Define keybinding types

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/keybindings/types.ts`
  - Create `/data/xtzhang/Nuka/test/core/keybindings/types.test.ts`

**Write failing test** — `test/core/keybindings/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type {
  ParsedKeystroke,
  KeybindingAction,
  KeybindingContext,
  KeybindingBlock,
  ParsedBinding,
} from '../../../src/core/keybindings/types'
import { KEYBINDING_CONTEXTS, KEYBINDING_ACTIONS } from '../../../src/core/keybindings/types'

describe('keybinding types', () => {
  it('KEYBINDING_CONTEXTS includes Chat and Global', () => {
    expect(KEYBINDING_CONTEXTS).toContain('Chat')
    expect(KEYBINDING_CONTEXTS).toContain('Global')
  })

  it('KEYBINDING_ACTIONS covers the Nuka PromptInput surface', () => {
    expect(KEYBINDING_ACTIONS).toContain('chat:submit')
    expect(KEYBINDING_ACTIONS).toContain('chat:cancel')
    expect(KEYBINDING_ACTIONS).toContain('history:previous')
    expect(KEYBINDING_ACTIONS).toContain('history:next')
    expect(KEYBINDING_ACTIONS).toContain('mention:dismiss')
    expect(KEYBINDING_ACTIONS).toContain('slash:dismiss')
  })

  it('ParsedKeystroke has all five modifier flags', () => {
    const ks: ParsedKeystroke = {
      key: 'a',
      ctrl: false, alt: false, shift: false, meta: false, super: false,
    }
    expect(ks.key).toBe('a')
  })

  it('ParsedBinding pairs a chord with an action and context', () => {
    const b: ParsedBinding = {
      chord: [{ key: 'enter', ctrl: false, alt: false, shift: false, meta: false, super: false }],
      action: 'chat:submit',
      context: 'Chat',
    }
    const _block: KeybindingBlock = { context: 'Chat', bindings: { enter: 'chat:submit' } }
    const _ctx: KeybindingContext = 'Chat'
    const _act: KeybindingAction = 'chat:submit'
    expect(b.action).toBe('chat:submit')
  })
})
```

**Run failing:** `npx vitest run test/core/keybindings/types.test.ts`

**Implement** — `src/core/keybindings/types.ts`:
```ts
/**
 * Valid UI contexts where a keybinding can fire. Global bindings apply
 * everywhere; context-specific bindings only fire when the matching UI
 * surface is focused.
 */
export const KEYBINDING_CONTEXTS = [
  'Global',
  'Chat',
  'Vim',
  'Mention',
  'Slash',
] as const
export type KeybindingContext = (typeof KEYBINDING_CONTEXTS)[number]

/**
 * Action surface — the subset of operations PromptInput / Vim wrapper
 * actually dispatches today (see PromptInput.tsx lines 238-437). New
 * actions are appended as call-sites land.
 */
export const KEYBINDING_ACTIONS = [
  // Chat input
  'chat:submit',
  'chat:cancel',
  'chat:newline',
  // History
  'history:previous',
  'history:next',
  // Mention palette
  'mention:dismiss',
  'mention:accept',
  'mention:previous',
  'mention:next',
  'mention:focusTypes',
  'mention:focusResults',
  // Slash overlay
  'slash:dismiss',
  'slash:accept',
  'slash:previous',
  'slash:next',
  // Vim mode toggle
  'vim:escape',
] as const
export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number]

/** One parsed keystroke — a normalized key name plus modifier flags. */
export type ParsedKeystroke = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  super: boolean
}

/** A chord is a sequence of keystrokes (e.g. `ctrl+x ctrl+e`). Length >= 1. */
export type Chord = ParsedKeystroke[]

/** A fully-parsed binding: chord + action + context. */
export type ParsedBinding = {
  chord: Chord
  action: KeybindingAction
  context: KeybindingContext
}

/** Raw block as it appears in `keybindings.yaml` before parsing. */
export type KeybindingBlock = {
  context: KeybindingContext
  bindings: Record<string, KeybindingAction | null>
}
```

**Run passing:** `npx vitest run test/core/keybindings/types.test.ts && npx tsc --noEmit`

**Commit:** `feat(keybindings): add core types — contexts, actions, ParsedKeystroke`

---

## Task 2 — Default bindings constant

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/keybindings/defaultBindings.ts`
  - Create `/data/xtzhang/Nuka/test/core/keybindings/defaultBindings.test.ts`

**Write failing test** — `test/core/keybindings/defaultBindings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_BINDINGS } from '../../../src/core/keybindings/defaultBindings'

describe('DEFAULT_BINDINGS', () => {
  it('binds enter to chat:submit in Chat context', () => {
    const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
    expect(chat).toBeDefined()
    expect(chat?.bindings.enter).toBe('chat:submit')
  })

  it('binds up/down to history navigation in Chat context', () => {
    const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
    expect(chat?.bindings.up).toBe('history:previous')
    expect(chat?.bindings.down).toBe('history:next')
  })

  it('binds escape to vim:escape in Vim context', () => {
    const vim = DEFAULT_BINDINGS.find(b => b.context === 'Vim')
    expect(vim?.bindings.escape).toBe('vim:escape')
  })

  it('binds tab to mention:accept and escape to mention:dismiss in Mention context', () => {
    const mention = DEFAULT_BINDINGS.find(b => b.context === 'Mention')
    expect(mention?.bindings.tab).toBe('mention:accept')
    expect(mention?.bindings.escape).toBe('mention:dismiss')
  })

  it('all actions referenced are in the KEYBINDING_ACTIONS surface', async () => {
    const { KEYBINDING_ACTIONS } = await import('../../../src/core/keybindings/types')
    const acts = new Set<string>(KEYBINDING_ACTIONS)
    for (const block of DEFAULT_BINDINGS) {
      for (const action of Object.values(block.bindings)) {
        if (action !== null) expect(acts.has(action)).toBe(true)
      }
    }
  })
})
```

**Run failing:** `npx vitest run test/core/keybindings/defaultBindings.test.ts`

**Implement** — `src/core/keybindings/defaultBindings.ts`:
```ts
import type { KeybindingBlock } from './types'

/**
 * Default keybindings — mirror the hardcoded handlers already in
 * `src/tui/PromptInput/PromptInput.tsx` so opting into NUKA_KEYBINDINGS=1
 * with no user file is observationally identical to the legacy path.
 */
export const DEFAULT_BINDINGS: KeybindingBlock[] = [
  {
    context: 'Chat',
    bindings: {
      enter: 'chat:submit',
      escape: 'chat:cancel',
      up: 'history:previous',
      down: 'history:next',
    },
  },
  {
    context: 'Vim',
    bindings: {
      escape: 'vim:escape',
    },
  },
  {
    context: 'Mention',
    bindings: {
      escape: 'mention:dismiss',
      tab: 'mention:accept',
      enter: 'mention:accept',
      up: 'mention:previous',
      down: 'mention:next',
      left: 'mention:focusTypes',
      right: 'mention:focusResults',
    },
  },
  {
    context: 'Slash',
    bindings: {
      escape: 'slash:dismiss',
      tab: 'slash:accept',
      up: 'slash:previous',
      down: 'slash:next',
    },
  },
]
```

**Run passing:** `npx vitest run test/core/keybindings/defaultBindings.test.ts && npx tsc --noEmit`

**Commit:** `feat(keybindings): seed DEFAULT_BINDINGS for Chat/Vim/Mention/Slash`

---

## Task 3 — Keystroke parser

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/keybindings/parser.ts`
  - Create `/data/xtzhang/Nuka/test/core/keybindings/parser.test.ts`

**Write failing test** — `test/core/keybindings/parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseKeystroke, parseChord, parseBindings } from '../../../src/core/keybindings/parser'
import type { KeybindingBlock } from '../../../src/core/keybindings/types'

describe('parseKeystroke', () => {
  it('parses a plain letter', () => {
    expect(parseKeystroke('a')).toEqual({
      key: 'a', ctrl: false, alt: false, shift: false, meta: false, super: false,
    })
  })

  it('parses ctrl+shift+k', () => {
    expect(parseKeystroke('ctrl+shift+k')).toEqual({
      key: 'k', ctrl: true, alt: false, shift: true, meta: false, super: false,
    })
  })

  it('treats cmd as super', () => {
    expect(parseKeystroke('cmd+c').super).toBe(true)
  })

  it('treats opt as alt', () => {
    expect(parseKeystroke('opt+v').alt).toBe(true)
  })

  it('normalizes esc to escape', () => {
    expect(parseKeystroke('esc').key).toBe('escape')
  })

  it('normalizes return to enter', () => {
    expect(parseKeystroke('return').key).toBe('enter')
  })
})

describe('parseChord', () => {
  it('parses a single keystroke chord', () => {
    expect(parseChord('enter')).toHaveLength(1)
  })

  it('parses a multi-keystroke chord with whitespace separator', () => {
    const chord = parseChord('ctrl+x ctrl+e')
    expect(chord).toHaveLength(2)
    expect(chord[0]?.key).toBe('x')
    expect(chord[1]?.key).toBe('e')
  })

  it('treats a literal single space as the space key', () => {
    const chord = parseChord(' ')
    expect(chord).toHaveLength(1)
    expect(chord[0]?.key).toBe(' ')
  })
})

describe('parseBindings', () => {
  it('flattens KeybindingBlocks into ParsedBindings, dropping nulls', () => {
    const blocks: KeybindingBlock[] = [
      { context: 'Chat', bindings: { enter: 'chat:submit', escape: null } },
    ]
    const parsed = parseBindings(blocks)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.action).toBe('chat:submit')
    expect(parsed[0]?.context).toBe('Chat')
  })
})
```

**Run failing:** `npx vitest run test/core/keybindings/parser.test.ts`

**Implement** — `src/core/keybindings/parser.ts`:
```ts
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
```

**Run passing:** `npx vitest run test/core/keybindings/parser.test.ts && npx tsc --noEmit`

**Commit:** `feat(keybindings): keystroke + chord + block parser`

---

## Task 4 — Match ink Key against ParsedKeystroke

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/keybindings/match.ts`
  - Create `/data/xtzhang/Nuka/test/core/keybindings/match.test.ts`

**Write failing test** — `test/core/keybindings/match.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { matchesKeystroke, getKeyName } from '../../../src/core/keybindings/match'
import { parseKeystroke } from '../../../src/core/keybindings/parser'
import type { InkLikeKey } from '../../../src/core/keybindings/match'

function key(partial: Partial<InkLikeKey> = {}): InkLikeKey {
  return {
    ctrl: false, shift: false, meta: false, super: false,
    escape: false, return: false, tab: false, backspace: false, delete: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageUp: false, pageDown: false, home: false, end: false,
    ...partial,
  }
}

describe('getKeyName', () => {
  it('maps key.return to "enter"', () => {
    expect(getKeyName('', key({ return: true }))).toBe('enter')
  })
  it('maps key.escape to "escape"', () => {
    expect(getKeyName('', key({ escape: true }))).toBe('escape')
  })
  it('lowercases single-character input', () => {
    expect(getKeyName('K', key())).toBe('k')
  })
  it('returns null for empty input with no special key', () => {
    expect(getKeyName('', key())).toBeNull()
  })
})

describe('matchesKeystroke', () => {
  it('matches plain enter', () => {
    const target = parseKeystroke('enter')
    expect(matchesKeystroke('', key({ return: true }), target)).toBe(true)
  })

  it('matches ctrl+c', () => {
    const target = parseKeystroke('ctrl+c')
    expect(matchesKeystroke('c', key({ ctrl: true }), target)).toBe(true)
  })

  it('rejects ctrl+c when ctrl missing', () => {
    const target = parseKeystroke('ctrl+c')
    expect(matchesKeystroke('c', key(), target)).toBe(false)
  })

  it('alt and meta are equivalent at the matcher level', () => {
    const target = parseKeystroke('alt+v')
    // ink reports alt-key as meta=true
    expect(matchesKeystroke('v', key({ meta: true }), target)).toBe(true)
  })

  it('escape ignores ink quirk where key.meta is true on escape', () => {
    const target = parseKeystroke('escape')
    expect(matchesKeystroke('', key({ escape: true, meta: true }), target)).toBe(true)
  })
})
```

**Run failing:** `npx vitest run test/core/keybindings/match.test.ts`

**Implement** — `src/core/keybindings/match.ts`:
```ts
import type { ParsedKeystroke } from './types'

/**
 * Subset of ink's Key shape we depend on. Declared locally so the module
 * is unit-testable without an ink dependency in test code.
 */
export type InkLikeKey = {
  ctrl: boolean
  shift: boolean
  meta: boolean
  super: boolean
  escape: boolean
  return: boolean
  tab: boolean
  backspace: boolean
  delete: boolean
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  pageUp: boolean
  pageDown: boolean
  home: boolean
  end: boolean
}

/** Normalize an ink key event to the same key-name space the parser produces. */
export function getKeyName(input: string, key: InkLikeKey): string | null {
  if (key.escape) return 'escape'
  if (key.return) return 'enter'
  if (key.tab) return 'tab'
  if (key.backspace) return 'backspace'
  if (key.delete) return 'delete'
  if (key.upArrow) return 'up'
  if (key.downArrow) return 'down'
  if (key.leftArrow) return 'left'
  if (key.rightArrow) return 'right'
  if (key.pageUp) return 'pageup'
  if (key.pageDown) return 'pagedown'
  if (key.home) return 'home'
  if (key.end) return 'end'
  if (input.length === 1) return input.toLowerCase()
  return null
}

type Mods = Pick<InkLikeKey, 'ctrl' | 'shift' | 'meta' | 'super'>

function modifiersMatch(mods: Mods, target: ParsedKeystroke): boolean {
  if (mods.ctrl !== target.ctrl) return false
  if (mods.shift !== target.shift) return false
  // ink folds alt and meta into key.meta — accept either alias in config.
  const wantsMeta = target.alt || target.meta
  if (mods.meta !== wantsMeta) return false
  if (mods.super !== target.super) return false
  return true
}

/**
 * Match an ink (input, key) pair against a ParsedKeystroke.
 *
 * Quirk: ink sets key.meta=true on every escape press. We mask it out
 * when the target is the escape key so plain `escape` bindings match.
 */
export function matchesKeystroke(
  input: string,
  key: InkLikeKey,
  target: ParsedKeystroke,
): boolean {
  const name = getKeyName(input, key)
  if (name !== target.key) return false
  const mods: Mods = {
    ctrl: key.ctrl, shift: key.shift, meta: key.meta, super: key.super,
  }
  if (key.escape) return modifiersMatch({ ...mods, meta: false }, target)
  return modifiersMatch(mods, target)
}
```

**Run passing:** `npx vitest run test/core/keybindings/match.test.ts && npx tsc --noEmit`

**Commit:** `feat(keybindings): match ink Key events against ParsedKeystrokes`

---

## Task 5 — zod schema for keybindings.yaml

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/keybindings/schema.ts`
  - Create `/data/xtzhang/Nuka/test/core/keybindings/schema.test.ts`

**Write failing test** — `test/core/keybindings/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { KeybindingsSchema } from '../../../src/core/keybindings/schema'

describe('KeybindingsSchema', () => {
  it('accepts a minimal valid file', () => {
    const parsed = KeybindingsSchema.parse({
      bindings: [
        { context: 'Chat', bindings: { enter: 'chat:submit' } },
      ],
    })
    expect(parsed.bindings).toHaveLength(1)
  })

  it('allows null values for explicit unbinding', () => {
    const parsed = KeybindingsSchema.parse({
      bindings: [{ context: 'Chat', bindings: { up: null } }],
    })
    expect(parsed.bindings[0]?.bindings.up).toBeNull()
  })

  it('rejects an unknown context', () => {
    expect(() =>
      KeybindingsSchema.parse({
        bindings: [{ context: 'Bogus', bindings: { enter: 'chat:submit' } }],
      }),
    ).toThrow()
  })

  it('rejects an unknown action', () => {
    expect(() =>
      KeybindingsSchema.parse({
        bindings: [{ context: 'Chat', bindings: { enter: 'chat:nope' } }],
      }),
    ).toThrow()
  })

  it('accepts an empty bindings array', () => {
    const parsed = KeybindingsSchema.parse({ bindings: [] })
    expect(parsed.bindings).toEqual([])
  })
})
```

**Run failing:** `npx vitest run test/core/keybindings/schema.test.ts`

**Implement** — `src/core/keybindings/schema.ts`:
```ts
import { z } from 'zod'
import { KEYBINDING_ACTIONS, KEYBINDING_CONTEXTS } from './types'

export const KeybindingBlockSchema = z.object({
  context: z.enum(KEYBINDING_CONTEXTS),
  bindings: z.record(
    z.string(),
    z.union([z.enum(KEYBINDING_ACTIONS), z.null()]),
  ),
})

export const KeybindingsSchema = z.object({
  $schema: z.string().optional(),
  bindings: z.array(KeybindingBlockSchema),
})

export type KeybindingsFile = z.infer<typeof KeybindingsSchema>
```

**Run passing:** `npx vitest run test/core/keybindings/schema.test.ts && npx tsc --noEmit`

**Commit:** `feat(keybindings): zod schema for keybindings.yaml`

---

## Task 6 — Load user bindings from disk

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/keybindings/loadUserBindings.ts`
  - Create `/data/xtzhang/Nuka/test/core/keybindings/loadUserBindings.test.ts`

**Write failing test** — `test/core/keybindings/loadUserBindings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { readUserBindings } from '../../../src/core/keybindings/loadUserBindings'

function tmpHome(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-keybindings-'))
}

describe('readUserBindings', () => {
  it('returns null when the file is absent (ENOENT)', async () => {
    const h = tmpHome()
    const blocks = await readUserBindings(h)
    expect(blocks).toBeNull()
  })

  it('parses a valid keybindings.yaml', async () => {
    const h = tmpHome()
    mkdirSync(join(h, '.nuka'))
    writeFileSync(
      join(h, '.nuka', 'keybindings.yaml'),
      'bindings:\n  - context: Chat\n    bindings:\n      enter: chat:submit\n',
    )
    const blocks = await readUserBindings(h)
    expect(blocks).not.toBeNull()
    expect(blocks?.[0]?.context).toBe('Chat')
    expect(blocks?.[0]?.bindings.enter).toBe('chat:submit')
  })

  it('throws on schema-invalid YAML (loud surface)', async () => {
    const h = tmpHome()
    mkdirSync(join(h, '.nuka'))
    writeFileSync(
      join(h, '.nuka', 'keybindings.yaml'),
      'bindings:\n  - context: Bogus\n    bindings: { enter: chat:submit }\n',
    )
    await expect(readUserBindings(h)).rejects.toThrow()
  })
})
```

**Run failing:** `npx vitest run test/core/keybindings/loadUserBindings.test.ts`

**Implement** — `src/core/keybindings/loadUserBindings.ts`:
```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { KeybindingsSchema } from './schema'
import type { KeybindingBlock } from './types'

/**
 * Read and validate `~/.nuka/keybindings.yaml`.
 * Returns null on ENOENT (no user file). Throws on schema validation errors
 * so misconfigurations surface immediately instead of silently dropping bindings.
 */
export async function readUserBindings(home: string): Promise<KeybindingBlock[] | null> {
  const filePath = path.join(home, '.nuka', 'keybindings.yaml')
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const parsed = parseYaml(raw)
  const file = KeybindingsSchema.parse(parsed)
  // Re-cast to KeybindingBlock[] — schema validates context/action enums so
  // the cast is sound. The record-value union (action | null) is preserved.
  return file.bindings as KeybindingBlock[]
}
```

**Run passing:** `npx vitest run test/core/keybindings/loadUserBindings.test.ts && npx tsc --noEmit`

**Commit:** `feat(keybindings): load + validate ~/.nuka/keybindings.yaml`

---

## Task 7 — Resolver: merge defaults + user, dispatch by context

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/keybindings/resolver.ts`
  - Create `/data/xtzhang/Nuka/test/core/keybindings/resolver.test.ts`

**Write failing test** — `test/core/keybindings/resolver.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildResolver } from '../../../src/core/keybindings/resolver'
import type { InkLikeKey } from '../../../src/core/keybindings/match'
import type { KeybindingBlock } from '../../../src/core/keybindings/types'

function key(p: Partial<InkLikeKey> = {}): InkLikeKey {
  return {
    ctrl: false, shift: false, meta: false, super: false,
    escape: false, return: false, tab: false, backspace: false, delete: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageUp: false, pageDown: false, home: false, end: false,
    ...p,
  }
}

describe('buildResolver', () => {
  it('resolves enter → chat:submit from defaults in Chat context', () => {
    const resolve = buildResolver(null)
    expect(resolve('', key({ return: true }), 'Chat')).toBe('chat:submit')
  })

  it('returns null when no binding matches in the given context', () => {
    const resolve = buildResolver(null)
    expect(resolve('z', key(), 'Chat')).toBeNull()
  })

  it('global bindings fire from any context', () => {
    const user: KeybindingBlock[] = [
      { context: 'Global', bindings: { 'ctrl+l': 'chat:newline' } },
    ]
    const resolve = buildResolver(user)
    expect(resolve('l', key({ ctrl: true }), 'Chat')).toBe('chat:newline')
  })

  it('user override replaces default for same context+chord', () => {
    const user: KeybindingBlock[] = [
      { context: 'Chat', bindings: { enter: 'chat:newline' } },
    ]
    const resolve = buildResolver(user)
    expect(resolve('', key({ return: true }), 'Chat')).toBe('chat:newline')
  })

  it('null unbinds a default', () => {
    const user: KeybindingBlock[] = [
      { context: 'Chat', bindings: { enter: null } },
    ]
    const resolve = buildResolver(user)
    expect(resolve('', key({ return: true }), 'Chat')).toBeNull()
  })

  it('escape in Vim context resolves to vim:escape', () => {
    const resolve = buildResolver(null)
    expect(resolve('', key({ escape: true }), 'Vim')).toBe('vim:escape')
  })
})
```

**Run failing:** `npx vitest run test/core/keybindings/resolver.test.ts`

**Implement** — `src/core/keybindings/resolver.ts`:
```ts
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
```

**Run passing:** `npx vitest run test/core/keybindings/resolver.test.ts && npx tsc --noEmit`

**Commit:** `feat(keybindings): resolver merges defaults with user overrides`

---

## Task 8 — Public index barrel

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/keybindings/index.ts`

**Write failing test** — extend `test/core/keybindings/types.test.ts` with one import-from-barrel check:
```ts
import { describe, it, expect } from 'vitest'
import {
  buildResolver,
  readUserBindings,
  DEFAULT_BINDINGS,
  KEYBINDING_ACTIONS,
} from '../../../src/core/keybindings'

describe('keybindings index barrel', () => {
  it('re-exports the public surface', () => {
    expect(typeof buildResolver).toBe('function')
    expect(typeof readUserBindings).toBe('function')
    expect(Array.isArray(DEFAULT_BINDINGS)).toBe(true)
    expect(Array.isArray(KEYBINDING_ACTIONS)).toBe(true)
  })
})
```

**Run failing:** `npx vitest run test/core/keybindings/types.test.ts`

**Implement** — `src/core/keybindings/index.ts`:
```ts
export { DEFAULT_BINDINGS } from './defaultBindings'
export { readUserBindings } from './loadUserBindings'
export { buildResolver, type KeybindingResolver } from './resolver'
export { matchesKeystroke, getKeyName, type InkLikeKey } from './match'
export { parseKeystroke, parseChord, parseBindings } from './parser'
export { KeybindingsSchema, KeybindingBlockSchema, type KeybindingsFile } from './schema'
export {
  KEYBINDING_ACTIONS,
  KEYBINDING_CONTEXTS,
  type KeybindingAction,
  type KeybindingContext,
  type KeybindingBlock,
  type ParsedKeystroke,
  type ParsedBinding,
  type Chord,
} from './types'
```

**Run passing:** `npx vitest run test/core/keybindings/types.test.ts && npx tsc --noEmit`

**Commit:** `feat(keybindings): public index barrel`

---

## Task 9 — Wire resolver into PromptInput (env-gated)

- [ ] **Files:**
  - Modify `/data/xtzhang/Nuka/src/tui/PromptInput/PromptInput.tsx`
  - Create `/data/xtzhang/Nuka/test/core/keybindings/promptInputIntegration.test.tsx`

**Write failing test** — `test/core/keybindings/promptInputIntegration.test.tsx`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { buildResolver, readUserBindings } from '../../../src/core/keybindings'

const ORIG_HOME = process.env.HOME
const ORIG_KB = process.env.NUKA_KEYBINDINGS

beforeEach(() => { delete process.env.NUKA_KEYBINDINGS })
afterEach(() => {
  if (ORIG_HOME !== undefined) process.env.HOME = ORIG_HOME
  if (ORIG_KB !== undefined) process.env.NUKA_KEYBINDINGS = ORIG_KB
  else delete process.env.NUKA_KEYBINDINGS
})

function k() {
  return {
    ctrl: false, shift: false, meta: false, super: false,
    escape: false, return: false, tab: false, backspace: false, delete: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageUp: false, pageDown: false, home: false, end: false,
  }
}

describe('keybindings integration — env-gated user overrides', () => {
  it('user override file replaces enter→chat:submit with enter→chat:newline', async () => {
    const home = mkdtempSync(join(os.tmpdir(), 'nuka-kb-int-'))
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'keybindings.yaml'),
      'bindings:\n  - context: Chat\n    bindings:\n      enter: chat:newline\n',
    )
    const user = await readUserBindings(home)
    const resolve = buildResolver(user)
    expect(resolve('', { ...k(), return: true }, 'Chat')).toBe('chat:newline')
  })

  it('absent file returns null user bindings → defaults apply', async () => {
    const home = mkdtempSync(join(os.tmpdir(), 'nuka-kb-int-'))
    const user = await readUserBindings(home)
    expect(user).toBeNull()
    const resolve = buildResolver(user)
    expect(resolve('', { ...k(), return: true }, 'Chat')).toBe('chat:submit')
  })
})
```

**Run failing:** `npx vitest run test/core/keybindings/promptInputIntegration.test.tsx`

**Implement** — edit `/data/xtzhang/Nuka/src/tui/PromptInput/PromptInput.tsx`:

1. At the top of the file add:
```ts
import {
  buildResolver,
  readUserBindings,
  type KeybindingResolver,
  type KeybindingAction,
  type KeybindingContext,
} from '../../core/keybindings'
import { homedir } from 'node:os'
```

2. Inside `PromptInput`, right after `const history = useInputHistory()` add:
```ts
const [resolver, setResolver] = useState<KeybindingResolver | null>(null)
useEffect(() => {
  if (process.env.NUKA_KEYBINDINGS !== '1') {
    setResolver(null)
    return
  }
  let cancelled = false
  void readUserBindings(homedir())
    .then(user => { if (!cancelled) setResolver(() => buildResolver(user)) })
    .catch(() => { if (!cancelled) setResolver(() => buildResolver(null)) })
  return () => { cancelled = true }
}, [])
```

3. Inside the `useInput((input, key) => { ... })` callback, immediately after the `props.onUserInput?.()` line (currently around line 246) insert this env-gated dispatch block:
```ts
if (resolver) {
  const ctx: KeybindingContext = mention.isOpen
    ? 'Mention'
    : slashActive
      ? 'Slash'
      : props.vim && vimRef.current.buffer.mode !== 'insert'
        ? 'Vim'
        : 'Chat'
  const action: KeybindingAction | null = resolver(input, key, ctx)
  if (action !== null) {
    switch (action) {
      case 'chat:submit':
        if (props.value.trim()) {
          history.push(props.value)
          props.onSubmit(props.value)
        }
        return
      case 'chat:cancel':
        // Fall through to legacy escape handling (vim/mention/slash branches
        // own context-specific cancel semantics).
        break
      case 'history:previous': {
        const prev = history.prev(props.value)
        if (prev !== null) props.onChange(prev)
        return
      }
      case 'history:next': {
        const next = history.next()
        if (next !== null) props.onChange(next)
        return
      }
      case 'mention:dismiss':
        mention.dismiss()
        return
      case 'mention:previous': mention.moveSelection(-1); return
      case 'mention:next':     mention.moveSelection(1);  return
      case 'mention:focusTypes':   mention.focusTypes();   return
      case 'mention:focusResults': mention.focusResults(); return
      case 'mention:accept':       acceptMention();        return
      case 'slash:dismiss':        props.onChange('');     return
      case 'slash:previous':
        setSlashCursor(c => Math.max(0, c - 1))
        return
      case 'slash:next':
        setSlashCursor(c => Math.min(slashCandidates.length - 1, c + 1))
        return
      case 'slash:accept': {
        const chosen = slashCandidates[slashCursor]
        if (chosen) props.onChange('/' + chosen.name + ' ')
        return
      }
      case 'vim:escape':
        applyVimKey({ kind: 'esc' })
        return
      case 'chat:newline':
        // Legacy path appends newline via the normal-mode `input` branch
        // when shift+enter or similar reaches here; fall through.
        break
    }
  }
  // No match — fall through to the legacy branches below unchanged.
}
```

**Run passing:** `npx vitest run test/core/keybindings/promptInputIntegration.test.tsx && npx vitest run test/tui && npx tsc --noEmit`

**Commit:** `feat(keybindings): wire env-gated resolver into PromptInput`

---

## Self-review (do this before opening a PR)

- [ ] Every `KEYBINDING_ACTIONS` entry has a `switch` case in PromptInput (or an intentional `break` to fall through).
- [ ] `NUKA_KEYBINDINGS` unset → resolver is null → no behavior change vs. main.
- [ ] `npx tsc --noEmit` clean (no `any`, no `@ts-ignore` introduced).
- [ ] `npx vitest run test/core/keybindings` all green.
- [ ] `npx vitest run test/tui` still green (no legacy regressions).
- [ ] No new npm dependencies in `package.json`.
- [ ] No `Co-Authored-By:` lines in any commit message.
