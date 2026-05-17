// test/core/duration/durationTool.test.ts
//
// Spec for the FormatDurationTool wrapper. Each action gets a happy-path
// shape assertion plus the format/parse/bytes variants the user prompt
// pinned (so future refactors can't silently change the output
// vocabulary). Validation tests exercise both the missing-required and
// wrong-type rejection paths.

import { describe, expect, it } from 'vitest'
import {
  FORMAT_DURATION_TOOL_NAME,
  FormatDurationTool,
  runFormatDuration,
  type FormatDurationInput,
  type FormatDurationResult,
} from '../../../src/core/duration/durationTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): FormatDurationResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as FormatDurationResult
}

describe('FormatDuration tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(FormatDurationTool.name).toBe(FORMAT_DURATION_TOOL_NAME)
    expect(FORMAT_DURATION_TOOL_NAME).toBe('FormatDuration')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(FormatDurationTool.annotations?.readOnly).toBe(true)
    expect(FormatDurationTool.annotations?.parallelSafe).toBe(true)
    expect(
      FormatDurationTool.needsPermission({ action: 'format', ms: 1 }),
    ).toBe('none')
  })

  it('declares required `action` with the documented enum', () => {
    const params = FormatDurationTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual([
      'format',
      'parse',
      'approx',
      'timestamp',
      'bytes',
    ])
  })

  it('loads under the core activation rule and surfaces format keywords', () => {
    expect(FormatDurationTool.tags).toContain('core')
    expect(FormatDurationTool.tags).toContain('duration')
    expect(FormatDurationTool.searchHint).toContain('duration')
    expect(FormatDurationTool.searchHint).toContain('parse')
  })
})

// ─── action='format' ────────────────────────────────────────────────

