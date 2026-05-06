import stringWidth from 'string-width'

export type LayoutMode = 'compact' | 'normal' | 'wide'

export type LayoutDimensions = {
  leftWidth: number
  rightWidth: number
  totalWidth: number
}

const MAX_LEFT_WIDTH = 50
const MAX_USERNAME_LENGTH = 20
const BORDER_PADDING = 4
const DIVIDER_WIDTH = 1
const CONTENT_PADDING = 2

export function getLayoutMode(columns: number): LayoutMode {
  if (columns >= 110) return 'wide'
  if (columns >= 80) return 'normal'
  return 'compact'
}

export function calculateOptimalLeftWidth(
  welcomeMessage: string,
  cwdLine: string,
  modelLine: string,
): number {
  const contentWidth = Math.max(
    stringWidth(welcomeMessage),
    stringWidth(cwdLine),
    stringWidth(modelLine),
    24, // floor: enough to hold "Type / for commands" + padding
  )
  return Math.min(contentWidth + 4, MAX_LEFT_WIDTH)
}

export function calculateLayoutDimensions(
  columns: number,
  layoutMode: LayoutMode,
  optimalLeftWidth: number,
): LayoutDimensions {
  if (layoutMode !== 'compact') {
    const leftWidth = optimalLeftWidth
    const usedSpace = BORDER_PADDING + CONTENT_PADDING + DIVIDER_WIDTH + leftWidth
    const availableForRight = columns - usedSpace
    let rightWidth = Math.max(24, availableForRight)
    const totalWidth = Math.min(
      leftWidth + rightWidth + DIVIDER_WIDTH + CONTENT_PADDING,
      columns - BORDER_PADDING,
    )
    if (totalWidth < leftWidth + rightWidth + DIVIDER_WIDTH + CONTENT_PADDING) {
      rightWidth = totalWidth - leftWidth - DIVIDER_WIDTH - CONTENT_PADDING
    }
    return { leftWidth, rightWidth, totalWidth }
  }
  const totalWidth = Math.min(columns - BORDER_PADDING, MAX_LEFT_WIDTH + 20)
  return { leftWidth: totalWidth, rightWidth: totalWidth, totalWidth }
}

export function formatWelcomeMessage(username: string | null): string {
  const u = username?.trim()
  if (!u || u.length > MAX_USERNAME_LENGTH) return 'Welcome back!'
  return `Welcome back, ${u}!`
}

function truncateToWidth(s: string, max: number): string {
  if (max <= 0) return ''
  if (stringWidth(s) <= max) return s
  const ellipsis = '...'
  const ew = stringWidth(ellipsis)
  let acc = ''
  let w = 0
  for (const ch of s) {
    const cw = stringWidth(ch)
    if (w + cw + ew > max) break
    acc += ch
    w += cw
  }
  return acc + ellipsis
}

function truncateToWidthNoEllipsis(s: string, max: number): string {
  if (max <= 0) return ''
  if (stringWidth(s) <= max) return s
  let acc = ''
  let w = 0
  for (const ch of s) {
    const cw = stringWidth(ch)
    if (w + cw > max) break
    acc += ch
    w += cw
  }
  return acc
}

export function truncatePath(path: string, maxLength: number): string {
  if (stringWidth(path) <= maxLength) return path
  const sep = '/'
  const ellipsis = '...'
  const ew = stringWidth(ellipsis)
  const sw = 1
  const parts = path.split(sep)
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? ''
  const firstWidth = stringWidth(first)
  const lastWidth = stringWidth(last)

  if (parts.length === 1) return truncateToWidth(path, maxLength)

  if (first === '' && ew + sw + lastWidth >= maxLength) {
    return `${sep}${truncateToWidth(last, Math.max(1, maxLength - sw))}`
  }

  if (first !== '' && ew * 2 + sw + lastWidth >= maxLength) {
    return `${ellipsis}${sep}${truncateToWidth(last, Math.max(1, maxLength - ew - sw))}`
  }

  if (parts.length === 2) {
    const availableForFirst = maxLength - ew - sw - lastWidth
    return `${truncateToWidthNoEllipsis(first, availableForFirst)}${ellipsis}${sep}${last}`
  }

  let available = maxLength - firstWidth - lastWidth - ew - 2 * sw
  if (available <= 0) {
    const availableForFirst = Math.max(0, maxLength - lastWidth - ew - 2 * sw)
    const truncFirst = truncateToWidthNoEllipsis(first, availableForFirst)
    return `${truncFirst}${sep}${ellipsis}${sep}${last}`
  }

  const middle: string[] = []
  for (let i = parts.length - 2; i > 0; i--) {
    const part = parts[i]
    if (part && stringWidth(part) + sw <= available) {
      middle.unshift(part)
      available -= stringWidth(part) + sw
    } else {
      break
    }
  }
  if (middle.length === 0) return `${first}${sep}${ellipsis}${sep}${last}`
  return `${first}${sep}${ellipsis}${sep}${middle.join(sep)}${sep}${last}`
}
