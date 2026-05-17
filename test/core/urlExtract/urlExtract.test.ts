// test/core/urlExtract/urlExtract.test.ts
import { describe, it, expect } from 'vitest'
import {
  extractUrls,
  isUrl,
  replaceUrls,
  extractMarkdownLinks,
} from '../../../src/core/urlExtract'

describe('extractUrls — basic schemes', () => {
  it('returns empty for empty / non-string input', () => {
    expect(extractUrls('')).toEqual([])
    expect(extractUrls(undefined as unknown as string)).toEqual([])
    expect(extractUrls(null as unknown as string)).toEqual([])
  })

  it('matches a plain https URL with no surrounding prose', () => {
    const out = extractUrls('https://example.com')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      url: 'https://example.com',
      start: 0,
      end: 'https://example.com'.length,
      kind: 'http',
    })
  })

  it('matches a plain http URL', () => {
    const out = extractUrls('http://example.com')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('http://example.com')
    expect(out[0]?.kind).toBe('http')
  })

  it('matches a URL with path, query, and fragment', () => {
    const out = extractUrls('See https://example.com/path?q=1&r=2#frag-id')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('https://example.com/path?q=1&r=2#frag-id')
  })

  it('matches a URL with an explicit port', () => {
    const out = extractUrls('https://example.com:8080/api')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('https://example.com:8080/api')
  })

  it('matches an FTP URL when kind is enabled (default)', () => {
    const out = extractUrls('Get the file from ftp://example.com/dir/file.txt')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('ftp://example.com/dir/file.txt')
    expect(out[0]?.kind).toBe('ftp')
  })

  it('matches an FTPS URL', () => {
    const out = extractUrls('ftps://example.com/secure')
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('ftp')
  })

  it('does not match FTP when kind is excluded', () => {
    const out = extractUrls('ftp://example.com', { kinds: ['http'] })
    expect(out).toEqual([])
  })

  it('reports correct offsets into the source string', () => {
    const text = 'prefix https://example.com suffix'
    const out = extractUrls(text)
    expect(out).toHaveLength(1)
    const m = out[0]!
    expect(text.slice(m.start, m.end)).toBe(m.url)
  })
})

describe('extractUrls — IP-literal hosts', () => {
  it('matches IPv4 hosts', () => {
    const out = extractUrls('Connect to https://192.168.1.1/admin')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('https://192.168.1.1/admin')
  })

  it('matches IPv6 hosts in bracket form', () => {
    const out = extractUrls('Loopback: http://[::1]/health')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('http://[::1]/health')
  })
})

describe('extractUrls — trailing punctuation handling', () => {
  it('strips a trailing period in a sentence', () => {
    const out = extractUrls('Check https://example.com.')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('https://example.com')
    // end offset should NOT include the trailing dot
    expect(out[0]?.end).toBe('Check '.length + 'https://example.com'.length)
  })

  it('strips comma, exclamation, question mark, semicolon, colon', () => {
    for (const punct of [',', '!', '?', ';', ':']) {
      const out = extractUrls(`Like https://example.com${punct} okay?`)
      expect(out, `for trailing "${punct}"`).toHaveLength(1)
      expect(out[0]?.url).toBe('https://example.com')
    }
  })

  it('strips an unbalanced closing paren', () => {
    const out = extractUrls('(see https://example.com)')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('https://example.com')
  })

  it('keeps a balanced closing paren that is part of the URL', () => {
    const out = extractUrls(
      'Read https://en.wikipedia.org/wiki/Foo_(bar) for details',
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('https://en.wikipedia.org/wiki/Foo_(bar)')
  })

  it('strips trailing quotes', () => {
    const out = extractUrls('"https://example.com"')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('https://example.com')
  })

  it('iteratively strips combined trailing punctuation', () => {
    // `).` should both come off, leaving the URL intact.
    const out = extractUrls('(see https://example.com).')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('https://example.com')
  })
})

describe('extractUrls — markdown links', () => {
  it('flags the URL inside an inline markdown link', () => {
    const text = '[Click here](https://example.com)'
    const out = extractUrls(text)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      url: 'https://example.com',
      kind: 'http',
      inMarkdownLink: true,
    })
    expect(text.slice(out[0]!.start, out[0]!.end)).toBe('https://example.com')
  })

  it('flags the URL inside a reference-style markdown link', () => {
    const text = '[1]: https://example.com'
    const out = extractUrls(text)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      url: 'https://example.com',
      inMarkdownLink: true,
    })
  })

  it('does not double-count a bare URL adjacent to a markdown link', () => {
    const text = 'See [docs](https://a.com) and https://b.com.'
    const out = extractUrls(text)
    expect(out).toHaveLength(2)
    expect(out[0]?.url).toBe('https://a.com')
    expect(out[0]?.inMarkdownLink).toBe(true)
    expect(out[1]?.url).toBe('https://b.com')
    expect(out[1]?.inMarkdownLink).toBeUndefined()
  })

  it('ignores empty inline link targets', () => {
    expect(extractUrls('[text]()')).toEqual([])
  })
})