describe('FormatDuration — action=format', () => {
  it('returns the documented shape for 90000ms', async () => {
    const r = await FormatDurationTool.run(
      { action: 'format', ms: 90_000 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toMatchObject({
      action: 'format',
      result: '1m 30s',
      ms: 90_000,
    })
    // `units` is documented as optional but the implementation populates
    // it for inspection.
    expect((payload as { units?: string[] }).units).toEqual(
      expect.arrayContaining(['m', 's']),
    )
  })

  it('respects precision=1 (most-significant unit only)', async () => {
    const r = await FormatDurationTool.run(
      { action: 'format', ms: 90_000, precision: 1 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('format')
    if (payload.action === 'format') {
      expect(payload.result).toBe('1m')
    }
  })

  it('respects compact=true (no space between units)', async () => {
    const r = await FormatDurationTool.run(
      { action: 'format', ms: 90_000, compact: true },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('format')
    if (payload.action === 'format') {
      expect(payload.result).toBe('1m30s')
    }
  })

  it('respects verbose=true (long unit names)', async () => {
    const r = await FormatDurationTool.run(
      { action: 'format', ms: 90_000, verbose: true },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'format') {
      expect(payload.result).toBe('1 minute 30 seconds')
    }
  })
})

// ─── action='parse' ─────────────────────────────────────────────────

describe('FormatDuration — action=parse', () => {
  it('parses "1h 30m" to 5400000 ms with originalText preserved', async () => {
    const r = await FormatDurationTool.run(
      { action: 'parse', text: '1h 30m' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({
      action: 'parse',
      ms: 5_400_000,
      originalText: '1h 30m',
    })
  })

  it('rejects unparseable garbage with a descriptive error', async () => {
    const r = await FormatDurationTool.run(
      { action: 'parse', text: 'totally not a duration' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('parse')
    expect(r.output).toContain('Cannot parse duration')
  })

  it('accepts looser variants the underlying parser supports', async () => {
    const r = await FormatDurationTool.run(
      { action: 'parse', text: '90 minutes' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'parse') {
      expect(payload.ms).toBe(5_400_000)
    }
  })
})

// ─── action='approx' ────────────────────────────────────────────────

describe('FormatDuration — action=approx', () => {
  it('renders -3000ms (delta) as "3s ago"', async () => {
    // Per the spec, `ms` is the delta (target - now). The `now` field is
    // captured but not subtracted from `ms` — pass the delta directly.
    const r = await FormatDurationTool.run(
      { action: 'approx', ms: -3000, now: 4000 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toMatchObject({
      action: 'approx',
      result: '3s ago',
      ms: -3000,
    })
  })

  it('renders future deltas as "in X"', async () => {
    const r = await FormatDurationTool.run(
      { action: 'approx', ms: 5_000 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'approx') {
      expect(payload.result).toMatch(/^in /)
    }
  })

  it('renders sub-second deltas as "just now"', async () => {
    const r = await FormatDurationTool.run(
      { action: 'approx', ms: -500 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'approx') {
      expect(payload.result).toBe('just now')
    }
  })
})

// ─── action='timestamp' ─────────────────────────────────────────────

describe('FormatDuration — action=timestamp', () => {
  it('renders epoch 0 in ISO style by default with iso field for cross-ref', async () => {
    const r = await FormatDurationTool.run(
      { action: 'timestamp', date: 0 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({
      action: 'timestamp',
      result: '1970-01-01T00:00:00.000Z',
      iso: '1970-01-01T00:00:00.000Z',
    })
  })

  it('renders short style on demand', async () => {
    const r = await FormatDurationTool.run(
      { action: 'timestamp', date: 0, timestampFormat: 'short' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'timestamp') {
      expect(payload.result).toBe('1970-01-01 00:00:00')
      expect(payload.iso).toBe('1970-01-01T00:00:00.000Z')
    }
  })

  it('accepts ISO strings via the `date` field', async () => {
    const r = await FormatDurationTool.run(
      {
        action: 'timestamp',
        date: '2026-05-17T13:45:00.000Z',
        timestampFormat: 'date',
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'timestamp') {
      expect(payload.result).toBe('2026-05-17')
      expect(payload.iso).toBe('2026-05-17T13:45:00.000Z')
    }
  })

  it('rejects invalid date strings descriptively', async () => {
    const r = await FormatDurationTool.run(
      { action: 'timestamp', date: 'not-a-date' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('invalid date')
  })
})

// ─── action='bytes' ─────────────────────────────────────────────────

describe('FormatDuration — action=bytes', () => {
  it('renders 1024 as "1 KB"', async () => {
    const r = await FormatDurationTool.run(
      { action: 'bytes', bytes: 1024 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({
      action: 'bytes',
      result: '1 KB',
      bytes: 1024,
    })
  })

  it('applies decimals=2 to surface fractional precision (1500 -> "1.46 KB")', async () => {
    const r = await FormatDurationTool.run(
      { action: 'bytes', bytes: 1500, decimals: 2 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'bytes') {
      expect(payload.result).toBe('1.46 KB')
    }
  })

  it('renders sub-KB byte counts integer-style', async () => {
    const r = await FormatDurationTool.run(
      { action: 'bytes', bytes: 512 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'bytes') {
      expect(payload.result).toBe('512 B')
    }
  })
})

// ─── Validation ─────────────────────────────────────────────────────

describe('FormatDuration — input validation', () => {
  it('rejects an unknown action string', async () => {
    const r = await FormatDurationTool.run(
      { action: 'shenanigans' } as unknown as FormatDurationInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('unknown action')
    expect(r.output).toContain('Valid: format, parse, approx, timestamp, bytes')
  })

  it("rejects action='format' without ms", async () => {
    const r = await FormatDurationTool.run(
      { action: 'format' } as FormatDurationInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("action='format'")
    expect(r.output).toContain('ms')
  })

  it("rejects action='parse' without text", async () => {
    const r = await FormatDurationTool.run(
      { action: 'parse' } as FormatDurationInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("action='parse'")
    expect(r.output).toContain('text')
  })

  it("rejects action='approx' without ms", async () => {
    const r = await FormatDurationTool.run(
      { action: 'approx' } as FormatDurationInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("action='approx'")
  })

  it("rejects action='timestamp' without date", async () => {
    const r = await FormatDurationTool.run(
      { action: 'timestamp' } as FormatDurationInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("action='timestamp'")
    expect(r.output).toContain('date')
  })

  it("rejects action='bytes' without bytes", async () => {
    const r = await FormatDurationTool.run(
      { action: 'bytes' } as FormatDurationInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain("action='bytes'")
    expect(r.output).toContain('bytes')
  })

  it('rejects NaN / Infinity numeric inputs', async () => {
    const nan = await FormatDurationTool.run(
      { action: 'format', ms: Number.NaN },
      mkCtx(),
    )
    expect(nan.isError).toBe(true)
    expect(nan.output).toContain('finite number')

    const inf = await FormatDurationTool.run(
      { action: 'bytes', bytes: Number.POSITIVE_INFINITY },
      mkCtx(),
    )
    expect(inf.isError).toBe(true)
    expect(inf.output).toContain('finite number')
  })

  it("rejects action='timestamp' with an unsupported timestampFormat", async () => {
    const r = await FormatDurationTool.run(
      {
        action: 'timestamp',
        date: 0,
        timestampFormat: 'rfc2822' as unknown as 'iso',
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('timestampFormat')
  })
})

// ─── Direct runner ──────────────────────────────────────────────────

describe('runFormatDuration (direct entrypoint)', () => {
  it('returns structured payloads without going through JSON', () => {
    const p = runFormatDuration({ action: 'format', ms: 1500 })
    expect(p.action).toBe('format')
    if (p.action === 'format') {
      expect(p.result).toBe('1.5s')
      expect(p.ms).toBe(1500)
    }
  })
})
