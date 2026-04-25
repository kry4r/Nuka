// test/core/theme/themes.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { listThemes, findTheme, resolveTheme, defaultDark } from '../../../src/core/theme/themes'
import { ThemeProvider, useTheme } from '../../../src/core/theme/context'

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

  it('all themes have the required color tokens', () => {
    const requiredKeys: Array<keyof typeof defaultDark.colors> = [
      'fg', 'bg', 'muted', 'accent', 'success', 'warn', 'error',
      'plan', 'permission', 'userMsg', 'assistantMsg', 'diffAdd', 'diffDel',
    ]
    for (const theme of listThemes()) {
      for (const key of requiredKeys) {
        expect(typeof theme.colors[key], `${theme.name}.${key}`).toBe('string')
      }
      expect(typeof theme.colors.agent.primary).toBe('string')
      expect(typeof theme.colors.agent.alt).toBe('string')
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
