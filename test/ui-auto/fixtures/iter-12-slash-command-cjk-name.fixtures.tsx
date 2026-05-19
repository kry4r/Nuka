// test/ui-auto/fixtures/iter-12-slash-command-cjk-name.fixtures.tsx
//
// Iter-12 sweep: Slash command list plugin name at narrow viewports.
//
// Coverage rationale:
//   CommandList truncates plugin-supplied command names with code-unit length
//   and pads them with string length. A CJK-heavy name must be bounded by
//   terminal display width and show an ellipsis inside the SlashCard row.

import React from 'react'
import { CommandList } from '../../../src/tui/SlashCard/CommandList'
import type { SlashCommand } from '../../../src/slash/types'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const commands: SlashCommand[] = [
  {
    name: '一'.repeat(8),
    description: 'short description',
    source: 'plugin',
    async run() {
      return { type: 'text', text: '' }
    },
  },
]

const fixture: FixtureDef = {
  component: 'SlashCommandCjkName',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-name-truncates-by-display-width': {
      render: () => (
        <CommandList
          commands={commands}
          selectedIndex={0}
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
