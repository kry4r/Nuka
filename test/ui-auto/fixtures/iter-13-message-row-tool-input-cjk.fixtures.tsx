// test/ui-auto/fixtures/iter-13-message-row-tool-input-cjk.fixtures.tsx
//
// Iter-13 sweep: generic tool-use input summary at narrow viewports.
//
// Coverage rationale:
//   MessageRow summarizes non-dispatch tool input before handing it to
//   ToolCall. A CJK-heavy JSON input must be bounded by terminal display
//   width and show an ellipsis instead of relying on code-unit length.

import React from 'react'
import { MessageRow } from '../../../src/tui/Messages/MessageRow'
import type { AssistantMessage } from '../../../src/core/message/types'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const message: AssistantMessage = {
  role: 'assistant',
  id: 'a-iter-13-tool-input',
  ts: 0,
  content: [
    {
      type: 'tool_use',
      id: 'tu-iter-13',
      name: 'Read',
      input: { path: '一'.repeat(38) },
    },
  ],
}

const fixture: FixtureDef = {
  component: 'MessageRowToolInputCjk',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-tool-input-summary-truncates-by-display-width': {
      render: () => <MessageRow m={message} />,
      mustContain: ['…'],
    },
  },
}

export default fixture
