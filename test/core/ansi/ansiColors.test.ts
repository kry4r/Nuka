// test/core/ansi/ansiColors.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  RESET,
  sgr,
  red,
  green,
  blue,
  yellow,
  black,
  white,
  gray,
  redBright,
  greenBright,
  blueBright,
  bgRed,
  bgGreen,
  bgRedBright,
  bold,
  dim,
  italic,
  underline,
  strikethrough,
  inverse,
  hidden,
  color256,
  color256Bg,
  rgb,
  rgbBg,
  style,
  compose,
  stripAnsi,
  enableColors,
  disableColors,
  colorsAreEnabled,
  refreshSupportsColor,
  supportsColor,
  clearLine,
  clearScreen,
  moveTo,
  cursorHide,
  cursorShow,
} from '../../../src/core/ansi'

// Building expected strings via `String.fromCharCode(27)` so this
// file stays readable in any editor.
const E = String.fromCharCode(27)

// Helper: every test in this file wants colors enabled regardless of
// the host environment (CI sometimes runs without a TTY).
beforeEach(() => {
  enableColors()
})

describe('RESET / sgr', () => {
  it('RESET is the full-reset SGR', () => {
    expect(RESET).toBe(`${E}[0m`)
  })

  it('sgr() builds a single-param sequence', () => {
    expect(sgr(31)).toBe(`${E}[31m`)
  })

  it('sgr() accepts a multi-param string', () => {
    expect(sgr('38;5;200')).toBe(`${E}[38;5;200m`)
  })
})

describe('basic 8 foreground colors', () => {
  it('red → 31 / 39', () => {
    expect(red('x')).toBe(`${E}[31mx${E}[39m`)
  })

  it.each([
    ['black', black, 30],
    ['red', red, 31],
    ['green', green, 32],
    ['yellow', yellow, 33],
    ['blue', blue, 34],
    ['white', white, 37],
  ] as const)('%s → %i / 39', (_name, fn, code) => {
    expect(fn('hi')).toBe(`${E}[${code}mhi${E}[39m`)
  })

  it('gray uses code 90 (bright-black)', () => {
    expect(gray('hi')).toBe(`${E}[90mhi${E}[39m`)
  })
})

describe('bright 8 foreground colors', () => {
  it.each([
    ['redBright', redBright, 91],
    ['greenBright', greenBright, 92],
    ['blueBright', blueBright, 94],
  ] as const)('%s → %i (90-97 range) / 39', (_name, fn, code) => {
    expect(fn('hi')).toBe(`${E}[${code}mhi${E}[39m`)
    expect(code).toBeGreaterThanOrEqual(90)
    expect(code).toBeLessThanOrEqual(97)
  })
})

describe('background colors', () => {
  it('bgRed → 41 / 49', () => {
    expect(bgRed('x')).toBe(`${E}[41mx${E}[49m`)
  })

  it('bgGreen → 42 / 49', () => {
    expect(bgGreen('x')).toBe(`${E}[42mx${E}[49m`)
  })

  it('bgRedBright uses 100-107 range', () => {
    expect(bgRedBright('x')).toBe(`${E}[101mx${E}[49m`)
  })
})

describe('style modifiers', () => {
  it.each([
    ['bold', bold, 1, 22],
    ['dim', dim, 2, 22],
    ['italic', italic, 3, 23],
    ['underline', underline, 4, 24],
    ['inverse', inverse, 7, 27],
    ['hidden', hidden, 8, 28],
    ['strikethrough', strikethrough, 9, 29],
  ] as const)('%s → %i open / %i close', (_name, fn, open, close) => {
    expect(fn('hi')).toBe(`${E}[${open}mhi${E}[${close}m`)
  })

  it('bold and dim share close=22', () => {
    // ECMA-48: 22 = "normal intensity"
    expect(bold('x')).toContain(`${E}[22m`)
    expect(dim('x')).toContain(`${E}[22m`)
  })
})

describe('256-color palette', () => {
  it('color256(0) emits 38;5;0', () => {
    expect(color256('hi', 0)).toBe(`${E}[38;5;0mhi${E}[39m`)
  })

  it('color256(127) emits 38;5;127', () => {
    expect(color256('hi', 127)).toBe(`${E}[38;5;127mhi${E}[39m`)
  })

  it('color256(255) emits 38;5;255', () => {
    expect(color256('hi', 255)).toBe(`${E}[38;5;255mhi${E}[39m`)
  })

  it('color256Bg uses 48;5;N', () => {
    expect(color256Bg('hi', 200)).toBe(`${E}[48;5;200mhi${E}[49m`)
  })

  it('rejects out-of-range (negative)', () => {
    expect(() => color256('hi', -1)).toThrow(RangeError)
  })

  it('rejects out-of-range (256)', () => {
    expect(() => color256('hi', 256)).toThrow(RangeError)
  })

  it('rejects non-integer', () => {
    expect(() => color256('hi', 1.5)).toThrow(RangeError)
  })

  it('color256Bg rejects out-of-range', () => {
    expect(() => color256Bg('hi', 500)).toThrow(RangeError)
  })
})

