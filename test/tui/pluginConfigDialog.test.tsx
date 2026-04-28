import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { PluginConfigDialog } from '../../src/tui/dialogs/PluginConfigDialog'
import type { LoadedPlugin, PluginUserConfigField } from '../../src/core/plugin/manifest'

function makePlugin(overrides?: Partial<LoadedPlugin['manifest']>): LoadedPlugin {
  return {
    manifest: {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      tools: [],
      slashCommands: [],
      skills: [],
      ...overrides,
    },
    rootDir: '/tmp/test-plugin',
    source: 'installed',
  }
}

const tokenField: PluginUserConfigField = {
  name: 'token',
  type: 'string',
  description: 'API token',
  required: true,
}

const portField: PluginUserConfigField = {
  name: 'port',
  type: 'number',
  description: 'Port number',
  default: 8080,
}

describe('PluginConfigDialog', () => {
  it('renders plugin name and description', () => {
    const { lastFrame } = render(
      <PluginConfigDialog
        plugin={makePlugin()}
        fields={[tokenField]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('test-plugin@1.0.0')
    expect(f).toContain('A test plugin')
  })

  it('renders field names and descriptions', () => {
    const { lastFrame } = render(
      <PluginConfigDialog
        plugin={makePlugin()}
        fields={[tokenField, portField]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('token')
    expect(f).toContain('API token')
    expect(f).toContain('port')
    expect(f).toContain('Port number')
  })

  it('marks required fields with *', () => {
    const { lastFrame } = render(
      <PluginConfigDialog
        plugin={makePlugin()}
        fields={[tokenField]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('token *')
  })

  it('shows type hint in output', () => {
    const { lastFrame } = render(
      <PluginConfigDialog
        plugin={makePlugin()}
        fields={[tokenField]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('(string)')
  })

  it('shows hint line with keyboard shortcuts', () => {
    const { lastFrame } = render(
      <PluginConfigDialog
        plugin={makePlugin()}
        fields={[tokenField]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('⏎ save')
    expect(f).toContain('esc skip plugin')
  })

  it('pressing enter calls onSubmit with string value', () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      <PluginConfigDialog
        plugin={makePlugin()}
        fields={[tokenField]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    stdin.write('mytoken')
    stdin.write('\r')
    expect(onSubmit).toHaveBeenCalledWith({ token: 'mytoken' })
  })

  it('pressing enter coerces number type', () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      <PluginConfigDialog
        plugin={makePlugin()}
        fields={[{ name: 'count', type: 'number' }]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    stdin.write('42')
    stdin.write('\r')
    expect(onSubmit).toHaveBeenCalledWith({ count: 42 })
  })

  it('pressing escape calls onCancel', async () => {
    const onCancel = vi.fn()
    const { stdin } = render(
      <PluginConfigDialog
        plugin={makePlugin()}
        fields={[tokenField]}
        onSubmit={() => {}}
        onCancel={onCancel}
      />,
    )
    stdin.write('\u001B') // ESC
    // ink debounces escape a few ms to disambiguate from CSI sequences
    await new Promise(r => setTimeout(r, 100))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows (no configuration fields) when fields is empty', () => {
    const { lastFrame } = render(
      <PluginConfigDialog
        plugin={makePlugin()}
        fields={[]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('no configuration fields')
  })

  it('renders plugin without version', () => {
    const { lastFrame } = render(
      <PluginConfigDialog
        plugin={makePlugin({ version: undefined })}
        fields={[tokenField]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    // Should not show @ if no version
    expect(f).toContain('test-plugin')
    expect(f).not.toContain('test-plugin@')
  })
})
