// test/ui-auto/fixtures/iter-16-onboarding-error-cjk-message.fixtures.tsx
//
// Iter-16 sweep: onboarding verification error message at narrow viewports.
//
// Coverage rationale:
//   Wizard's ErrorScreen caps provider error text with code-unit length and
//   slice(). A CJK-heavy error message must be bounded by terminal display
//   width and show an ellipsis instead of wrapping inside the error frame.

import React from 'react'
import { Wizard } from '../../../src/tui/Onboarding/Wizard'
import type { WizardState } from '../../../src/core/onboarding/wizard'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const initial: WizardState = {
  kind: 'error',
  message: '一'.repeat(140),
  retryFrom: 'apiKey',
}

const fixture: FixtureDef = {
  component: 'OnboardingErrorCjkMessage',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-error-message-truncates-by-display-width': {
      render: () => (
        <Wizard
          initial={initial}
          onDone={() => {}}
          onCancel={() => {}}
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
