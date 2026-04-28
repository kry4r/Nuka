// src/core/theme/themes.ts
// Phase 12 M1 — 12-key semantic palette (spec §4.9).
//
// ThemeColors now uses 12 semantic keys plus bg / bgPanel.
// The old free-form keys (accent, plan, permission, userMsg, assistantMsg,
// diffAdd, diffDel, agent) are removed; every call site has migrated to
// the new names.

export type ThemeColors = {
  // ── Primary brand (avocado green) ──────────────────────────────────────
  primary: string      // focused frame, logo, selected highlight
  primaryDeep: string  // pressed/active, progress filled
  primarySoft: string  // soft primary, secondary frame highlight, user-msg label

  // ── Accent family ──────────────────────────────────────────────────────
  accentWarm: string   // running tasks, vim mode badge
  accentCool: string   // subagents, plan numbering, tool-call headers
  accentInfo: string   // hints, group dividers, footer keys

  // ── Status semantics ───────────────────────────────────────────────────
  success: string      // done / ok
  warn: string         // primed-quit, dirty git, killed task
  error: string        // failed, denied, validation error

  // ── Foreground scale ───────────────────────────────────────────────────
  fg: string           // primary text
  fgMuted: string      // descriptions, placeholders, unfocused frame border
  fgFaint: string      // timestamps, tokens, distant scrollback

  // ── Background ─────────────────────────────────────────────────────────
  bg: string           // terminal background (transparent / empty string)
  bgPanel: string      // submenu/slash card subtle background
}

export type Theme = {
  name: string
  colors: ThemeColors
}

// ---------------------------------------------------------------------------
// Seed themes
// ---------------------------------------------------------------------------

// default-dark: avocado-rooted palette per spec §4.9 verbatim.
const defaultDark: Theme = {
  name: 'default-dark',
  colors: {
    primary:     '#8FBF3F',
    primaryDeep: '#6B9A2E',
    primarySoft: '#B6D77A',
    accentWarm:  '#E0A23C',
    accentCool:  '#5FA8A8',
    accentInfo:  '#7C9CC4',
    success:     '#5FB370',
    warn:        '#D98E3C',
    error:       '#D5604E',
    fg:          '#E6E4D9',
    fgMuted:     '#7A7A6A',
    fgFaint:     '#5A5A4E',
    bg:          '',
    bgPanel:     '#1B1F12',
  },
}

// default-light: only fg/fgMuted/fgFaint/bg/bgPanel change; semantics stay
// identical so brand identity holds (spec §4.9, §5.4).
const defaultLight: Theme = {
  name: 'default-light',
  colors: {
    ...defaultDark.colors,
    fg:      '#2C2C22',
    fgMuted: '#6B6B5A',
    fgFaint: '#9A9A84',
    bg:      '',
    bgPanel: '#F4F1E4',
  },
}

// solarized-dark: keeps its identity; all 12 keys populated.
const solarizedDark: Theme = {
  name: 'solarized-dark',
  colors: {
    primary:     '#859900',
    primaryDeep: '#6C7A00',
    primarySoft: '#A8B840',
    accentWarm:  '#CB4B16',
    accentCool:  '#268BD2',
    accentInfo:  '#2AA198',
    success:     '#859900',
    warn:        '#B58900',
    error:       '#DC322F',
    fg:          '#839496',
    fgMuted:     '#586E75',
    fgFaint:     '#3D4F52',
    bg:          '',
    bgPanel:     '#002B36',
  },
}

// solarized-light: same semantic palette as solarized-dark; only
// fg/fgMuted/fgFaint/bg/bgPanel remapped.
const solarizedLight: Theme = {
  name: 'solarized-light',
  colors: {
    ...solarizedDark.colors,
    fg:      '#657B83',
    fgMuted: '#93A1A1',
    fgFaint: '#C1CAC9',
    bg:      '',
    bgPanel: '#FDF6E3',
  },
}

// high-contrast: vivid palette for accessibility; all 12 keys populated.
const highContrast: Theme = {
  name: 'high-contrast',
  colors: {
    primary:     '#00FF00',
    primaryDeep: '#00CC00',
    primarySoft: '#66FF66',
    accentWarm:  '#FF8C00',
    accentCool:  '#00FFFF',
    accentInfo:  '#00BFFF',
    success:     '#00FF00',
    warn:        '#FFFF00',
    error:       '#FF0000',
    fg:          '#FFFFFF',
    fgMuted:     '#AAAAAA',
    fgFaint:     '#666666',
    bg:          '',
    bgPanel:     '#000000',
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
