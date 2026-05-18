// test/tui/Status/CostBanner.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { CostBanner } from '../../../src/tui/Status/CostBanner'
import { CostTracker } from '../../../src/core/cost/tracker'

describe('CostBanner', () => {
  it('renders nothing when enabled=false', () => {
    const tracker = new CostTracker()
    tracker.record('claude-haiku-4-5', 's1', { input: 100, output: 50 })
    const { lastFrame } = render(
      <CostBanner enabled={false} tracker={tracker} sessionId="s1" model="claude-haiku-4-5" />,
    )
    expect(lastFrame()?.trim() ?? '').toBe('')
  })

  it('renders nothing when the tracker has no entries for this session', () => {
    const tracker = new CostTracker()
    const { lastFrame } = render(
      <CostBanner enabled={true} tracker={tracker} sessionId="empty" model="claude-haiku-4-5" />,
    )
    expect(lastFrame()?.trim() ?? '').toBe('')
  })

  it('renders nothing when tracker is undefined', () => {
    const { lastFrame } = render(
      <CostBanner enabled={true} sessionId="s1" model="claude-haiku-4-5" />,
    )
    expect(lastFrame()?.trim() ?? '').toBe('')
  })

  it('renders the formatted banner line when enabled and entries exist', () => {
    const tracker = new CostTracker()
    tracker.record('claude-haiku-4-5', 's1', { input: 1000, output: 500 })
    const { lastFrame } = render(
      <CostBanner enabled={true} tracker={tracker} sessionId="s1" model="claude-haiku-4-5" />,
    )
    const out = lastFrame() ?? ''
    expect(out).toMatch(/cost/i)
    expect(out).toContain('1k')
  })

  it('renders tokens-only line when model has no pricing', () => {
    const tracker = new CostTracker()
    tracker.record('made-up-model', 's1', { input: 100, output: 50 })
    const { lastFrame } = render(
      <CostBanner enabled={true} tracker={tracker} sessionId="s1" model="made-up-model" />,
    )
    const out = lastFrame() ?? ''
    expect(out).toContain('100')
    expect(out).not.toContain('$')
  })
})

// App-level integration: verifies the banner is gated end-to-end by both the
// env var AND a tracker with entries. Uses the existing harness's
// `makeMinimalAppDeps` (so we share the same costTracker instance App sees)
// and mounts via `target: 'custom'` to avoid touching the harness contract.
import { describe as describeApp, it as itApp, expect as expectApp, beforeEach, afterEach } from 'vitest'
import { COST_DISPLAY_ENV } from '../../../src/core/cost/displayEnabled'
import { mountApp, makeMinimalAppDeps } from '../../../src/tui/testing/harness'
import { App } from '../../../src/tui/App'

function makeAppNode(deps: ReturnType<typeof makeMinimalAppDeps>): React.ReactNode {
  return (
    <App
      sessions={deps.sessions}
      slash={deps.slash}
      providers={deps.providers}
      config={deps.config}
      runAgent={async function* () { /* noop */ } as never}
      permissionBridge={deps.permissionBridge}
      onExit={() => {}}
      onOpenEditor={() => {}}
      compactSession={async () => {}}
      cwd={deps.cwd}
      gitBranch={{ branch: 'main', dirty: false }}
      version="0.0.0-test"
      tools={deps.tools}
      costTracker={deps.costTracker}
    />
  )
}

describeApp('App integration — CostBanner gating', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env[COST_DISPLAY_ENV]
    delete process.env[COST_DISPLAY_ENV]
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[COST_DISPLAY_ENV]
    else process.env[COST_DISPLAY_ENV] = saved
  })

  itApp('does not render the banner when env gate is off, even with tracker entries', async () => {
    const deps = makeMinimalAppDeps(undefined)
    const sid = deps.sessions.active()!.id
    deps.costTracker.record('claude-haiku-4-5', sid, { input: 1000, output: 500 })
    const h = mountApp({ target: 'custom', node: makeAppNode(deps) })
    await new Promise(r => setImmediate(r))
    const last = h.frames().at(-1) ?? ''
    expectApp(last).not.toMatch(/^cost\b/m)
    h.unmount()
  })

  itApp('renders the banner when env gate is on and tracker has entries', async () => {
    process.env[COST_DISPLAY_ENV] = '1'
    const deps = makeMinimalAppDeps(undefined)
    const sid = deps.sessions.active()!.id
    deps.costTracker.record('claude-haiku-4-5', sid, { input: 1000, output: 500 })
    const h = mountApp({ target: 'custom', node: makeAppNode(deps) })
    await new Promise(r => setImmediate(r))
    const last = h.frames().at(-1) ?? ''
    expectApp(last.toLowerCase()).toMatch(/cost/)
    h.unmount()
  })
})
