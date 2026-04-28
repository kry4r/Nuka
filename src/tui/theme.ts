// src/tui/theme.ts
// Phase 12 M1 — Palette is now an alias for ThemeColors (12 semantic keys +
// bg + bgPanel).  `defaultPalette` is the static default-dark fallback used
// by components that import it directly.  Components that need the live
// active-theme palette should use `useColors()` from the theme context.

import type { ThemeColors } from '../core/theme/themes'
import { defaultDark } from '../core/theme/themes'

export type Palette = ThemeColors

/** Static fallback palette (default-dark).  Use `useColors()` for live theming. */
export const defaultPalette: Palette = defaultDark.colors

/**
 * Merge two palettes; the override takes precedence for keys it supplies.
 * Kept for backwards-compatibility with any future theme-override needs.
 */
export function mergePalette(
  base: Palette,
  override?: Partial<Palette>,
): Palette {
  return { ...base, ...(override ?? {}) }
}
