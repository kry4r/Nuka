// test/tui/Feed.test.tsx
//
// Phase B — unit tests for Feed / FeedColumn / Divider / feedConfigs.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { Box, Text } from 'ink'
import { Feed, calculateFeedWidth, type FeedConfig } from '../../src/tui/Welcome/Feed'
import { FeedColumn } from '../../src/tui/Welcome/FeedColumn'
import { Divider } from '../../src/tui/Welcome/Divider'
import {
  createUpdatesFeed,
  createRecentFeed,
  formatRelativeTimeAgo,
} from '../../src/tui/Welcome/feedConfigs'

describe('calculateFeedWidth', () => {
  it('picks the max across title / lines / footer', () => {
    const cfg: FeedConfig = {
      title: 'Hi',
      lines: [{ text: 'short' }, { text: 'a much longer line of text' }],
      footer: 'mid',
    }
    expect(calculateFeedWidth(cfg)).toBe('a much longer line of text'.length)
  })

  it('accounts for timestamp + 2-space gap when timestamps present', () => {
    const cfg: FeedConfig = {
      title: 'X',
      lines: [{ text: 'foo', timestamp: '5m' }],
    }
    // 'foo' (3) + '5m' (2) + gap (2) = 7
    expect(calculateFeedWidth(cfg)).toBe(7)
  })

  it('uses customContent.width when provided', () => {
    const cfg: FeedConfig = {
      title: 'X',
      lines: [],
      customContent: { content: <Text>hi</Text>, width: 42 },
    }
    expect(calculateFeedWidth(cfg)).toBe(42)
  })

  it('falls back to emptyMessage width when no lines', () => {
    const cfg: FeedConfig = {
      title: 'a',
      lines: [],
      emptyMessage: 'nothing here yet',
    }
    expect(calculateFeedWidth(cfg)).toBe('nothing here yet'.length)
  })
})

describe('Feed', () => {
  it('renders title bold and the empty message when lines is empty', () => {
    const cfg: FeedConfig = {
      title: 'Updates',
      lines: [],
      emptyMessage: '(no updates)',
    }
    const { lastFrame } = render(<Feed config={cfg} actualWidth={30} />)
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Updates')
    expect(f).toContain('(no updates)')
  })

  it('renders lines with left-padded timestamps when any line has one', () => {
    const cfg: FeedConfig = {
      title: 'Recent',
      lines: [
        { text: 'fix bug', timestamp: '3h' },
        { text: 'add feature', timestamp: '1d' },
      ],
    }
    const { lastFrame } = render(<Feed config={cfg} actualWidth={30} />)
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('fix bug')
    expect(f).toContain('add feature')
    // timestamps should both appear; the shorter one is padded to length 2
    expect(f).toContain('3h')
    expect(f).toContain('1d')
  })

  it('renders footer line dim+italic', () => {
    const cfg: FeedConfig = {
      title: 'Recent',
      lines: [{ text: 'foo' }],
      footer: '/resume for more',
    }
    const { lastFrame } = render(<Feed config={cfg} actualWidth={30} />)
    expect(stripAnsi(lastFrame() ?? '')).toContain('/resume for more')
  })

  it('truncates a line wider than actualWidth', () => {
    const cfg: FeedConfig = {
      title: 'X',
      lines: [{ text: 'this line is definitely much longer than the column allows' }],
    }
    const { lastFrame } = render(<Feed config={cfg} actualWidth={20} />)
    const f = stripAnsi(lastFrame() ?? '')
    // ellipsis indicates truncation
    expect(f).toMatch(/\u2026/)
    // and the original full string is NOT present
    expect(f).not.toContain('much longer than the column allows')
  })

  it('renders customContent and footer when both are present', () => {
    const cfg: FeedConfig = {
      title: 'Promo',
      lines: [],
      customContent: { content: <Text>** PROMO **</Text>, width: 12 },
      footer: '/passes',
    }
    const { lastFrame } = render(<Feed config={cfg} actualWidth={20} />)
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('** PROMO **')
    expect(f).toContain('/passes')
  })
})

