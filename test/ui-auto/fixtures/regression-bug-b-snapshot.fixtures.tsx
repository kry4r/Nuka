// test/ui-auto/fixtures/regression-bug-b-snapshot.fixtures.tsx
//
// Pre-patch SNAPSHOT of Bug B. Used by the M6.T2 sweep dogfood test.
//
// Why a snapshot fixture?
//   `nuka explore sweep` runs L1 invariants over the rendered grid; it does
//   NOT execute fixture-level assert hooks. The real regression-bug-b
//   fixture relies on assert hooks, so sweep cannot see it. This snapshot
//   bakes the broken pre-patch behavior into the render tree itself so
//   sweep deterministically produces failure dumps at the 4 narrow profiles.
//
// After the M6.T3 fix lands, the regression-bug-b fixture passes via assert
// hooks while this snapshot stays red — it pins the symptoms verbatim and
// is what M6.T2 asserts continues to reproduce.
//
// Symptoms captured:
//   B1 (logo-truncated-at-narrow): a 92-cell LOGO whose right end carries
//        a "B1-END-MARKER" sentinel. At cols < 92 the right end is clipped
//        out of the grid; the fixture declares mustContain on the marker so
//        noLossyTruncation fires at 60, 70, 79. At 100 cols the marker fits
//        and the case passes — which is exactly the B1 "LOGO squashed only
//        when stale viewport says narrow" shape.
//   B2 (prologue-in-static): emits a prologue line through Ink's <Static>
//        channel — fires noStaticWrites at all 4 profiles.

import React from 'react'
import { Box, Static, Text } from 'ink'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const PROLOGUE_ITEMS: Array<{ key: string; text: string }> = [
  { key: 'p1', text: 'WELCOME-PROLOGUE-IN-STATIC' },
]

// A LOGO surrogate that ends in a 13-char "B1-END-MARKER" sentinel. The
// full string is 92 cells wide; at viewport cols < 92 the sentinel is
// clipped and the noLossyTruncation invariant fires on the mustContain
// declaration below.
const B1_END_MARKER = 'B1-END-MARKER'
const B1_LOGO = '#'.repeat(92 - B1_END_MARKER.length) + B1_END_MARKER

function ProlongueInStatic(): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Static items={PROLOGUE_ITEMS}>
        {(item) => (
          <Box key={item.key}>
            <Text>{item.text}</Text>
          </Box>
        )}
      </Static>
      <Text>live-area-placeholder</Text>
    </Box>
  )
}

function WideLogo(): React.JSX.Element {
  // Fixed-width 200-col container forces Ink to render the full 92-cell
  // line; viewport-level clipping in grid.ts then truncates the right
  // side — exactly the visual symptom on a stale-viewport remount frame.
  return (
    <Box flexDirection="column">
      <Box width={200} flexShrink={0}>
        <Text wrap="truncate-end">{B1_LOGO}</Text>
      </Box>
      <Text>live-area-placeholder</Text>
    </Box>
  )
}

const fixture: FixtureDef = {
  component: 'BugB-Snapshot',
  cases: {
    'b1-logo-overflow-at-narrow-widths': {
      render: () => <WideLogo />,
      // Asserts the right-edge sentinel survived the viewport clip.
      // At cols < 92 it gets cut off → noLossyTruncation fires.
      mustContain: [B1_END_MARKER],
    },
    'b2-prologue-pushed-into-static': {
      render: () => <ProlongueInStatic />,
    },
  },
  // Snapshot pinned to the 4 profiles M6.T2 requires sweep to catch.
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
    { cols: 79, rows: 24 },
    { cols: 100, rows: 30 },
  ],
}

export default fixture
