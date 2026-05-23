import { describe, expect, it } from 'vitest'
import { renderWithViewport } from '../../src/core/testing/explorer/L0/render'
import { runAll } from '../../src/core/testing/explorer/L1/index'
import type { FixtureCase, FixtureDef, Viewport } from '../../src/core/testing/explorer/types'

const EXPECTED_CASES = [
  'main-screen-desktop',
  'main-screen-narrow',
  'long-conversation-desktop',
  'long-conversation-narrow',
  'model-picker-desktop',
  'model-picker-narrow',
  'provider-wizard-desktop',
  'provider-wizard-narrow',
  'task-panel-desktop',
  'task-panel-narrow',
  'statusline-desktop',
  'statusline-narrow',
] as const

describe('human TUI redesign baseline fixture', () => {
  it('covers the surfaces that need before/after captures', async () => {
    const mod = await import('./fixtures/iter-23-human-tui-baseline.fixtures')
    const fixture = mod.default as FixtureDef

    expect(fixture.component).toBe('HumanTuiBaseline')
    expect(fixture.sweepMode).toBe('explicit-only')
    expect(Object.keys(fixture.cases)).toEqual(EXPECTED_CASES)
    expect(fixture.viewports).toEqual([
      { cols: 120, rows: 30 },
      { cols: 70, rows: 24 },
    ] satisfies Viewport[])

    for (const name of EXPECTED_CASES) {
      const fixtureCase = fixture.cases[name]
      expect(fixtureCase, `${name} missing`).toBeDefined()
      expect(fixtureCase?.mustContain?.length, `${name} must contain visible anchors`).toBeGreaterThan(0)
    }
  })

  it('renders every baseline case with its visible anchors intact', async () => {
    const mod = await import('./fixtures/iter-23-human-tui-baseline.fixtures')
    const fixture = mod.default as FixtureDef

    for (const name of EXPECTED_CASES) {
      const fixtureCase = fixture.cases[name]
      expect(fixtureCase, `${name} missing`).toBeDefined()
      const viewport = viewportForCase(name)
      await expectNoL1Errors(name, fixtureCase!, viewport)
    }
  })
})

async function expectNoL1Errors(
  name: string,
  fixtureCase: FixtureCase,
  viewport: Viewport,
): Promise<void> {
  const handle = renderWithViewport(fixtureCase.render(), viewport)
  await new Promise<void>(resolve => setImmediate(resolve))

  const frame = handle.lastFrame()
  handle.unmount()

  const grid = handle.grid(frame)
  const errors = runAll(grid, {
    viewport,
    staticWrites: handle.staticWrites(),
    cursorTraces: handle.cursorTraces(),
    fixtureCase,
  }).filter(v => v.severity === 'error')

  expect(errors.map(v => `[${name}] ${v.rule}: ${v.message}`)).toEqual([])
}

function viewportForCase(name: string): Viewport {
  return name.endsWith('-narrow')
    ? { cols: 70, rows: 24 }
    : { cols: 120, rows: 30 }
}
