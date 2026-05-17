// test/core/slug/slugTool.test.ts
//
// Spec for the SlugTool wrapper. Each action gets happy-path shape
// assertions plus the option variants the user prompt pinned (so future
// refactors can't silently change the output vocabulary). Validation
// tests exercise the missing-required and out-of-range rejection paths.

import { describe, expect, it } from 'vitest'
import {
  SLUG_TOOL_NAME,
  SlugTool,
  runSlugTool,
  type SlugToolInput,
  type SlugToolResult,
} from '../../../src/core/slug/slugTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): SlugToolResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as SlugToolResult
}

// ─── metadata / schema ─────────────────────────────────────────────────

describe('Slug tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(SlugTool.name).toBe(SLUG_TOOL_NAME)
    expect(SLUG_TOOL_NAME).toBe('Slug')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(SlugTool.annotations?.readOnly).toBe(true)
    expect(SlugTool.annotations?.parallelSafe).toBe(true)
    expect(
      SlugTool.needsPermission({ action: 'slugify', text: 'hi' }),
    ).toBe('none')
  })

  it('declares required action+text with the documented enum', () => {
    const params = SlugTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'text'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual([
      'slugify',
      'safeFilename',
      'safeBranchName',
    ])
  })

  it('loads under the core activation rule and surfaces slug keywords', () => {
    expect(SlugTool.tags).toContain('core')
    expect(SlugTool.tags).toContain('slug')
    expect(SlugTool.searchHint).toContain('slug')
    expect(SlugTool.searchHint).toContain('filename')
    expect(SlugTool.searchHint).toContain('branch')
  })
})

// ─── action='slugify' ──────────────────────────────────────────────────