describe('true-color RGB', () => {
  it('rgb(0,0,0) → 38;2;0;0;0', () => {
    expect(rgb('x', 0, 0, 0)).toBe(`${E}[38;2;0;0;0mx${E}[39m`)
  })

  it('rgb(255,255,255) → 38;2;255;255;255', () => {
    expect(rgb('x', 255, 255, 255)).toBe(`${E}[38;2;255;255;255mx${E}[39m`)
  })

  it('rgb mid-tone', () => {
    expect(rgb('x', 128, 64, 200)).toBe(`${E}[38;2;128;64;200mx${E}[39m`)
  })

  it('rgbBg uses 48;2;R;G;B', () => {
    expect(rgbBg('x', 10, 20, 30)).toBe(`${E}[48;2;10;20;30mx${E}[49m`)
  })

  it.each([
    [-1, 0, 0],
    [256, 0, 0],
    [0, -1, 0],
    [0, 256, 0],
    [0, 0, -1],
    [0, 0, 256],
    [1.5, 0, 0],
  ])('rgb rejects out-of-range channel %i, %i, %i', (r, g, b) => {
    expect(() => rgb('x', r, g, b)).toThrow(RangeError)
  })

  it('rgbBg rejects out-of-range', () => {
    expect(() => rgbBg('x', 0, 0, 999)).toThrow(RangeError)
  })
})

describe('style() composition', () => {
  it('returns text unchanged with no modifiers', () => {
    expect(style('hi')).toBe('hi')
  })

  it('applies a single modifier', () => {
    expect(style('hi', 'red')).toBe(red('hi'))
  })

  it('composes red + bold with leftmost outermost', () => {
    // red(bold('hi')) = '\x1b[31m\x1b[1mhi\x1b[22m\x1b[39m'
    expect(style('hi', 'red', 'bold')).toBe(`${E}[31m${E}[1mhi${E}[22m${E}[39m`)
  })

  it('order matters: bold + red flips outer/inner', () => {
    expect(style('hi', 'bold', 'red')).toBe(`${E}[1m${E}[31mhi${E}[39m${E}[22m`)
  })

  it('combines bg + fg + style', () => {
    expect(style('x', 'bgBlue', 'yellow', 'bold')).toBe(
      `${E}[44m${E}[33m${E}[1mx${E}[22m${E}[39m${E}[49m`,
    )
  })

  it('throws on unknown style name', () => {
    expect(() => style('x', 'pinkish' as never)).toThrow(TypeError)
  })
})

describe('compose() reusable styler', () => {
  it('returns a function', () => {
    const warn = compose('yellow', 'bold')
    expect(typeof warn).toBe('function')
  })

  it('output matches style()', () => {
    const warn = compose('yellow', 'bold')
    expect(warn('careful')).toBe(style('careful', 'yellow', 'bold'))
  })

  it('reuses across calls', () => {
    const warn = compose('yellow')
    expect(warn('a')).toBe(yellow('a'))
    expect(warn('b')).toBe(yellow('b'))
  })

  it('validates names at compose-time, not call-time', () => {
    expect(() => compose('mauve' as never)).toThrow(TypeError)
  })

  it('empty modifier list returns the identity', () => {
    const noop = compose()
    expect(noop('hi')).toBe('hi')
  })

  it('respects later disableColors()', () => {
    const warn = compose('yellow', 'bold')
    expect(warn('hi')).toContain(E)
    disableColors()
    expect(warn('hi')).toBe('hi')
  })
})

describe('stripAnsi re-export', () => {
  it('reverses our output', () => {
    expect(stripAnsi(red('hello'))).toBe('hello')
    expect(stripAnsi(style('x', 'red', 'bold'))).toBe('x')
    expect(stripAnsi(rgb('rainbow', 200, 100, 50))).toBe('rainbow')
  })

  it('handles empty', () => {
    expect(stripAnsi('')).toBe('')
  })
})

describe('nested styles preserve outer color', () => {
  it('red(green(x)) re-opens red after green close', () => {
    const out = red(green('x'))
    // Inner green closes with `39` (default fg). Without re-opening,
    // the rest of red's span would be default-color. Our `wrap`
    // re-emits red's `31` after every inner `39`.
    expect(out).toContain(`${E}[31m`) // outer open
    expect(out).toContain(`${E}[32m`) // inner open
    // After the inner `[39m` we should see `[31m` re-opened.
    const idx = out.indexOf(`${E}[39m`)
    expect(idx).toBeGreaterThan(-1)
    const afterClose = out.slice(idx + `${E}[39m`.length)
    expect(afterClose.startsWith(`${E}[31m`)).toBe(true)
  })

  it('bold(red(x)) round-trips through stripAnsi', () => {
    expect(stripAnsi(bold(red('x')))).toBe('x')
  })

  it('deeply nested triple', () => {
    const out = red(green(blue('inner')))
    expect(stripAnsi(out)).toBe('inner')
  })
})

