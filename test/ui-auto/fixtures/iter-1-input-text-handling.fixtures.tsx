// test/ui-auto/fixtures/iter-1-input-text-handling.fixtures.tsx
//
// Iter-1 sweep: PromptInput text rendering across content variations.
//
// Coverage rationale:
//   PromptInput truncates long values at display time (keeps props.value intact).
//   Key paths: ASCII long line, CJK (width-2 chars), embedded CR/LF sanitization,
//   empty+placeholder, vim badge visible, disabled state.
//
// PromptInput uses useInput (Ink stdin) and useStdout (for column detection).
// Both are provided by renderWithViewport, so pure render with controlled
// `value` is safe — no keystroke sequences needed.
//
// mustContain drives noLossyTruncation on strings that MUST survive the
// truncation logic. We only check right-edge / tail text because PromptInput
// uses left-truncation (shows tail with a leading "…").

import React from 'react'
import { PromptInput } from '../../../src/tui/PromptInput/PromptInput'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const noop = () => {}

const fixture: FixtureDef = {
  component: 'PromptInputTextHandling',
  cases: {
    'empty-with-placeholder': {
      render: () => (
        <PromptInput
          value=""
          onChange={noop}
          onSubmit={noop}
          disabled={false}
          placeholder="Ask anything…"
        />
      ),
    },
    'short-value': {
      render: () => (
        <PromptInput
          value="hello world"
          onChange={noop}
          onSubmit={noop}
          disabled={false}
        />
      ),
      mustContain: ['hello world'],
    },
    'long-single-line-left-truncated': {
      // Value exceeds visibleBudget at all 7 viewports; the TAIL should
      // always be visible (left-truncation preserves tail). The last 12
      // chars are the sentinel we assert via mustContain.
      render: () => (
        <PromptInput
          value={'A'.repeat(200) + 'END-SENTINEL'}
          onChange={noop}
          onSubmit={noop}
          disabled={false}
        />
      ),
      mustContain: ['END-SENTINEL'],
    },
    'cjk-value': {
      // CJK chars are display-width 2. A sequence of 60 ideographs = 120
      // cols; at narrow viewports truncation must still surface the tail.
      // We assert the tail 4-char sentinel survives.
      render: () => (
        <PromptInput
          value={'一'.repeat(60) + '尾巴'}
          onChange={noop}
          onSubmit={noop}
          disabled={false}
        />
      ),
      mustContain: ['尾巴'],
    },
    'newline-sanitized-to-space': {
      // CR/LF embedded in value must be collapsed to spaces for display;
      // the component must not emit a multi-row input box. The trailing
      // "endline" token must survive (it's after the CR/LF so it's the
      // tail portion after sanitization).
      render: () => (
        <PromptInput
          value={'first line\nsecond line\r\nthird endline'}
          onChange={noop}
          onSubmit={noop}
          disabled={false}
        />
      ),
      mustContain: ['endline'],
    },
    'vim-mode-badge': {
      // vim=true renders [I] (insert mode badge); verify badge doesn't
      // overflow at narrow widths (CHROME budget bumps by 4 for the badge).
      render: () => (
        <PromptInput
          value="vim mode test"
          onChange={noop}
          onSubmit={noop}
          disabled={false}
          vim={true}
        />
      ),
      mustContain: ['vim mode test'],
    },
  },
}

export default fixture
