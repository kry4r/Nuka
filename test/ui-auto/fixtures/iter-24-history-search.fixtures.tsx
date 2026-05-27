// test/ui-auto/fixtures/iter-24-history-search.fixtures.tsx

import React from 'react'
import { SessionList } from '../../../src/tui/History/SessionList'
import type { HistoryListEntry, SessionId } from '../../../src/core/session/history/types'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

function entry(over: Partial<HistoryListEntry>): HistoryListEntry {
  return {
    id: 'auth0001' as SessionId,
    providerId: 'openai',
    model: 'gpt-5',
    messageCount: 8,
    preview: 'AUTH BUG in login middleware',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  }
}

const fixture: FixtureDef = {
  component: 'HistorySearch',
  viewports: [
    { cols: 80, rows: 18 },
    { cols: 48, rows: 14 },
  ],
  cases: {
    'search-results': {
      render: () => (
        <SessionList
          entries={[
            entry({ id: 'auth0001' as SessionId }),
            entry({ id: 'auth0002' as SessionId, preview: 'auth bug notes and rollback steps' }),
          ]}
          loading={false}
          query="auth bug"
          onResume={() => {}}
          onDelete={() => {}}
          onCancel={() => {}}
        />
      ),
      mustContain: ['Search: auth bug', '2 results', 'AUTH BUG'],
    },
    'search-empty': {
      render: () => (
        <SessionList
          entries={[]}
          loading={false}
          query="missing"
          onResume={() => {}}
          onDelete={() => {}}
          onCancel={() => {}}
        />
      ),
      mustContain: ['Search: missing', '0 results', 'No matching sessions.'],
    },
  },
}

export default fixture
