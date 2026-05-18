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
