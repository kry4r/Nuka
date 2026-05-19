// test/ui-auto/fixtures/iter-5-plugin-config-cjk-value.fixtures.tsx
//
// Iter-5 sweep: PluginConfigDialog value row at narrow widths.
//
// Coverage rationale:
//   PluginConfigDialog renders default user-config values in a fixed-width
//   field row. A CJK-heavy default must be display-width truncated with a
//   visible ellipsis at narrow explorer viewports.

import React from 'react'
import { PluginConfigDialog } from '../../../src/tui/dialogs/PluginConfigDialog'
import type { LoadedPlugin, PluginUserConfigField } from '../../../src/core/plugin/manifest'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const plugin: LoadedPlugin = {
  manifest: {
    name: 'cjk-config-plugin',
    version: '1.0.0',
    description: 'Needs a narrow config value row',
    tools: [],
    slashCommands: [],
    skills: [],
  },
  rootDir: '/tmp/cjk-config-plugin',
  source: 'session',
  dir: '/tmp/cjk-config-plugin',
}

const fields: PluginUserConfigField[] = [
  {
    name: 'token',
    type: 'string',
    description: 'CJK token',
    default: '一'.repeat(40),
    required: true,
  },
]

const fixture: FixtureDef = {
  component: 'PluginConfigCjkValue',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-default-value-truncates-by-display-width': {
      render: () => (
        <PluginConfigDialog
          plugin={plugin}
          fields={fields}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