describe('extractUrls — multiple URLs', () => {
  it('returns matches in source order', () => {
    const text =
      'first https://a.com then https://b.com and last https://c.com.'
    const out = extractUrls(text)
    expect(out.map(m => m.url)).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ])
    // Strictly increasing start offsets.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.start).toBeGreaterThan(out[i - 1]!.start)
    }
  })

  it('separates two URLs joined by a comma', () => {
    const out = extractUrls('https://a.com,https://b.com')
    expect(out.map(m => m.url)).toEqual(['https://a.com', 'https://b.com'])
  })
})

describe('extractUrls — emails (mailto)', () => {
  it('detects a bare email address by default', () => {
    const out = extractUrls('Email me at user@example.com please')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('user@example.com')
    expect(out[0]?.kind).toBe('mailto')
  })

  it('detects emails with plus-tag and two-label TLD', () => {
    const out = extractUrls('Reach user+tag@example.co.uk for help')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('user+tag@example.co.uk')
  })

  it('detects mailto: URIs', () => {
    const out = extractUrls('Send to mailto:foo@bar.com directly')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('mailto:foo@bar.com')
    expect(out[0]?.kind).toBe('mailto')
  })

  it('does not double-count an email inside mailto:', () => {
    const out = extractUrls('mailto:foo@bar.com')
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('mailto:foo@bar.com')
  })

  it('skips emails when mailto kind is disabled', () => {
    const out = extractUrls('user@example.com', { kinds: ['http'] })
    expect(out).toEqual([])
  })
})

