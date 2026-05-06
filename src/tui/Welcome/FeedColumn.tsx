// src/tui/Welcome/FeedColumn.tsx
//
// Phase B — port of Nuka-Code's `LogoV2/FeedColumn`.  Renders a vertical
// stack of `Feed` blocks separated by `Divider` rules, all sized to the
// uniform width = min(maxWidth, max-of-each-feed's natural width).

import React from 'react'
import { Box } from 'ink'
import { defaultPalette as P } from '../theme'
import { Divider } from './Divider'
import type { FeedConfig } from './Feed'
import { calculateFeedWidth, Feed } from './Feed'

export type FeedColumnProps = {
  feeds: FeedConfig[]
  maxWidth: number
}

export function FeedColumn({ feeds, maxWidth }: FeedColumnProps): React.JSX.Element {
  const widths = feeds.map(calculateFeedWidth)
  const maxOfAllFeeds = widths.length > 0 ? Math.max(...widths) : 0
  const actualWidth = Math.min(maxOfAllFeeds, maxWidth)

  return (
    <Box flexDirection="column">
      {feeds.map((feed, index) => (
        // Composite key — title + index — avoids the duplicate-key trap if
        // two callers ever share a title (and is still stable across reorders
        // within a typical Welcome render).
        <React.Fragment key={`${feed.title}-${index}`}>
          <Feed config={feed} actualWidth={actualWidth} />
          {index < feeds.length - 1 && (
            <Divider color={P.primary} width={actualWidth} />
          )}
        </React.Fragment>
      ))}
    </Box>
  )
}