describe('global enable / disable toggle', () => {
  afterEach(() => {
    enableColors() // restore for subsequent suites
  })

  it('disableColors makes helpers return plain text', () => {
    disableColors()
    expect(colorsAreEnabled()).toBe(false)
    expect(red('hi')).toBe('hi')
    expect(bold('hi')).toBe('hi')
    expect(rgb('hi', 1, 2, 3)).toBe('hi')
    expect(color256('hi', 10)).toBe('hi')
    expect(style('hi', 'red', 'bold')).toBe('hi')
  })

  it('enableColors restores ANSI output', () => {
    disableColors()
    expect(red('hi')).toBe('hi')
    enableColors()
    expect(colorsAreEnabled()).toBe(true)
    expect(red('hi')).toBe(`${E}[31mhi${E}[39m`)
  })

  it('empty string short-circuits without escapes', () => {
    enableColors()
    expect(red('')).toBe('')
  })
})

describe('environment-driven supportsColor', () => {
  const prevNoColor = process.env['NO_COLOR']
  const prevForce = process.env['FORCE_COLOR']

  afterEach(() => {
    if (prevNoColor === undefined) delete process.env['NO_COLOR']
    else process.env['NO_COLOR'] = prevNoColor
    if (prevForce === undefined) delete process.env['FORCE_COLOR']
    else process.env['FORCE_COLOR'] = prevForce
    refreshSupportsColor()
    enableColors()
  })

  it('NO_COLOR forces off regardless of TTY', () => {
    process.env['NO_COLOR'] = '1'
    delete process.env['FORCE_COLOR']
    expect(supportsColor.stdout).toBe(false)
    expect(supportsColor.stderr).toBe(false)
    refreshSupportsColor()
    expect(colorsAreEnabled()).toBe(false)
    expect(red('hi')).toBe('hi')
  })

  it('FORCE_COLOR=1 forces on even without TTY', () => {
    delete process.env['NO_COLOR']
    process.env['FORCE_COLOR'] = '1'
    expect(supportsColor.stdout).toBe(true)
    expect(supportsColor.stderr).toBe(true)
    refreshSupportsColor()
    expect(colorsAreEnabled()).toBe(true)
  })

  it('FORCE_COLOR=0 forces off', () => {
    delete process.env['NO_COLOR']
    process.env['FORCE_COLOR'] = '0'
    expect(supportsColor.stdout).toBe(false)
    refreshSupportsColor()
    expect(colorsAreEnabled()).toBe(false)
  })

  it('FORCE_COLOR=false forces off', () => {
    delete process.env['NO_COLOR']
    process.env['FORCE_COLOR'] = 'false'
    expect(supportsColor.stdout).toBe(false)
  })

  it('NO_COLOR wins over FORCE_COLOR (per spec)', () => {
    process.env['NO_COLOR'] = '1'
    process.env['FORCE_COLOR'] = '1'
    expect(supportsColor.stdout).toBe(false)
  })
})

describe('cursor / screen control', () => {
  it('clearLine emits CSI 2K', () => {
    expect(clearLine()).toBe(`${E}[2K`)
  })

  it('clearScreen emits 2J + H', () => {
    expect(clearScreen()).toBe(`${E}[2J${E}[H`)
  })

  it('moveTo emits row;colH', () => {
    expect(moveTo(1, 1)).toBe(`${E}[1;1H`)
    expect(moveTo(10, 20)).toBe(`${E}[10;20H`)
  })

  it('moveTo rejects non-positive', () => {
    expect(() => moveTo(0, 1)).toThrow(RangeError)
    expect(() => moveTo(1, 0)).toThrow(RangeError)
    expect(() => moveTo(-1, 1)).toThrow(RangeError)
    expect(() => moveTo(1.5, 1)).toThrow(RangeError)
  })

  it('cursorHide / cursorShow toggle DECTCEM', () => {
    expect(cursorHide()).toBe(`${E}[?25l`)
    expect(cursorShow()).toBe(`${E}[?25h`)
  })

  it('all suppressed when colors disabled', () => {
    disableColors()
    expect(clearLine()).toBe('')
    expect(clearScreen()).toBe('')
    expect(moveTo(1, 1)).toBe('')
    expect(cursorHide()).toBe('')
    expect(cursorShow()).toBe('')
    enableColors()
  })
})
