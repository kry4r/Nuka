// test/ui-auto/fixtures/iter-21-mention-preview-width.fixtures.tsx
//
// Iter-21 sweep: MentionPalette preview line at narrow widths.
//
// Coverage rationale:
//   The mention overlay caps result rows but the optional preview line is a
//   separate footer. A long file/URL preview must be bounded by the viewport
//   instead of bleeding past the terminal columns while the prompt is focused.

import React from 'react'
import { MentionPalette } from '../../../src/tui/promptMentions/MentionPalette'
import type { PromptMentionOption } from '../../../src/promptContextReferences/palette'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const options: PromptMentionOption[] = [
  {
    id: 'long-preview',
    type: 'file',
    label: 'src/promptContextReferences/palette.ts',
    exactMatch: false,
    prefixMatch: true,
    fuzzyScore: 10,
    recentScore: 0,
  },
]

const fixture: FixtureDef = {
  component: 'MentionPalettePreviewWidth',
  viewports: [
    { cols: 60, rows: 24 },
    { cols: 70, rows: 24 },
  ],
  cases: {
    'long-preview-stays-inside-viewport': {
      render: () => (
        <MentionPalette
          activeType="file"
          focusedPane="results"
          options={options}
          selectedIndex={0}
          preview={'preview: ' + 'src/'.repeat(20) + 'deeply/nested/file/with/a/very/long/name.tsx'}
        />
      ),
      mustContain: ['preview:', '…'],
    },
  },
}

export default fixture