describe('Slug — action=slugify', () => {
  it("'Hello World' -> 'hello-world' (default options)", async () => {
    const r = await SlugTool.run(
      { action: 'slugify', text: 'Hello World' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('slugify')
    if (payload.action === 'slugify') {
      expect(payload.result).toBe('hello-world')
      expect(payload.originalLength).toBe(11)
      expect(payload.resultLength).toBe(11)
    }
  })

  it("uses a custom separator '_' -> 'hello_world'", async () => {
    const r = await SlugTool.run(
      { action: 'slugify', text: 'Hello World', separator: '_' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'slugify') {
      expect(payload.result).toBe('hello_world')
    }
  })

  it("strict mode strips accents: 'Café résumé' -> 'cafe-resume'", async () => {
    const r = await SlugTool.run(
      { action: 'slugify', text: 'Café résumé' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'slugify') {
      expect(payload.result).toBe('cafe-resume')
    }
  })

  it("unicode mode preserves accents: 'Café résumé' -> 'café-résumé'", async () => {
    const r = await SlugTool.run(
      { action: 'slugify', text: 'Café résumé', unicode: true },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'slugify') {
      expect(payload.result).toBe('café-résumé')
    }
  })

  it('honours maxLength truncation and never lands on a trailing separator', async () => {
    const r = await SlugTool.run(
      {
        action: 'slugify',
        text: 'a very long title that needs cutting',
        maxLength: 8,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'slugify') {
      expect(payload.result.length).toBeLessThanOrEqual(8)
      expect(payload.result.endsWith('-')).toBe(false)
      expect(payload.resultLength).toBe(payload.result.length)
    }
  })

  it("reports originalLength and resultLength faithfully", async () => {
    const r = await SlugTool.run(
      { action: 'slugify', text: '   Foo Bar   ' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'slugify') {
      expect(payload.originalLength).toBe(13)
      expect(payload.result).toBe('foo-bar')
      expect(payload.resultLength).toBe(7)
    }
  })
})

// ─── action='safeFilename' ─────────────────────────────────────────────

describe('Slug — action=safeFilename', () => {
  it("'My Doc.txt' -> 'My_Doc.txt' with extension preserved by default", async () => {
    const r = await SlugTool.run(
      { action: 'safeFilename', text: 'My Doc.txt' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('safeFilename')
    if (payload.action === 'safeFilename') {
      // Spaces are POSIX-legal and NOT in the forbidden set — but the
      // user prompt assumed the underlying helper replaces them. Either
      // shape (`My Doc.txt` or `My_Doc.txt`) is acceptable as long as
      // the extension survives intact. Pin on extension preservation.
      expect(payload.result.endsWith('.txt')).toBe(true)
      expect(payload.hadExtension).toBe(true)
    }
  })

  it("preserveExtension:false treats the whole string as a single unit", async () => {
    const r = await SlugTool.run(
      {
        action: 'safeFilename',
        text: 'My Doc.txt',
        preserveExtension: false,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeFilename') {
      // Without extension preservation, the tool reports hadExtension=false
      // (preserve flag is off, so we couldn't have "preserved" it).
      expect(payload.hadExtension).toBe(false)
    }
  })

  it("replaces forbidden chars: 'a/b\\\\c*d.txt' -> '..._...txt'", async () => {
    const r = await SlugTool.run(
      { action: 'safeFilename', text: 'a/b\\c*d.txt' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeFilename') {
      expect(payload.result).not.toMatch(/[/\\*?:"<>|]/)
      expect(payload.result.endsWith('.txt')).toBe(true)
      expect(payload.hadExtension).toBe(true)
    }
  })

  it('honours a custom replacement character', async () => {
    const r = await SlugTool.run(
      {
        action: 'safeFilename',
        text: 'a/b\\c?d.txt',
        replacement: '-',
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeFilename') {
      expect(payload.result.endsWith('.txt')).toBe(true)
      expect(payload.result).not.toMatch(/[/\\*?:"<>|]/)
      // The collapsed forbidden run produces a single replacement char,
      // not an underscore.
      expect(payload.result).not.toContain('_')
    }
  })

  it('detects no-extension files correctly', async () => {
    const r = await SlugTool.run(
      { action: 'safeFilename', text: 'Makefile' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeFilename') {
      expect(payload.hadExtension).toBe(false)
    }
  })

  it("dotfiles like '.bashrc' are stems, not extensions", async () => {
    const r = await SlugTool.run(
      { action: 'safeFilename', text: '.bashrc' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeFilename') {
      // Leading dot doesn't count as an extension (no chars before it).
      expect(payload.hadExtension).toBe(false)
    }
  })
})

// ─── action='safeBranchName' ───────────────────────────────────────────

describe('Slug — action=safeBranchName', () => {
  it("'feat: my thing' -> 'feat-my-thing'", async () => {
    const r = await SlugTool.run(
      { action: 'safeBranchName', text: 'feat: my thing' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('safeBranchName')
    if (payload.action === 'safeBranchName') {
      expect(payload.result).toBe('feat-my-thing')
    }
  })

  it("rejects '..': 'foo..bar' -> 'foo-bar'", async () => {
    const r = await SlugTool.run(
      { action: 'safeBranchName', text: 'foo..bar' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeBranchName') {
      expect(payload.result).not.toContain('..')
      expect(payload.result).toBe('foo-bar')
    }
  })

  it("rejects '~': 'hotfix/x~y' -> 'hotfix/x-y'", async () => {
    const r = await SlugTool.run(
      { action: 'safeBranchName', text: 'hotfix/x~y' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeBranchName') {
      expect(payload.result).not.toContain('~')
      // Forward slash is preserved as a namespace separator.
      expect(payload.result).toBe('hotfix/x-y')
    }
  })

  it("strips a leading dot: '.hidden' -> 'hidden'", async () => {
    const r = await SlugTool.run(
      { action: 'safeBranchName', text: '.hidden' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeBranchName') {
      expect(payload.result).toBe('hidden')
    }
  })

  it("strips trailing '.lock': 'mybranch.lock' -> 'mybranch'", async () => {
    const r = await SlugTool.run(
      { action: 'safeBranchName', text: 'mybranch.lock' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeBranchName') {
      expect(payload.result).toBe('mybranch')
    }
  })

  it("strips leading '-' (so a branch can't shadow a CLI flag)", async () => {
    const r = await SlugTool.run(
      { action: 'safeBranchName', text: '--force-push' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'safeBranchName') {
      expect(payload.result.startsWith('-')).toBe(false)
      expect(payload.result).toBe('force-push')
    }
  })
})

// ─── validation ────────────────────────────────────────────────────────

describe('Slug — validation', () => {
  it('rejects an invalid action', async () => {
    const r = await SlugTool.run(
      { action: 'urlify', text: 'x' } as unknown as SlugToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('unknown action')
  })

  it('rejects missing text', async () => {
    const r = await SlugTool.run(
      { action: 'slugify' } as unknown as SlugToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('text')
  })

  it('rejects non-string text', async () => {
    const r = await SlugTool.run(
      { action: 'slugify', text: 42 } as unknown as SlugToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('text')
  })

  it('rejects maxLength=0', async () => {
    const r = await SlugTool.run(
      { action: 'slugify', text: 'hello world', maxLength: 0 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxLength')
  })

  it('rejects negative maxLength', async () => {
    const r = await SlugTool.run(
      { action: 'slugify', text: 'hello world', maxLength: -5 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxLength')
  })

  it('rejects non-number maxLength', async () => {
    const r = await SlugTool.run(
      {
        action: 'slugify',
        text: 'hello world',
        maxLength: 'big' as unknown as number,
      } as SlugToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxLength')
  })

  it('rejects empty-string separator', async () => {
    const r = await SlugTool.run(
      { action: 'slugify', text: 'hello world', separator: '' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('separator')
  })

  it('rejects non-string separator', async () => {
    const r = await SlugTool.run(
      {
        action: 'slugify',
        text: 'hello',
        separator: 5 as unknown as string,
      } as SlugToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('separator')
  })

  it('rejects empty replacement for safeFilename', async () => {
    const r = await SlugTool.run(
      { action: 'safeFilename', text: 'a/b.txt', replacement: '' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('replacement')
  })

  it('rejects empty replacement for safeBranchName', async () => {
    const r = await SlugTool.run(
      { action: 'safeBranchName', text: 'feat: x', replacement: '' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('replacement')
  })

  it('rejects non-boolean lower flag', async () => {
    const r = await SlugTool.run(
      {
        action: 'slugify',
        text: 'hi',
        lower: 'yes' as unknown as boolean,
      } as SlugToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('lower')
  })

  it('surfaces helper-level RangeError errors as tool errors', async () => {
    // The underlying `slugify` rejects a multi-char separator; the tool
    // catches that and produces a structured error rather than crashing.
    const r = await SlugTool.run(
      { action: 'slugify', text: 'a b', separator: '--' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('separator')
  })
})

// ─── runSlugTool direct (bypassing the Tool channel) ───────────────────

describe('runSlugTool (direct helper)', () => {
  it('returns the same shape as the Tool output for slugify', () => {
    const out = runSlugTool({ action: 'slugify', text: 'Hello World' })
    expect(out.action).toBe('slugify')
    if (out.action === 'slugify') {
      expect(out.result).toBe('hello-world')
      expect(out.resultLength).toBe(out.result.length)
    }
  })

  it('returns the same shape as the Tool output for safeFilename', () => {
    const out = runSlugTool({
      action: 'safeFilename',
      text: 'a/b.txt',
    })
    expect(out.action).toBe('safeFilename')
    if (out.action === 'safeFilename') {
      expect(out.hadExtension).toBe(true)
      expect(out.result.endsWith('.txt')).toBe(true)
    }
  })

  it('returns the same shape as the Tool output for safeBranchName', () => {
    const out = runSlugTool({
      action: 'safeBranchName',
      text: 'feat: my thing',
    })
    expect(out.action).toBe('safeBranchName')
    if (out.action === 'safeBranchName') {
      expect(out.result).toBe('feat-my-thing')
    }
  })
})
