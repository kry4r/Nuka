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
