// src/tui/Stats/RangeTabs.tsx
// Phase 8 §4.2 — range selector display component for /stats.

import React from 'react'
import { Box, Text } from 'ink'
import type { StatsRange } from '../../core/stats/aggregate'

export type RangeTabsProps = {
  active: StatsRange
}

const RANGES: StatsRange[] = ['all', '30d', '7d']
const LABEL: Record<StatsRange, string> = { all: 'All time', '30d': 'Last 30 days', '7d': 'Last 7 days' }

export function RangeTabs({ active }: RangeTabsProps): React.JSX.Element {
  return (
    <Box gap={2}>
      {RANGES.map(r => (
        <Text key={r} bold={r === active} underline={r === active}>
          {LABEL[r]}
        </Text>
      ))}
    </Box>
  )
}