describe('Divider', () => {
  it('renders a horizontal rule of the given width', () => {
    const { lastFrame } = render(<Divider width={10} />)
    expect(stripAnsi(lastFrame() ?? '')).toBe('\u2500'.repeat(10))
  })
})

describe('FeedColumn', () => {
  it('renders multiple feeds with N-1 dividers between them', () => {
    const feeds: FeedConfig[] = [
      { title: 'A', lines: [{ text: 'one' }] },
      { title: 'B', lines: [{ text: 'two' }] },
      { title: 'C', lines: [{ text: 'three' }] },
    ]
    const { lastFrame } = render(<FeedColumn feeds={feeds} maxWidth={20} />)
    const f = stripAnsi(lastFrame() ?? '')
    // Each title shows up
    expect(f).toContain('A')
    expect(f).toContain('B')
    expect(f).toContain('C')
    // And exactly 2 divider rows (3 feeds - 1)
    const dividerRows = f.split('\n').filter(l => /^\u2500+$/.test(l.trim()))
    expect(dividerRows.length).toBe(2)
  })

  it('handles a single feed (no dividers)', () => {
    const feeds: FeedConfig[] = [{ title: 'Solo', lines: [{ text: 'one' }] }]
    const { lastFrame } = render(<FeedColumn feeds={feeds} maxWidth={20} />)
    const f = stripAnsi(lastFrame() ?? '')
    const dividerRows = f.split('\n').filter(l => /^\u2500+$/.test(l.trim()))
    expect(dividerRows.length).toBe(0)
  })
})

describe('formatRelativeTimeAgo', () => {
  it('returns "<1m" for very recent', () => {
    expect(formatRelativeTimeAgo(Date.now(), Date.now())).toBe('<1m')
  })

  it('returns Nm / Nh / Nd / Nw for increasing durations', () => {
    const now = 1_700_000_000_000
    expect(formatRelativeTimeAgo(now - 5 * 60_000, now)).toBe('5m')
    expect(formatRelativeTimeAgo(now - 3 * 3_600_000, now)).toBe('3h')
    expect(formatRelativeTimeAgo(now - 4 * 86_400_000, now)).toBe('4d')
    expect(formatRelativeTimeAgo(now - 14 * 86_400_000, now)).toBe('2w')
  })
})

describe('createUpdatesFeed', () => {
  it('renders entry head and bullets as separate lines', () => {
    const cfg = createUpdatesFeed([
      { version: '1.1.0', title: 'Cool', bullets: ['One', 'Two'] },
    ])
    expect(cfg.title).toBe('Updates')
    expect(cfg.lines.length).toBe(3) // head + 2 bullets
    expect(cfg.lines[0]?.text).toContain('1.1.0')
    expect(cfg.lines[0]?.text).toContain('Cool')
    expect(cfg.lines[1]?.text).toMatch(/One/)
    expect(cfg.lines[2]?.text).toMatch(/Two/)
  })

  it('emits emptyMessage when no entries', () => {
    expect(createUpdatesFeed([]).emptyMessage).toBe('(no updates)')
  })
})

describe('createRecentFeed', () => {
  it('produces lines + footer when entries present', () => {
    const cfg = createRecentFeed([
      { id: 'a', preview: 'Fix bug', updatedAt: Date.now() - 3 * 3_600_000 },
    ])
    expect(cfg.title).toBe('Recent')
    expect(cfg.lines.length).toBe(1)
    expect(cfg.lines[0]?.text).toBe('Fix bug')
    expect(cfg.lines[0]?.timestamp).toBe('3h')
    expect(cfg.footer).toBe('/resume for more')
  })

  it('omits footer when no entries', () => {
    const cfg = createRecentFeed([])
    expect(cfg.footer).toBeUndefined()
    expect(cfg.emptyMessage).toBe('(no recent sessions)')
  })
})
