// test/ui-auto/fixtures/iter-20-messages-live-transcript.fixtures.tsx
//
// Iter-20 regression fixture for the main chat transcript. The bug was hidden
// by ink-testing-library debug mode: completed turns were moved to Ink
// <Static>, so real terminals sent them to scrollback while the live viewport
// only showed the newest turn.

import React from 'react'
import { Text } from 'ink'
import { Messages } from '../../../src/tui/Messages/Messages'
import type { Message } from '../../../src/core/message/types'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

function userMsg(id: string, text: string): Message {
  return { role: 'user', id, ts: 1, content: [{ type: 'text', text }] }
}

const turns: Message[] = [
  userMsg('u1', 'first-live-turn'),
  userMsg('u2', 'second-live-turn'),
  userMsg('u3', 'third-live-turn'),
  userMsg('u4', 'fourth-live-turn'),
  userMsg('u5', 'fifth-live-turn'),
]

const fixture: FixtureDef = {
  component: 'MessagesLiveTranscript',
  viewports: [
    { cols: 80, rows: 24 },
    { cols: 100, rows: 30 },
  ],
  cases: {
    'previous-turns-remain-live-after-send': {
      render: () => (
        <Messages
          items={turns}
          streaming={null}
          prologue={<Text>WELCOME-HERO-MARKER</Text>}
          availableRows={20}
        />
      ),
      mustContain: [
        'first-live-turn',
        'second-live-turn',
        'third-live-turn',
        'fourth-live-turn',
        'fifth-live-turn',
      ],
    },
  },
}

export default fixture
