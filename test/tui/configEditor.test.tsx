// test/tui/configEditor.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { ConfigEditor } from '../../src/tui/dialogs/ConfigEditor'

describe('ConfigEditor', () => {
  it('renders the yaml preview and hint to open $EDITOR', () => {
    const { lastFrame } = render(
      <ConfigEditor
        configPath="/home/x/.nuka/config.yaml"
        preview="providers: []\nactive: { providerId: '' }"
        onOpen={() => {}}
        onClose={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('/home/x/.nuka/config.yaml')
    expect(f).toContain('providers: []')
    expect(f).toMatch(/editor/i)
  })
})
