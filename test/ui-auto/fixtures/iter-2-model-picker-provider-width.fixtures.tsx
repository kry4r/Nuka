// test/ui-auto/fixtures/iter-2-model-picker-provider-width.fixtures.tsx
//
// Iter-2 sweep: ModelPicker provider-list frame capture at narrow widths.
//
// Coverage rationale:
//   The providers stage renders user-configured provider names and base URLs.
//   These strings can be much longer than a narrow terminal, so the row must
//   be constrained by the same stdout width the explorer provides. Otherwise a
//   modal opened from the TUI can bleed past the viewport before the user even
//   drills into the model list.
//
//   The stage also has a deliberate blank spacer above its footer. The explorer
//   must preserve that blank row as part of the frame, not split the frame at
//   the blank line and keep only the footer.

import React from 'react'
import { ModelPicker } from '../../../src/tui/dialogs/ModelPicker'
import type { ProviderConfig } from '../../../src/core/config/schema'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const providers: ProviderConfig[] = [
  {
    id: 'very-long-provider',
    name: 'Enterprise Gateway With A Very Long Display Name',
    format: 'openai',
    baseUrl:
      'https://gateway.example.com/openai-compatible/v1/departments/research/regions/us-west-2/projects/nuka-terminal-rendering',
    models: ['mimo-v2-omni'],
    selectedModel: 'mimo-v2-omni',
  },
  {
    id: 'local',
    name: 'Local',
    format: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['local-small'],
  },
]

const noop = () => {}
const noopAsync = async () => {}

const fixture: FixtureDef = {
  component: 'ModelPickerProviderWidth',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
    { cols: 79, rows: 24 },
  ],
  cases: {
    'long-provider-url-stays-inside-viewport': {
      render: () => (
        <ModelPicker
          providers={providers}
          activeProviderId="very-long-provider"
          activeModel="mimo-v2-omni"
          onSave={noopAsync}
          onSelect={noop}
          onAddProvider={noop}
          onFetchRemote={async () => ['mimo-v2-omni']}
          onCancel={noop}
        />
      ),
      mustContain: ['Select provider', 'Add provider'],
    },
  },
}

export default fixture
