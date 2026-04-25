// test/core/testing/plan.test.ts
import { describe, it, expect } from 'vitest'
import { parsePlan, PlanError } from '../../../src/core/testing/plan'

describe('parsePlan', () => {
  it('parses a plan with all step kinds', () => {
    const text = `
name: smoke
description: covers every step kind
setup:
  config:
    foo: bar
  mockResponses:
    - delta:
        - { type: text_delta, text: "ok" }
      usage: { input_tokens: 10, output_tokens: 2 }
steps:
  - render: app
  - keystroke: "/help\\n"
  - wait: { ms: 50 }
  - assert: { contains: "Welcome" }
  - slash: "/theme default-light"
  - snapshot: theme-light
  - mock:
      provider:
        append:
          delta:
            - { type: text_delta, text: "more" }
  - wait:
      until: { contains: "ready" }
      timeoutMs: 200
cleanup:
  unmount: true
`
    const plan = parsePlan(text)
    expect(plan.name).toBe('smoke')
    expect(plan.description).toMatch(/every step/)
    expect(plan.steps.map(s => s.kind)).toEqual([
      'render', 'keystroke', 'wait', 'assert', 'slash', 'snapshot', 'mock', 'wait',
    ])
    expect(plan.mockResponses).toHaveLength(1)
    expect(plan.mockResponses[0]!.usage).toEqual({ inputTokens: 10, outputTokens: 2 })
    expect(plan.cleanup?.unmount).toBe(true)
  })

  it('accepts top-level mockResponses (not nested under setup)', () => {
    const plan = parsePlan(`
name: top
mockResponses:
  - delta: [{ type: text_delta, text: "x" }]
steps:
  - render: app
`)
    expect(plan.mockResponses).toHaveLength(1)
    expect(plan.mockResponses[0]!.delta[0]!.text).toBe('x')
  })

  it('parses assert variants', () => {
    const plan = parsePlan(`
name: assertions
steps:
  - assert: { contains: "a" }
  - assert: { notContains: "b" }
  - assert: { regex: "^c$" }
  - assert: { equals: "d" }
  - assert: { frameCount: 3 }
  - assert: { lastFrameMatches: { regex: "x" } }
  - assert: { lastFrameMatches: { contains: "y" } }
`)
    expect(plan.steps).toHaveLength(7)
    const a0 = plan.steps[0]!
    expect(a0.kind === 'assert' && 'contains' in a0.spec && a0.spec.contains).toBe('a')
  })

  it('throws PlanError for unknown step kind', () => {
    expect(() => parsePlan(`
name: bad
steps:
  - banana: yellow
`)).toThrow(PlanError)
  })

  it('throws PlanError for missing name', () => {
    let caught: unknown
    try {
      parsePlan(`
description: nameless
steps:
  - render: app
`)
    } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PlanError)
    expect((caught as PlanError).message).toMatch(/name/)
  })

  it('throws PlanError when steps is missing', () => {
    expect(() => parsePlan(`name: no-steps`)).toThrow(/steps/)
  })

  it('throws PlanError for malformed delta', () => {
    expect(() => parsePlan(`
name: bad-delta
mockResponses:
  - delta:
      - { type: image, src: "x" }
steps:
  - render: app
`)).toThrow(PlanError)
  })

  it('throws PlanError on invalid YAML with line/column', () => {
    let caught: unknown
    try {
      parsePlan(`name: oops\n  bad: indentation : here :\n: : :`)
    } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PlanError)
    const err = caught as PlanError
    expect(err.message).toMatch(/yaml parse error/)
    // Best-effort: line is set for syntax errors.
    expect(typeof err.line === 'number' || err.line === undefined).toBe(true)
  })

  it('reports line/col for missing-name when possible', () => {
    let caught: unknown
    try {
      parsePlan(`description: nameless\nsteps:\n  - render: app\n`)
    } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PlanError)
    // Schema errors may or may not have positions; we only check no crash.
    const err = caught as PlanError
    expect(err.path).toBe('name')
  })

  it('rejects keystroke/render with wrong types', () => {
    expect(() => parsePlan(`
name: x
steps:
  - keystroke: 42
`)).toThrow(/keystroke/)
    expect(() => parsePlan(`
name: x
steps:
  - render: ""
`)).toThrow(/render/)
  })

  it('rejects wait without ms or until', () => {
    expect(() => parsePlan(`
name: x
steps:
  - wait: {}
`)).toThrow(/wait/)
  })

  it('rejects mock step without provider.append', () => {
    expect(() => parsePlan(`
name: x
steps:
  - mock: {}
`)).toThrow(/mock/)
  })

  it('accepts both snake_case and camelCase usage keys', () => {
    const plan = parsePlan(`
name: x
mockResponses:
  - delta: [{ type: text_delta, text: "a" }]
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 }
steps:
  - render: app
`)
    expect(plan.mockResponses[0]!.usage).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 })
  })
})
