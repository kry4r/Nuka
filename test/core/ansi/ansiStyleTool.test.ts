// test/core/ansi/ansiStyleTool.test.ts
//
// Spec for the AnsiStyleTool wrapper. Each action gets happy-path
// shape assertions plus the option variants that matter (so future
// refactors can't silently change the output vocabulary). Validation
// tests exercise both the missing-required and wrong-type rejection
// paths.
//
// The underlying `style()` helper honors a module-level `colorsEnabled`
// flag that follows TTY detection by default; we flip it on explicitly
// so `apply` produces deterministic SGR sequences regardless of where
// the suite is executed (CI typically lacks a TTY).

import { beforeEach, describe, expect, it } from 'vitest'
import {
  ANSI_STYLE_TOOL_NAME,
  AnsiStyleTool,
  runAnsiStyleTool,
  type AnsiStyleToolInput,
  type AnsiStyleToolResult,
} from '../../../src/core/ansi/ansiStyleTool'
import {
  disableColors,
  enableColors,
  red,
  bold,
  style as ansiStyle,
} from '../../../src/core/ansi'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

const E = String.fromCharCode(27)

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): AnsiStyleToolResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as AnsiStyleToolResult
}

// Every test needs colors on so `apply` paths produce escape sequences.
beforeEach(() => {
  enableColors()
})

// ─── metadata / schema ─────────────────────────────────────────────────

describe('AnsiStyle tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(AnsiStyleTool.name).toBe(ANSI_STYLE_TOOL_NAME)
    expect(ANSI_STYLE_TOOL_NAME).toBe('AnsiStyle')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(AnsiStyleTool.annotations?.readOnly).toBe(true)
    expect(AnsiStyleTool.annotations?.parallelSafe).toBe(true)
    expect(
      AnsiStyleTool.needsPermission({ action: 'strip', text: 'hi' }),
    ).toBe('none')
  })

  it('declares required action+text with the documented enum', () => {
    const params = AnsiStyleTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'text'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual(['strip', 'has', 'apply'])
  })

  it('surfaces ANSI / terminal keywords for activation', () => {
    expect(AnsiStyleTool.tags).toContain('core')
    expect(AnsiStyleTool.tags).toContain('ansi')
    expect(AnsiStyleTool.searchHint).toContain('stripAnsi')
    expect(AnsiStyleTool.searchHint).toContain('color')
  })

  it('exposes every supported style as a JSON Schema enum', () => {
    const params = AnsiStyleTool.parameters as {
      properties?: {
        style?: { enum?: string[] }
      }
    }
    const styles = params.properties?.style?.enum
    expect(styles).toBeDefined()
    // Spot-check a representative slice — basic, bright, bg, modifier.
    expect(styles).toContain('red')
    expect(styles).toContain('redBright')
    expect(styles).toContain('bgRed')
    expect(styles).toContain('bgRedBright')
    expect(styles).toContain('bold')
    expect(styles).toContain('underline')
    expect(styles).toContain('strikethrough')
  })
})

// ─── action=strip ──────────────────────────────────────────────────────

