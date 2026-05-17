// test/core/urlExtract/urlExtractTool.test.ts
//
// Spec for the UrlExtractTool wrapper. Each action gets happy-path
// shape assertions plus the option variants the user prompt pinned
// (so future refactors can't silently change the output vocabulary).
// Validation tests exercise both the missing-required and wrong-type
// rejection paths.

import { describe, expect, it } from 'vitest'
import {
  URL_EXTRACT_TOOL_NAME,
  UrlExtractTool,
  runUrlExtractTool,
  type UrlExtractToolInput,
  type UrlExtractToolResult,
} from '../../../src/core/urlExtract/urlExtractTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): UrlExtractToolResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as UrlExtractToolResult
}

// ─── metadata / schema ─────────────────────────────────────────────────

describe('UrlExtract tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(UrlExtractTool.name).toBe(URL_EXTRACT_TOOL_NAME)
    expect(URL_EXTRACT_TOOL_NAME).toBe('UrlExtract')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(UrlExtractTool.annotations?.readOnly).toBe(true)
    expect(UrlExtractTool.annotations?.parallelSafe).toBe(true)
    expect(
      UrlExtractTool.needsPermission({ action: 'extract', text: '' }),
    ).toBe('none')
  })

  it('declares required action+text with the documented enum', () => {
    const params = UrlExtractTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'text'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual([
      'extract',
      'isUrl',
      'extractMarkdownLinks',
    ])
  })

  it('loads under the core activation rule and surfaces url keywords', () => {
    expect(UrlExtractTool.tags).toContain('core')
    expect(UrlExtractTool.tags).toContain('urlExtract')
    expect(UrlExtractTool.searchHint).toContain('url')
    expect(UrlExtractTool.searchHint).toContain('link')
  })
})

// ─── action='extract' ──────────────────────────────────────────────────

describe('UrlExtract — action=extract', () => {
  it('detects a plain HTTPS URL', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: 'See https://example.com here.' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('extract')
    if (payload.action === 'extract') {
      expect(payload.count).toBe(1)
      expect(payload.urls[0]?.url).toBe('https://example.com')
      expect(payload.urls[0]?.kind).toBe('http')
    }
  })

  it('detects a plain HTTP URL', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: 'See http://example.com.' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.count).toBe(1)
      expect(payload.urls[0]?.url).toBe('http://example.com')
      expect(payload.urls[0]?.kind).toBe('http')
    }
  })

  it('records start/end offsets into the source string', async () => {
    const text = 'See https://example.com.'
    const r = await UrlExtractTool.run({ action: 'extract', text }, mkCtx())
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      const m = payload.urls[0]
      expect(m?.start).toBe(text.indexOf('https://'))
      expect(m?.end).toBe(m!.start + 'https://example.com'.length)
    }
  })

  it('trims trailing prose punctuation (period at sentence end)', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: 'Try https://example.com.' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.urls[0]?.url).toBe('https://example.com')
    }
  })

  it('trims a trailing comma', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: 'See https://example.com, then continue.' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.urls[0]?.url).toBe('https://example.com')
    }
  })

  it('preserves balanced parens inside the URL', async () => {
    const text = 'See https://en.wikipedia.org/wiki/Foo_(bar) here.'
    const r = await UrlExtractTool.run({ action: 'extract', text }, mkCtx())
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.urls[0]?.url).toBe(
        'https://en.wikipedia.org/wiki/Foo_(bar)',
      )
    }
  })

  it('strips an unbalanced trailing close-paren', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: '(see https://example.com)' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.urls[0]?.url).toBe('https://example.com')
    }
  })

  it("detects emails as kind 'mailto'", async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: 'Reply to user@example.com please.' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.count).toBe(1)
      expect(payload.urls[0]?.url).toBe('user@example.com')
      expect(payload.urls[0]?.kind).toBe('mailto')
    }
  })

  it('detects mailto: URIs as kind mailto', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: 'Email mailto:user@example.com today.' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.urls[0]?.url).toBe('mailto:user@example.com')
      expect(payload.urls[0]?.kind).toBe('mailto')
    }
  })

  it("respects the `kinds` filter — http only ignores mailto", async () => {
    const r = await UrlExtractTool.run(
      {
        action: 'extract',
        text: 'visit https://example.com or mailto:a@b.com',
        kinds: ['http'],
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.count).toBe(1)
      expect(payload.urls[0]?.kind).toBe('http')
    }
  })

  it("respects the `kinds` filter — mailto only", async () => {
    const r = await UrlExtractTool.run(
      {
        action: 'extract',
        text: 'visit https://example.com or mailto:a@b.com',
        kinds: ['mailto'],
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.count).toBe(1)
      expect(payload.urls[0]?.kind).toBe('mailto')
    }
  })

  it('includeBareDomain enables schemeless host detection', async () => {
    const r = await UrlExtractTool.run(
      {
        action: 'extract',
        text: 'go to example.com for more',
        includeBareDomain: true,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.urls.some(u => u.kind === 'bare-domain')).toBe(true)
    }
  })

  it('returns empty list / count=0 for prose with no URLs', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: 'just plain prose, nothing URL-shaped here' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.count).toBe(0)
      expect(payload.urls).toEqual([])
    }
  })

  it('tags URLs inside markdown links with inMarkdownLink=true', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: 'See [docs](https://example.com).' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extract') {
      expect(payload.count).toBe(1)
      expect(payload.urls[0]?.inMarkdownLink).toBe(true)
      expect(payload.urls[0]?.url).toBe('https://example.com')
    }
  })
})