describe('extractUrls — bare domains', () => {
  it('does not detect bare domains by default', () => {
    expect(extractUrls('Visit example.com today')).toEqual([])
  })

  it('detects bare domains when includeBareDomain is true', () => {
    const out = extractUrls('Visit example.com today', {
      includeBareDomain: true,
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('example.com')
    expect(out[0]?.kind).toBe('bare-domain')
  })

  it('detects multi-label bare domains', () => {
    const out = extractUrls('See sub.example.co.uk for docs', {
      includeBareDomain: true,
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('sub.example.co.uk')
  })

  it('rejects bare numbers like v1.2.3', () => {
    expect(extractUrls('upgraded to v1.2.3', { includeBareDomain: true })).toEqual(
      [],
    )
  })

  it('rejects words with dots when TLD is unknown', () => {
    expect(
      extractUrls('open file.bin to view', { includeBareDomain: true }),
    ).toEqual([])
  })

  it('does not consume an email address as a bare domain', () => {
    const out = extractUrls('contact user@example.com today', {
      includeBareDomain: true,
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('user@example.com')
    expect(out[0]?.kind).toBe('mailto')
  })

  it('does not match the bare-domain inside a full https URL', () => {
    const out = extractUrls('go https://example.com/a now', {
      includeBareDomain: true,
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('http')
  })
})

describe('extractUrls — file URIs', () => {
  it('matches a file:// URI when the kind is enabled', () => {
    const out = extractUrls('Open file:///home/user/foo.txt', {
      kinds: ['http', 'file'],
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.url).toBe('file:///home/user/foo.txt')
    expect(out[0]?.kind).toBe('file')
  })

  it('does not match file:// when not requested', () => {
    expect(extractUrls('file:///x', { kinds: ['http'] })).toEqual([])
  })
})

describe('extractUrls — Unicode', () => {
  it('keeps non-ASCII characters in the URL path', () => {
    const out = extractUrls('Visit https://example.com/路径/文件')
    expect(out).toHaveLength(1)
    // Trailing wide-char may not be trimmed; the body must survive.
    expect(out[0]?.url.startsWith('https://example.com/路径/文件')).toBe(true)
  })
})

describe('extractUrls — false positives', () => {
  it('does not match bare numbers', () => {
    expect(extractUrls('1.2.3.4')).toEqual([])
  })

  it('does not match plain words containing dots', () => {
    expect(extractUrls('this is a sentence.')).toEqual([])
  })
})

describe('isUrl', () => {
  it('returns true when the whole string is a URL', () => {
    expect(isUrl('https://example.com')).toBe(true)
  })

  it('returns true when a URL is embedded in prose', () => {
    expect(isUrl('see https://example.com for more')).toBe(true)
  })

  it('returns false for plain prose', () => {
    expect(isUrl('hello world')).toBe(false)
  })

  it('returns false for empty / non-string input', () => {
    expect(isUrl('')).toBe(false)
    expect(isUrl(undefined as unknown as string)).toBe(false)
  })

  it('respects the kinds filter', () => {
    expect(isUrl('ftp://example.com', { kinds: ['http'] })).toBe(false)
    expect(isUrl('ftp://example.com', { kinds: ['ftp'] })).toBe(true)
  })

  it('recognises a bare email as a URL when mailto is enabled', () => {
    expect(isUrl('foo@bar.com')).toBe(true)
  })
})

describe('replaceUrls', () => {
  it('returns the input unchanged when there is no URL', () => {
    expect(replaceUrls('hello world', () => 'X')).toBe('hello world')
  })

  it('rewrites a single URL via the transform', () => {
    const out = replaceUrls('See https://example.com.', m => `<${m.url}>`)
    expect(out).toBe('See <https://example.com>.')
  })

  it('rewrites multiple URLs preserving surrounding prose', () => {
    const out = replaceUrls(
      'a https://a.com b https://b.com c',
      m => m.url.toUpperCase(),
    )
    expect(out).toBe('a HTTPS://A.COM b HTTPS://B.COM c')
  })

  it('passes the full match record to the transform', () => {
    const out = replaceUrls('go [docs](https://x.com) ok', m =>
      m.inMarkdownLink ? '__MD__' : m.url,
    )
    expect(out).toContain('__MD__')
  })

  it('handles empty / non-string input', () => {
    expect(replaceUrls('', () => 'X')).toBe('')
  })
})

describe('extractMarkdownLinks', () => {
  it('extracts an inline link', () => {
    const out = extractMarkdownLinks('See [docs](https://x.com)')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      text: 'docs',
      url: 'https://x.com',
      style: 'inline',
    })
  })

  it('extracts a reference-style link at start of input', () => {
    const out = extractMarkdownLinks('[1]: https://example.com')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      text: '1',
      url: 'https://example.com',
      style: 'reference',
    })
  })

  it('extracts a reference-style link after a newline', () => {
    const out = extractMarkdownLinks('intro\n[ref]: https://x.com')
    expect(out).toHaveLength(1)
    expect(out[0]?.style).toBe('reference')
    expect(out[0]?.url).toBe('https://x.com')
  })

  it('returns matches in source order', () => {
    const text = 'a [one](https://1.com) b [two](https://2.com)'
    const out = extractMarkdownLinks(text)
    expect(out.map(l => l.url)).toEqual(['https://1.com', 'https://2.com'])
  })

  it('returns empty for empty / non-string input', () => {
    expect(extractMarkdownLinks('')).toEqual([])
    expect(extractMarkdownLinks(undefined as unknown as string)).toEqual([])
  })
})