describe('AnsiStyle — action=strip', () => {
  it('removes a simple SGR colored span', async () => {
    const colored = red('hello')
    const r = await AnsiStyleTool.run(
      { action: 'strip', text: colored },
      mkCtx(),
    )
    const p = parsePayload(r)
    expect(p.action).toBe('strip')
    if (p.action === 'strip') {
      expect(p.result).toBe('hello')
      expect(p.stripped).toBe(colored.length - 'hello'.length)
    }
  })

  it('strips 256-color and true-color sequences', async () => {
    // Hand-rolled to avoid coupling to the library's own helpers.
    const text = `${E}[38;5;200mhi${E}[39m there ${E}[38;2;1;2;3mok${E}[39m`
    const r = await AnsiStyleTool.run({ action: 'strip', text }, mkCtx())
    const p = parsePayload(r)
    if (p.action === 'strip') {
      expect(p.result).toBe('hi there ok')
    }
  })

  it('strips cursor-move and clear-line escapes too', async () => {
    // strip-ansi covers the broader CSI grammar, not just SGR.
    const text = `${E}[2K${E}[10;5H${E}[?25l visible ${E}[?25h`
    const r = await AnsiStyleTool.run({ action: 'strip', text }, mkCtx())
    const p = parsePayload(r)
    if (p.action === 'strip') {
      // After stripping CSI sequences only ' visible ' is left.
      expect(p.result).toBe(' visible ')
    }
  })

  it('returns plain text unchanged with stripped=0', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'strip', text: 'plain old text' },
      mkCtx(),
    )
    const p = parsePayload(r)
    if (p.action === 'strip') {
      expect(p.result).toBe('plain old text')
      expect(p.stripped).toBe(0)
    }
  })

  it('handles empty string', async () => {
    const r = await AnsiStyleTool.run({ action: 'strip', text: '' }, mkCtx())
    const p = parsePayload(r)
    if (p.action === 'strip') {
      expect(p.result).toBe('')
      expect(p.stripped).toBe(0)
    }
  })

  it('strips ANSI from multi-line text leaving plain lines intact', async () => {
    const text = `line1\n${red('line2-red')}\nline3\n${bold('line4-bold')}`
    const r = await AnsiStyleTool.run({ action: 'strip', text }, mkCtx())
    const p = parsePayload(r)
    if (p.action === 'strip') {
      expect(p.result).toBe('line1\nline2-red\nline3\nline4-bold')
    }
  })
})

// ─── action=has ────────────────────────────────────────────────────────

describe('AnsiStyle — action=has', () => {
  it('returns true when ANSI escapes are present', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'has', text: red('hi') },
      mkCtx(),
    )
    const p = parsePayload(r)
    expect(p.action).toBe('has')
    if (p.action === 'has') {
      expect(p.result).toBe(true)
    }
  })

  it('returns false for plain text', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'has', text: 'no escapes here' },
      mkCtx(),
    )
    const p = parsePayload(r)
    if (p.action === 'has') {
      expect(p.result).toBe(false)
    }
  })

  it('returns false for empty string', async () => {
    const r = await AnsiStyleTool.run({ action: 'has', text: '' }, mkCtx())
    const p = parsePayload(r)
    if (p.action === 'has') {
      expect(p.result).toBe(false)
    }
  })

  it('detects a stray SGR sequence anywhere in the input', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'has', text: `prefix ${E}[31m middle ${E}[39m suffix` },
      mkCtx(),
    )
    const p = parsePayload(r)
    if (p.action === 'has') {
      expect(p.result).toBe(true)
    }
  })
})

// ─── action=apply ──────────────────────────────────────────────────────

describe('AnsiStyle — action=apply', () => {
  it('wraps text with the primary style', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'apply', text: 'hi', style: 'red' },
      mkCtx(),
    )
    const p = parsePayload(r)
    expect(p.action).toBe('apply')
    if (p.action === 'apply') {
      expect(p.result).toBe(red('hi'))
      expect(p.colorsEnabled).toBe(true)
      expect(p.modifiers).toEqual(['red'])
    }
  })

  it('composes primary + extra modifiers in outer→inner order', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'apply', text: 'hi', style: 'red', extra: ['bold'] },
      mkCtx(),
    )
    const p = parsePayload(r)
    if (p.action === 'apply') {
      // Library invariant: `style(t, 'red', 'bold')` applies right-to-left
      // so red wraps the bold-wrapped text.
      expect(p.result).toBe(ansiStyle('hi', 'red', 'bold'))
      expect(p.modifiers).toEqual(['red', 'bold'])
    }
  })

  it('accepts every documented modifier (spot-check bright + bg + style)', async () => {
    const cases: AnsiStyleToolInput[] = [
      { action: 'apply', text: 'x', style: 'redBright' },
      { action: 'apply', text: 'x', style: 'bgGreen' },
      { action: 'apply', text: 'x', style: 'bgBlueBright' },
      { action: 'apply', text: 'x', style: 'underline' },
      { action: 'apply', text: 'x', style: 'strikethrough' },
      { action: 'apply', text: 'x', style: 'gray' },
    ]
    for (const input of cases) {
      const r = await AnsiStyleTool.run(input, mkCtx())
      const p = parsePayload(r)
      if (p.action === 'apply') {
        // Each must produce a non-empty escape-bearing string distinct from 'x'.
        expect(p.result).not.toBe('x')
        expect(p.result).toContain(E)
      }
    }
  })

  it('returns the input unchanged when colors are disabled', async () => {
    disableColors()
    const r = await AnsiStyleTool.run(
      { action: 'apply', text: 'plain', style: 'red' },
      mkCtx(),
    )
    const p = parsePayload(r)
    if (p.action === 'apply') {
      expect(p.result).toBe('plain')
      expect(p.colorsEnabled).toBe(false)
    }
  })

  it('handles empty string gracefully', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'apply', text: '', style: 'red' },
      mkCtx(),
    )
    const p = parsePayload(r)
    if (p.action === 'apply') {
      // Library short-circuits empty input to ''.
      expect(p.result).toBe('')
    }
  })
})

