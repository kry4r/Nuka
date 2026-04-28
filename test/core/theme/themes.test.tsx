// test/core/theme/themes.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { listThemes, findTheme, resolveTheme, defaultDark } from '../../../src/core/theme/themes'
import { ThemeProvider, useTheme } from '../../../src/core/theme/context'
import type { ThemeColors } from '../../../src/core/theme/themes'

// The 12 semantic keys + bg + bgPanel that every seed theme must expose.
const REQUIRED_KEYS: Array<keyof ThemeColors> = [
  'primary', 'primaryDeep', 'primarySoft',
  'accentWarm', 'accentCool', 'accentInfo',
  'success', 'warn', 'error',
  'fg', 'fgMuted', 'fgFaint',
  'bg', 'bgPanel',
]

describe('theme registry', () => {
  it('exports exactly five seed themes', () => {
    const themes = listThemes()
    expect(themes).toHaveLength(5)
    const names = themes.map(t => t.name)
    expect(names).toContain('default-dark')
    expect(names).toContain('default-light')
    expect(names).toContain('solarized-dark')
    expect(names).toContain('solarized-light')
    expect(names).toContain('high-contrast')
  })

  it('findTheme returns the correct theme', () => {
    const t = findTheme('solarized-dark')
    expect(t).toBeDefined()
    expect(t!.name).toBe('solarized-dark')
  })

  it('findTheme is case-insensitive', () => {
    expect(findTheme('Default-Dark')).toBeDefined()
    expect(findTheme('DEFAULT-DARK')?.name).toBe('default-dark')
  })

  it('findTheme returns undefined for unknown names', () => {
    expect(findTheme('does-not-exist')).toBeUndefined()
  })

  it('resolveTheme falls back to default-dark for unknown names', () => {
    const t = resolveTheme('unknown-theme')
    expect(t.name).toBe('default-dark')
  })

  it('resolveTheme returns the requested theme when found', () => {
    const t = resolveTheme('high-contrast')
    expect(t.name).toBe('high-contrast')
    expect(t.colors.fg).toBe('#FFFFFF')
  })

  it('all seed themes expose all 14 required keys (12 semantic + bg + bgPanel) as non-empty strings', () => {
    const nonBgKeys = REQUIRED_KEYS.filter(k => k !== 'bg')
    for (const theme of listThemes()) {
      for (const key of nonBgKeys) {
        const val = theme.colors[key]
        expect(typeof val, `${theme.name}.${key} should be string`).toBe('string')
        expect((val as string).length, `${theme.name}.${key} should be non-empty`).toBeGreaterThan(0)
      }
      // bg is allowed to be an empty string (transparent terminal background)
      expect(typeof theme.colors.bg, `${theme.name}.bg should be string`).toBe('string')
    }
  })

  it('default-dark uses the avocado primary hex from spec §4.9', () => {
    expect(defaultDark.colors.primary).toBe('#8FBF3F')
  })

  it('default-light only differs from default-dark in the five fg/bg keys', () => {
    const light = findTheme('default-light')!
    const dark = findTheme('default-dark')!
    const semanticKeys: Array<keyof ThemeColors> = [
      'primary', 'primaryDeep', 'primarySoft',
      'accentWarm', 'accentCool', 'accentInfo',
      'success', 'warn', 'error',
    ]
    for (const key of semanticKeys) {
      expect(light.colors[key], `light.${key} should equal dark.${key}`).toBe(dark.colors[key])
    }
  })

  it('solarized-light only differs from solarized-dark in the five fg/bg keys', () => {
    const light = findTheme('solarized-light')!
    const dark = findTheme('solarized-dark')!
    const semanticKeys: Array<keyof ThemeColors> = [
      'primary', 'primaryDeep', 'primarySoft',
      'accentWarm', 'accentCool', 'accentInfo',
      'success', 'warn', 'error',
    ]
    for (const key of semanticKeys) {
      expect(light.colors[key], `solarized-light.${key} should equal solarized-dark.${key}`).toBe(dark.colors[key])
    }
  })
})

describe('ThemeProvider + useTheme', () => {
  function ThemeConsumer(): React.JSX.Element {
    const theme = useTheme()
    return <Text>{theme.name}</Text>
  }

  it('useTheme returns the provided theme', () => {
    const { lastFrame } = render(
      <ThemeProvider theme={{ name: 'solarized-dark', colors: defaultDark.colors }}>
        <ThemeConsumer />
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('solarized-dark')
  })

  it('useTheme returns default-dark when no provider is mounted', () => {
    const { lastFrame } = render(<ThemeConsumer />)
    expect(lastFrame()).toContain('default-dark')
  })

  it('nested providers override the outer theme', () => {
    function Inner(): React.JSX.Element {
      const theme = useTheme()
      return <Text>inner:{theme.name}</Text>
    }
    const innerTheme = { name: 'high-contrast', colors: defaultDark.colors }
    const { lastFrame } = render(
      <ThemeProvider theme={{ name: 'default-light', colors: defaultDark.colors }}>
        <ThemeProvider theme={innerTheme}>
          <Inner />
        </ThemeProvider>
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('inner:high-contrast')
  })
})