// ─── action='isUrl' ────────────────────────────────────────────────────

describe('UrlExtract — action=isUrl', () => {
  it('returns isUrl=true for a bare URL string', async () => {
    const r = await UrlExtractTool.run(
      { action: 'isUrl', text: 'https://example.com' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('isUrl')
    if (payload.action === 'isUrl') {
      expect(payload.isUrl).toBe(true)
      expect(payload.text).toBe('https://example.com')
    }
  })

  it('returns isUrl=true for prose containing a URL', async () => {
    const r = await UrlExtractTool.run(
      { action: 'isUrl', text: 'Visit https://example.com soon.' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'isUrl') {
      expect(payload.isUrl).toBe(true)
    }
  })

  it('returns isUrl=false for plain prose', async () => {
    const r = await UrlExtractTool.run(
      { action: 'isUrl', text: 'plain prose with no URL inside' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'isUrl') {
      expect(payload.isUrl).toBe(false)
    }
  })

  it('returns isUrl=false for empty text', async () => {
    const r = await UrlExtractTool.run(
      { action: 'isUrl', text: '' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'isUrl') {
      expect(payload.isUrl).toBe(false)
      expect(payload.text).toBe('')
    }
  })
})

// ─── action='extractMarkdownLinks' ─────────────────────────────────────

describe('UrlExtract — action=extractMarkdownLinks', () => {
  it("parses an inline link `[text](url)`", async () => {
    const r = await UrlExtractTool.run(
      {
        action: 'extractMarkdownLinks',
        text: 'See [docs](https://example.com) here.',
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('extractMarkdownLinks')
    if (payload.action === 'extractMarkdownLinks') {
      expect(payload.count).toBe(1)
      expect(payload.links[0]?.text).toBe('docs')
      expect(payload.links[0]?.url).toBe('https://example.com')
      expect(payload.links[0]?.type).toBe('inline')
      expect(typeof payload.links[0]?.start).toBe('number')
      expect(typeof payload.links[0]?.end).toBe('number')
    }
  })

  it('parses a reference-style link `[ref]: url`', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extractMarkdownLinks', text: '[1]: https://example.com' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extractMarkdownLinks') {
      expect(payload.count).toBe(1)
      expect(payload.links[0]?.text).toBe('1')
      expect(payload.links[0]?.url).toBe('https://example.com')
      expect(payload.links[0]?.type).toBe('reference')
    }
  })

  it('returns an empty list for prose with no links', async () => {
    const r = await UrlExtractTool.run(
      {
        action: 'extractMarkdownLinks',
        text: 'plain prose, no brackets here',
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extractMarkdownLinks') {
      expect(payload.count).toBe(0)
      expect(payload.links).toEqual([])
    }
  })

  it('returns multiple links in source order', async () => {
    const r = await UrlExtractTool.run(
      {
        action: 'extractMarkdownLinks',
        text: '[a](https://a.com) and [b](https://b.com)',
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'extractMarkdownLinks') {
      expect(payload.count).toBe(2)
      expect(payload.links[0]?.text).toBe('a')
      expect(payload.links[1]?.text).toBe('b')
      expect(payload.links[0]!.start).toBeLessThan(payload.links[1]!.start)
    }
  })
})

// ─── validation ────────────────────────────────────────────────────────

describe('UrlExtract — validation', () => {
  it('rejects an invalid action with a structured error', async () => {
    const r = await UrlExtractTool.run(
      { action: 'bogus', text: 'hi' } as unknown as UrlExtractToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/unknown action 'bogus'/)
  })

  it('rejects a non-string action', async () => {
    const r = await UrlExtractTool.run(
      { action: 42 as unknown as 'extract', text: 'hi' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'action' must be a string/)
  })

  it('rejects missing text', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract' } as unknown as UrlExtractToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'text' must be a string/)
  })

  it('rejects non-string text', async () => {
    const r = await UrlExtractTool.run(
      { action: 'extract', text: 123 as unknown as string },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'text' must be a string/)
  })

  it('rejects an unknown kind in the kinds filter', async () => {
    const r = await UrlExtractTool.run(
      {
        action: 'extract',
        text: 'hi',
        kinds: ['gopher' as unknown as 'http'],
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/unknown kind 'gopher'/)
  })

  it('rejects non-array kinds', async () => {
    const r = await UrlExtractTool.run(
      {
        action: 'extract',
        text: 'hi',
        kinds: 'http' as unknown as ReadonlyArray<'http'>,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'kinds' must be an array/)
  })

  it('rejects non-boolean includeBareDomain', async () => {
    const r = await UrlExtractTool.run(
      {
        action: 'extract',
        text: 'hi',
        includeBareDomain: 'yes' as unknown as boolean,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'includeBareDomain' must be a boolean/)
  })

  it('rejects non-object input', async () => {
    const r = await UrlExtractTool.run(
      null as unknown as UrlExtractToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/input must be an object/)
  })
})

// ─── exported pure helper ──────────────────────────────────────────────

describe('runUrlExtractTool — direct invocation', () => {
  it('returns the same shape as the Tool run for extract', () => {
    const payload = runUrlExtractTool({
      action: 'extract',
      text: 'https://example.com',
    })
    expect(payload.action).toBe('extract')
    if (payload.action === 'extract') {
      expect(payload.count).toBe(1)
      expect(payload.urls[0]?.url).toBe('https://example.com')
    }
  })

  it('returns the same shape as the Tool run for isUrl', () => {
    const payload = runUrlExtractTool({
      action: 'isUrl',
      text: 'https://example.com',
    })
    if (payload.action === 'isUrl') {
      expect(payload.isUrl).toBe(true)
    }
  })

  it('returns the same shape as the Tool run for extractMarkdownLinks', () => {
    const payload = runUrlExtractTool({
      action: 'extractMarkdownLinks',
      text: '[x](https://example.com)',
    })
    if (payload.action === 'extractMarkdownLinks') {
      expect(payload.count).toBe(1)
      expect(payload.links[0]?.type).toBe('inline')
    }
  })
})