// ─── validation ────────────────────────────────────────────────────────

describe('AnsiStyle — validation', () => {
  it('rejects an invalid action', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'bogus', text: 'hi' } as unknown as AnsiStyleToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/unknown action 'bogus'/)
  })

  it('rejects a non-string action', async () => {
    const r = await AnsiStyleTool.run(
      { action: 99 as unknown as 'strip', text: 'hi' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'action' must be a string/)
  })

  it('rejects missing text', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'strip' } as unknown as AnsiStyleToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'text' must be a string/)
  })

  it('rejects non-string text', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'strip', text: 123 as unknown as string },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'text' must be a string/)
  })

  it('rejects apply without `style`', async () => {
    const r = await AnsiStyleTool.run(
      { action: 'apply', text: 'hi' } as unknown as AnsiStyleToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/action='apply': 'style' is required/)
  })

  it('rejects apply with unknown style', async () => {
    const r = await AnsiStyleTool.run(
      {
        action: 'apply',
        text: 'hi',
        style: 'rainbow' as unknown as 'red',
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/unknown style 'rainbow'/)
  })

  it('rejects apply.extra as non-array', async () => {
    const r = await AnsiStyleTool.run(
      {
        action: 'apply',
        text: 'hi',
        style: 'red',
        extra: 'bold' as unknown as ['bold'],
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'extra' must be an array/)
  })

  it('rejects apply.extra entries with invalid style names', async () => {
    const r = await AnsiStyleTool.run(
      {
        action: 'apply',
        text: 'hi',
        style: 'red',
        extra: ['bold', 'sparkle' as unknown as 'bold'],
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'extra\[1\]' is not a valid style/)
  })

  it('rejects non-object input', async () => {
    const r = await AnsiStyleTool.run(
      null as unknown as AnsiStyleToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/input must be an object/)
  })
})

// ─── exported pure helper ──────────────────────────────────────────────

describe('runAnsiStyleTool — direct invocation', () => {
  it('returns the same shape as the Tool run for strip', () => {
    const colored = red('abc')
    const payload = runAnsiStyleTool({ action: 'strip', text: colored })
    expect(payload.action).toBe('strip')
    if (payload.action === 'strip') {
      expect(payload.result).toBe('abc')
      expect(payload.stripped).toBe(colored.length - 'abc'.length)
    }
  })

  it('forwards modifiers to the underlying style() helper', () => {
    const payload = runAnsiStyleTool({
      action: 'apply',
      text: 'x',
      style: 'red',
      extra: ['bold'],
    })
    if (payload.action === 'apply') {
      expect(payload.result).toBe(ansiStyle('x', 'red', 'bold'))
      expect(payload.modifiers).toEqual(['red', 'bold'])
    }
  })
})
