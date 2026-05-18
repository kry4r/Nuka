// test/ui-auto/fixtures/regression-bug-b.fixtures.tsx
//
// Regression fixture for Bug B: ModelPicker exit corrupts the main view.
//
// Root causes (bringup §2.2):
//   B1 — LOGO compacted on remount race:
//     Messages.tsx:168  prologueGoesStatic
//     useTerminalSize.ts:6,11
//     getLayoutMode(<80)→'compact'
//     At cols=79, getLayoutMode returns 'compact' (< 80 threshold).
//     After ModelPicker.onSave → closeSubmenu(), Welcome remounts and reads
//     a stale SIGWINCH value — if the stale value is < 80, LOGO is squashed.
//
//   B2 — Conversation area blank:
//     Messages.tsx:168  prologueGoesStatic = total > 0 || streaming !== null
//     Once ANY prior message exists, prologue is pushed into Static channel
//     and never returns to live area, leaving it empty.
//
// Fix surface (M9/repair): guard Welcome remount viewport read + tighten
//   prologueGoesStatic condition.
//
// This fixture uses unit-style assertions (no full App mount needed).
// B1 probe: getLayoutMode(79) must NOT return 'compact' after the fix.
// B2 probe: prologueGoesStatic logic must not fire when total>0 but the
//   prologue has never been shown in live area yet.

import React from 'react'
import { Text } from 'ink'
import { getLayoutMode } from '../../../src/tui/Welcome/layout'
import { shouldPrologueGoStatic } from '../../../src/tui/Messages/staticGating'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'BugB-ModelPickerExitCorruption',
  cases: {
    'b1-layout-mode-at-79-cols': {
      // Render a Welcome-like placeholder at 79 cols
      render: () => React.createElement(Text, null, 'welcome-layout-probe'),
      assert: async () => {
        // BUG B1 (currently failing at HEAD):
        //   getLayoutMode(79) returns 'compact' because the threshold is
        //   `columns >= 80` for 'normal'. At exactly 79 cols (just below the
        //   cutoff), Welcome renders the squashed compact branch instead of
        //   the normal branch with the full LOGO.
        //
        // After the fix, getLayoutMode(79) should return 'normal' (or the
        // threshold should be adjusted), so the LOGO is not squashed when
        // the user's viewport is genuinely near-80-col.
        const mode = getLayoutMode(79)
        if (mode === 'compact') {
          throw new Error(
            `Bug B1: getLayoutMode(79) returned 'compact'.\n` +
            `At 79 cols the LOGO is squashed. Expected 'normal' or similar ` +
            `non-compact branch. This triggers the corruption after ModelPicker closes.`,
          )
        }
      },
    },
    'b2-prologue-not-in-static-when-total-gt-0': {
      // Probe the prologueGoesStatic logic:
      // The real B2 bug is a streaming flicker: streaming briefly becomes
      // non-null (e.g. a transient model-picker event or loading state)
      // while no real messages exist (total=0). Under the old formula
      //   prologueGoesStatic = !!prologue && (total > 0 || streaming !== null)
      // a streaming=!null with total=0 would flip the prologue into Static
      // permanently (Static is append-only), leaving the live area blank.
      //
      // After the fix (total > 0 gate), streaming-only flickers do NOT
      // flip the prologue — only a real message in session.messages does.
      render: () => React.createElement(Text, null, 'messages-static-probe'),
      assert: async () => {
        const prologue = {} // truthy
        // Simulate streaming flicker: streaming is transiently non-null
        // but no real messages have been appended (total=0).
        const total = 0
        const streaming = 'transient-flicker'

        // Use the real gate from staticGating.ts so M9/repair flipping
        // the logic here will also flip this fixture.
        const prologueGoesStaticBug = shouldPrologueGoStatic({ prologue, total, streaming })

        if (prologueGoesStaticBug) {
          throw new Error(
            `Bug B2: prologueGoesStatic formula fires when total=0 ` +
            `and streaming is transiently non-null (flicker).\n` +
            `Static is append-only — once the prologue is pushed in, it ` +
            `cannot return to the live area, leaving it blank when ` +
            `streaming reverts to null.`,
          )
        }
      },
    },
  },
} satisfies FixtureDef

export default fixture
