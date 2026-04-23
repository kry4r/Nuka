// src/tui/theme.ts
export type Palette = {
  primary: string
  accent: string
  fg: string
  muted: string
  warn: string
  error: string
  success: string
}

export const defaultPalette: Palette = {
  primary: '#A3BE8C',
  accent: '#6E8759',
  fg: '#D8DEE9',
  muted: '#4C566A',
  warn: '#EBCB8B',
  error: '#BF616A',
  success: '#A3BE8C',
}

export function mergePalette(
  base: Palette,
  override?: Partial<Palette>,
): Palette {
  return { ...base, ...(override ?? {}) }
}
