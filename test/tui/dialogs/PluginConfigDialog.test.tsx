// test/tui/dialogs/PluginConfigDialog.test.tsx
//
// Border-overflow audit (pass 2): values, descriptions and labels rendered
// inside the dialog's bordered Box must respect terminal width so long
// file paths / JSON strings don't bleed through the right border.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { PluginConfigDialog } from '../../../src/tui/dialogs/PluginConfigDialog'
import type { LoadedPlugin, PluginUserConfigField } from '../../../src/core/plugin/manifest'

function makePlugin(name: string, description?: string): LoadedPlugin {
  return {
    manifest: {
      name,
      version: '0.0.1',
      description,
      tools: [],
      slashCommands: [],
      skills: [],
    },
    rootDir: '/tmp/' + name,
    source: 'session',
    dir: '/tmp/' + name,
  }
}

describe('PluginConfigDialog — border overflow', () => {
  it('contains pathological field values within column-aware width', () => {
    const orig = process.stdout.columns
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
    try {
      const url = 'https://very-long-host.example.com/' + 'a'.repeat(300)
      const huge = 'x'.repeat(5000)
      const fields: PluginUserConfigField[] = [
        { name: 'apiKey', type: 'string', description: huge, default: url, required: true },
        { name: 'endpoint', type: 'string', description: 'simple', default: huge },
      ]
      const { lastFrame } = render(
        <PluginConfigDialog
          plugin={makePlugin('long-plugin-name', huge)}
          fields={fields}
          onSubmit={() => {}}
          onCancel={() => {}}
        />,
      )
      const f = stripAnsi(lastFrame() ?? '')
      const maxLine = Math.max(...f.split('\n').map(s => s.length))
      expect(maxLine).toBeLessThanOrEqual(60)
    } finally {
      Object.defineProperty(process.stdout, 'columns', { value: orig, configurable: true })
    }
  })

  it('renders the plugin name in the header', () => {
    const { lastFrame } = render(
      <PluginConfigDialog
        plugin={makePlugin('my-plugin')}
        fields={[]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('my-plugin')
  })
})
