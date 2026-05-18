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
      // The bug is that even when total>0 (from a no-op bumpMessages()),
      // the prologue should only go static after it has been live once.
      render: () => React.createElement(Text, null, 'messages-static-probe'),
      assert: async () => {
        // Replicate the prologueGoesStatic formula from Messages.tsx:168:
        //   prologueGoesStatic = !!prologue && (total > 0 || streaming !== null)
        //
        // BUG B2 (currently failing at HEAD):
        //   After ModelPicker.onSave calls bumpMessages(), total becomes > 0.
        //   The next render has prologueGoesStatic=true, pushing prologue into
        //   Ink's Static channel. The live area is then empty until next input.
        //
        // After the fix, prologueGoesStatic must NOT fire purely because
        // bumpMessages() incremented total — it should require an actual user
        // message to have been sent and rendered first.

        const prologue = {} // truthy
        const streaming = null
        // Simulate bumpMessages() — total incremented from 0 to 1
        const total = 1

        // Current formula (bug): immediately goes static
        const prologueGoesStaticBug = !!prologue && (total > 0 || streaming !== null)

        if (prologueGoesStaticBug) {
          throw new Error(
            `Bug B2: prologueGoesStatic formula fires when total=1 (from bumpMessages) ` +
            `and streaming=null.\n` +
            `Messages.tsx:168: prologueGoesStatic = !!prologue && (total > 0 || streaming !== null)\n` +
            `This pushes Welcome prologue into Static after ModelPicker.onSave calls ` +
            `bumpMessages(), leaving the live area blank.`,
          )
        }
      },
    },
  },
} satisfies FixtureDef

export default fixture
