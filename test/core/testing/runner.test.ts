// test/core/testing/runner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { runPlan } from '../../../src/core/testing/runner'
import { parsePlan } from '../../../src/core/testing/plan'

let tmpdir: string
beforeEach(async () => {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuka-runner-'))
})
afterEach(async () => {
  await fs.rm(tmpdir, { recursive: true, force: true })
})

describe('runPlan — end-to-end', () => {
  it('runs a 5-step plan covering render/keystroke/wait/assert/mock', async () => {
    const plan = parsePlan(`
name: smoke
mockResponses:
  - delta: [{ type: text_delta, text: "x" }]
steps:
  - render: wizard
  - assert: { contains: "Welcome" }
  - keystroke: "\\r"
  - wait: { ms: 5 }
  - assert: { contains: "Choose a provider" }
`)
    const result = await runPlan(plan, { cwd: tmpdir })
    expect(result.ok).toBe(true)
    expect(result.steps).toHaveLength(5)
    expect(result.steps.every(s => s.ok)).toBe(true)
    expect(result.frames.length).toBeGreaterThan(0)
  })

  it('reports ok:false with a step message when an assertion fails', async () => {
    const plan = parsePlan(`
name: failing
steps:
  - render: wizard
  - assert: { contains: "definitely-not-in-frame-12345" }
`)
    const result = await runPlan(plan, { cwd: tmpdir })
    expect(result.ok).toBe(false)
    const failing = result.steps.find(s => !s.ok)!
    expect(failing.kind).toBe('assert')
    expect(failing.message).toMatch(/definitely-not-in-frame/)
  })

  it('continues to subsequent steps after a failure', async () => {
    const plan = parsePlan(`
name: continue-after-fail
steps:
  - render: wizard
  - assert: { contains: "nope-zzz" }
  - assert: { contains: "Welcome" }
`)
    const result = await runPlan(plan, { cwd: tmpdir })
    expect(result.ok).toBe(false)
    expect(result.steps.map(s => s.ok)).toEqual([true, false, true])
  })

  it('wait { until } resolves when matcher becomes true', async () => {
    const plan = parsePlan(`
name: wait-until
steps:
  - render: wizard
  - keystroke: "\\r"
  - wait:
      until: { contains: "Choose a provider" }
      timeoutMs: 500
`)
    const result = await runPlan(plan, { cwd: tmpdir })
    expect(result.ok).toBe(true)
  })

  it('wait { until } records failure on timeout', async () => {
    const plan = parsePlan(`
name: wait-timeout
steps:
  - render: wizard
  - wait:
      until: { contains: "this-string-never-appears" }
      timeoutMs: 30
`)
    const result = await runPlan(plan, { cwd: tmpdir })
    expect(result.ok).toBe(false)
    expect(result.steps[1]!.message).toMatch(/timed out/)
  })
})

describe('runPlan — snapshots', () => {
  it('writes snapshot when updateSnapshots is true', async () => {
    const plan = parsePlan(`
name: snap-write
steps:
  - render: wizard
  - snapshot: my-snap
`)
    const result = await runPlan(plan, { cwd: tmpdir, updateSnapshots: true })
    expect(result.ok).toBe(true)
    const file = path.join(tmpdir, 'test-plans', '__snapshots__', 'my-snap.txt')
    const content = await fs.readFile(file, 'utf8')
    expect(content.length).toBeGreaterThan(0)
  })

  it('passes when current frame matches saved snapshot', async () => {
    // First run writes the snapshot.
    const plan = parsePlan(`
name: snap-compare
steps:
  - render: wizard
  - snapshot: snap-eq
`)
    await runPlan(plan, { cwd: tmpdir, updateSnapshots: true })
    // Second run compares.
    const result = await runPlan(plan, { cwd: tmpdir })
    expect(result.ok).toBe(true)
  })

  it('produces a diff message when snapshot differs', async () => {
    const file = path.join(tmpdir, 'test-plans', '__snapshots__', 'wrong.txt')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, 'totally different content here', 'utf8')
    const plan = parsePlan(`
name: snap-diff
steps:
  - render: wizard
  - snapshot: wrong
`)
    const result = await runPlan(plan, { cwd: tmpdir })
    expect(result.ok).toBe(false)
    const snap = result.steps.find(s => s.kind === 'snapshot')!
    expect(snap.ok).toBe(false)
    expect(snap.message).toMatch(/snapshot mismatch/)
  })

  it('reports a clear message when snapshot file is missing', async () => {
    const plan = parsePlan(`
name: snap-missing
steps:
  - render: wizard
  - snapshot: never-saved
`)
    const result = await runPlan(plan, { cwd: tmpdir })
    expect(result.ok).toBe(false)
    expect(result.steps[1]!.message).toMatch(/snapshot missing/)
  })
})

describe('runPlan — mock step', () => {
  it('appends a scripted response to the mock provider', async () => {
    const plan = parsePlan(`
name: mock-append
steps:
  - render: wizard
  - mock:
      provider:
        append:
          delta: [{ type: text_delta, text: "later" }]
`)
    const result = await runPlan(plan, { cwd: tmpdir })
    expect(result.ok).toBe(true)
    expect(result.steps[1]!.kind).toBe('mock')
  })
})
