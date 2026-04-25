// src/core/theme/context.tsx
// Phase 8 §4.1 — ThemeProvider + useTheme hook.
//
// Wraps the application (or any subtree) in a React context that exposes the
// active Theme.  Components call `useTheme()` to obtain the color tokens
// without prop-drilling.

import React, { createContext, useContext } from 'react'
import { defaultDark, type Theme } from './themes'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<Theme>(defaultDark)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type ThemeProviderProps = {
  theme: Theme
  children: React.ReactNode
}

/**
 * Provide a `Theme` to all descendant components.  Place it at the top of the
 * React tree (wrapping `<App />`).
 */
export function ThemeProvider({ theme, children }: ThemeProviderProps): React.JSX.Element {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the active theme.  Falls back to `default-dark` when used outside a
 * `<ThemeProvider>` (e.g. in legacy unit tests that don't mount the provider).
 */
export function useTheme(): Theme {
  return useContext(ThemeContext)
}
