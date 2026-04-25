// src/core/theme/themes.ts
// Phase 8 §4.1 — theme registry.
//
// A Theme is a flat map of named color tokens. Five seed themes ship with
// Nuka; additional themes may be added by plugins in a later phase.

export type ThemeColors = {
  fg: string
  bg: string
  muted: string
  accent: string
  success: string
  warn: string
  error: string
  plan: string
  permission: string
  userMsg: string
  assistantMsg: string
  diffAdd: string
  diffDel: string
  agent: { primary: string; alt: string }
}

export type Theme = {
  name: string
  colors: ThemeColors
}

// ---------------------------------------------------------------------------
// Seed themes
// ---------------------------------------------------------------------------

const defaultDark: Theme = {
  name: 'default-dark',
  colors: {
    fg: '#D8DEE9',
    bg: '#2E3440',
    muted: '#4C566A',
    accent: '#88C0D0',
    success: '#A3BE8C',
    warn: '#EBCB8B',
    error: '#BF616A',
    plan: '#81A1C1',
    permission: '#D08770',
    userMsg: '#D8DEE9',
    assistantMsg: '#A3BE8C',
    diffAdd: '#A3BE8C',
    diffDel: '#BF616A',
    agent: { primary: '#88C0D0', alt: '#5E81AC' },
  },
}

const defaultLight: Theme = {
  name: 'default-light',
  colors: {
    fg: '#2E3440',
    bg: '#ECEFF4',
    muted: '#9E9E9E',
    accent: '#5E81AC',
    success: '#4C7A34',
    warn: '#B45309',
    error: '#9B1C1C',
    plan: '#1565C0',
    permission: '#C65D00',
    userMsg: '#2E3440',
    assistantMsg: '#2D6A4F',
    diffAdd: '#4C7A34',
    diffDel: '#9B1C1C',
    agent: { primary: '#5E81AC', alt: '#4C566A' },
  },
}

const solarizedDark: Theme = {
  name: 'solarized-dark',
  colors: {
    fg: '#839496',
    bg: '#002B36',
    muted: '#586E75',
    accent: '#268BD2',
    success: '#859900',
    warn: '#B58900',
    error: '#DC322F',
    plan: '#2AA198',
    permission: '#CB4B16',
    userMsg: '#839496',
    assistantMsg: '#859900',
    diffAdd: '#859900',
    diffDel: '#DC322F',
    agent: { primary: '#268BD2', alt: '#2AA198' },
  },
}

const solarizedLight: Theme = {
  name: 'solarized-light',
  colors: {
    fg: '#657B83',
    bg: '#FDF6E3',
    muted: '#93A1A1',
    accent: '#268BD2',
    success: '#859900',
    warn: '#B58900',
    error: '#DC322F',
    plan: '#2AA198',
    permission: '#CB4B16',
    userMsg: '#657B83',
    assistantMsg: '#859900',
    diffAdd: '#859900',
    diffDel: '#DC322F',
    agent: { primary: '#268BD2', alt: '#2AA198' },
  },
}

const highContrast: Theme = {
  name: 'high-contrast',
  colors: {
    fg: '#FFFFFF',
    bg: '#000000',
    muted: '#AAAAAA',
    accent: '#00FFFF',
    success: '#00FF00',
    warn: '#FFFF00',
    error: '#FF0000',
    plan: '#00BFFF',
    permission: '#FF8C00',
    userMsg: '#FFFFFF',
    assistantMsg: '#00FF00',
    diffAdd: '#00FF00',
    diffDel: '#FF0000',
    agent: { primary: '#00FFFF', alt: '#FF00FF' },
  },
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const ALL_THEMES: readonly Theme[] = [
  defaultDark,
  defaultLight,
  solarizedDark,
  solarizedLight,
  highContrast,
]

/** Returns all registered themes. */
export function listThemes(): readonly Theme[] {
  return ALL_THEMES
}

/**
 * Look up a theme by name (case-insensitive). Returns `undefined` when not
 * found — callers should fall back to `default-dark`.
 */
export function findTheme(name: string): Theme | undefined {
  return ALL_THEMES.find(t => t.name === name.toLowerCase())
}

/**
 * Resolve a theme by name, falling back to `default-dark` with a warning
 * emitted to stderr when the name is unrecognised.
 */
export function resolveTheme(name: string): Theme {
  const found = findTheme(name)
  if (!found) {
    process.stderr.write(`[nuka] theme "${name}" not found — falling back to default-dark\n`)
    return defaultDark
  }
  return found
}

export { defaultDark }
