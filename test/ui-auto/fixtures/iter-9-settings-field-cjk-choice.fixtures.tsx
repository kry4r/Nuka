// test/ui-auto/fixtures/iter-9-settings-field-cjk-choice.fixtures.tsx
//
// Iter-9 sweep: Settings Field list choice text at narrow viewports.
//
// Coverage rationale:
//   Field list rows currently cap choice text with choice.length + slice().
//   A long CJK choice must be display-width truncated inside the list row
//   and show an ellipsis, not overflow the viewport or cut by code units.

import React from 'react'
import { Field } from '../../../src/tui/Submenu/settings/Field'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'SettingsFieldCjkChoice',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-list-choice-truncates-by-display-width': {
      render: () => (
        <Field
          type="list"
          label="Enabled skills"
          value={[]}
          choices={['一'.repeat(80)]}
          descriptions={[]}
          focused={false}
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
