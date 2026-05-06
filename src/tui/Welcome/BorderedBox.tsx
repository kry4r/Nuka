import React from 'react'
import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import stripAnsi from 'strip-ansi'
import { defaultPalette as P } from '../theme'

export type BorderedBoxProps = {
  /** Plain text title (color applied via `titleColor`). Mutually exclusive with `titleNode`. */
  title?: string
  /** Pre-styled title node (e.g. multi-color). When set, `title`/`titleColor` are ignored. */
  titleNode?: React.ReactNode
  titleColor?: string
  /**
   * `start` keeps the title near the left (default: 3-char inset).
   * `center` centers the title in the top row.
   */
  align?: 'start' | 'center'
  /** Inset from the left edge for `align='start'` (default 3). */
  offset?: number
  /** Border color (default theme primary). */
  borderColor?: string
  /** Total width of the box (top row + content). */
  width?: number
  children?: React.ReactNode
}

/**
 * Vanilla-ink emulation of an inline-titled rounded border. ink doesn't
 * support `borderText`, so we render the top row manually as a `<Text>` and
 * suppress the inner `<Box>`'s top border via `borderTop={false}`.
 */
export function BorderedBox(props: BorderedBoxProps): React.JSX.Element {
  const {
    title = '',
    titleNode,
    titleColor = P.primary,
    align = 'start',
    offset = 3,
    borderColor = P.primary,
    width,
    children,
  } = props

  // Top-row segment widths (pre-padding)
  const titlePlain = titleNode != null
    ? stripAnsi(extractText(titleNode))
    : title
  const titleWidth = stringWidth(titlePlain)

  return (
    <Box flexDirection="column" width={width}>
      <TopBorder
        title={title}
        titleNode={titleNode}
        titleColor={titleColor}
        titleWidth={titleWidth}
        align={align}
        offset={offset}
        borderColor={borderColor}
        width={width}
      />
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={borderColor}
        borderTop={false}
      >
        {children}
      </Box>
    </Box>
  )
}

function TopBorder(props: {
  title: string
  titleNode?: React.ReactNode
  titleColor: string
  titleWidth: number
  align: 'start' | 'center'
  offset: number
  borderColor: string
  width?: number
}): React.JSX.Element {
  const { title, titleNode, titleColor, titleWidth, align, offset, borderColor, width } = props
  // Use a width-aware row when caller pinned `width`, otherwise emit a row
  // wide enough to cover the title plus a stable cap (`...─...─╮`).
  // ink will not stretch a `<Text>` to fill its parent, so without an explicit
  // `width` we default to title + 8 (title insets + cap dashes).
  const totalWidth = width ?? titleWidth + offset + 8
  const innerWidth = Math.max(0, totalWidth - 2) // minus ╭ and ╮
  // 1 padding dash on either side of the title segment
  const titleSlot = titleWidth + 2 // " <title> "
  if (titleSlot >= innerWidth) {
    // Degenerate: fall back to a plain top row, no title.
    const dashes = '─'.repeat(innerWidth)
    return (
      <Text color={borderColor}>
        {`╭${dashes}╮`}
      </Text>
    )
  }
  let leftDashes: number
  let rightDashes: number
  if (align === 'center') {
    leftDashes = Math.floor((innerWidth - titleSlot) / 2)
    rightDashes = innerWidth - titleSlot - leftDashes
  } else {
    leftDashes = Math.max(1, offset - 1) // ╭─...
    rightDashes = innerWidth - titleSlot - leftDashes
    if (rightDashes < 1) {
      const overflow = 1 - rightDashes
      leftDashes = Math.max(1, leftDashes - overflow)
      rightDashes = innerWidth - titleSlot - leftDashes
    }
  }
  return (
    <Text>
      <Text color={borderColor}>{`╭${'─'.repeat(leftDashes)} `}</Text>
      {titleNode ?? <Text color={titleColor} bold>{title}</Text>}
      <Text color={borderColor}>{` ${'─'.repeat(rightDashes)}╮`}</Text>
    </Text>
  )
}

/** Best-effort string extraction from a React node for width calculation. */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    return extractText(props.children)
  }
  return ''
}
