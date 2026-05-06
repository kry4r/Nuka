// src/tui/Welcome/Feed.tsx
//
// Phase B — port of Nuka-Code's `LogoV2/Feed`.  A Feed renders a labeled
// block of lines (with optional left-padded timestamps), an optional
// custom-content body, and an optional dim+italic footer line.  Used by
// FeedColumn to compose the Welcome right rail (Updates / Recent / etc.).

import React from 'react'
import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { defaultPalette as P } from '../theme'

export type FeedLine = {
  text: string
  timestamp?: string
}

export type FeedConfig = {
  title: string
  lines: FeedLine[]
  footer?: string
  emptyMessage?: string
  customContent?: { content: React.ReactNode; width: number }
}

export type FeedProps = {
  config: FeedConfig
  actualWidth: number
}

/** Truncate `s` to fit within `width` display columns, appending '…' if cut. */
function truncate(s: string, width: number): string {
  if (width <= 0) return ''
  if (stringWidth(s) <= width) return s
  const ellipsis = '\u2026'
  let acc = ''
  let w = 0
  for (const ch of s) {
    const cw = stringWidth(ch)
    if (w + cw + 1 > width) break
    acc += ch
    w += cw
  }
  return acc + ellipsis
}

/**
 * Compute the natural display width a Feed config wants — the max of
 * title, customContent.width, padded line widths (incl. timestamp gutter),
 * and footer.  Used by FeedColumn to size all stacked feeds uniformly.
 */
export function calculateFeedWidth(config: FeedConfig): number {
  const { title, lines, footer, emptyMessage, customContent } = config
  let maxWidth = stringWidth(title)
  if (customContent !== undefined) {
    maxWidth = Math.max(maxWidth, customContent.width)
  } else if (lines.length === 0 && emptyMessage) {
    maxWidth = Math.max(maxWidth, stringWidth(emptyMessage))
  } else {
    const gap = 2
    const maxTimestampWidth = Math.max(
      0,
      ...lines.map(l => (l.timestamp ? stringWidth(l.timestamp) : 0)),
    )
    for (const line of lines) {
      const lineWidth =
        stringWidth(line.text) +
        (maxTimestampWidth > 0 ? maxTimestampWidth + gap : 0)
      maxWidth = Math.max(maxWidth, lineWidth)
    }
  }
  if (footer) {
    maxWidth = Math.max(maxWidth, stringWidth(footer))
  }
  return maxWidth
}

export function Feed({ config, actualWidth }: FeedProps): React.JSX.Element {
  const { title, lines, footer, emptyMessage, customContent } = config

  const maxTimestampWidth = Math.max(
    0,
    ...lines.map(l => (l.timestamp ? stringWidth(l.timestamp) : 0)),
  )

  let body: React.ReactNode
  if (customContent) {
    body = (
      <>
        {customContent.content}
        {footer && (
          <Text dimColor italic>{truncate(footer, actualWidth)}</Text>
        )}
      </>
    )
  } else if (lines.length === 0 && emptyMessage) {
    body = (
      <Text color={P.fgFaint}>{truncate(emptyMessage, actualWidth)}</Text>
    )
  } else {
    const textWidth = Math.max(
      10,
      actualWidth - (maxTimestampWidth > 0 ? maxTimestampWidth + 2 : 0),
    )
    body = (
      <>
        {lines.map((line, i) => (
          <Text key={`feed-line-${i}`}>
            {maxTimestampWidth > 0 && (
              <>
                <Text dimColor>
                  {(line.timestamp ?? '').padEnd(maxTimestampWidth)}
                </Text>
                {'  '}
              </>
            )}
            <Text>{truncate(line.text, textWidth)}</Text>
          </Text>
        ))}
        {footer && (
          <Text dimColor italic>{truncate(footer, actualWidth)}</Text>
        )}
      </>
    )
  }

  return (
    <Box flexDirection="column" width={actualWidth}>
      <Text bold color={P.primary}>{title}</Text>
      {body}
    </Box>
  )
}
