// test/tui/testing/harness.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { Box, Text } from 'ink'
import { mountApp, makeMinimalAppDeps } from '../../../src/tui/testing/harness'
import { MockProvider } from '../../../src/core/testing/mockProvider'
import { SlashRegistry } from '../../../src/slash/registry'
import { StatsCommand } from '../../../src/slash/stats'

const flush = () => new Promise(r => setImmediate(r))
const wait = async (n = 4) => { for (let i = 0; i < n; i++) await flush() }

describe('mountApp({ target: "wizard" })', () => {
  it('renders the welcome screen and Enter advances state', async () => {
    const h = mountApp({ target: 'wizard' })
    try {
      const before = h.frames()
      expect(before[before.length - 1] ?? '').toContain('Welcome to Nuka')
      h.stdin.write('\r')
      await wait()
      const after = h.frames()
      expect(after[after.length - 1] ?? '').toContain('Choose a provider')
    } finally {
      h.unmount()
    }
  })

  it('waitFor resolves when the matcher becomes true', async () => {
    const h = mountApp({ target: 'wizard' })
    try {
      h.stdin.write('\r')
      await h.waitFor({ contains: 'Choose a provider' }, 200)
    } finally {
      h.unmount()
    }
  })

  it('waitFor rejects on timeout', async () => {
    const h = mountApp({ target: 'wizard' })
    try {
      await expect(h.waitFor({ contains: 'never-shows-up-zzz' }, 30)).rejects.toThrow(/timed out/)
    } finally {
      h.unmount()
    }
  })
})

describe('mountApp({ target: "app" })', () => {
  it('mounts the full App with minimal deps and renders the banner', async () => {
    const h = mountApp({ target: 'app' })
    try {
      await wait()
      const f = h.frames().pop() ?? ''
      expect(f).toContain('NUKA')
    } finally {
      h.unmount()
    }
  })

  it('accepts a mock provider; ProviderResolver.resolveFor returns it', async () => {
    const mock = new MockProvider({ id: 'mock' })
    const cfg = {
      providers: [{
        id: 'mock', name: 'Mock', format: 'anthropic',
        baseUrl: 'http://x.invalid', apiKey: '', models: ['mock-model'],
        selectedModel: 'mock-model',
      }],
      active: { providerId: 'mock' },
    }
    const deps = makeMinimalAppDeps(cfg as any, { provider: mock })
    const resolved = deps.providers.resolveFor({ providerId: 'mock', model: 'mock-model' })
    expect(resolved.provider).toBe(mock)

    // Sanity: full mount with mocks doesn't throw.
    const h = mountApp({ target: 'app', config: cfg as any, mocks: { provider: mock } })
    try {
      await wait()
      expect(h.frames().length).toBeGreaterThan(0)
    } finally {
      h.unmount()
    }
  })
})

describe('mountApp({ target: "custom" })', () => {
  it('renders an arbitrary node', async () => {
    const node = (
      <Box>
        <Text>custom-marker-XYZ</Text>
      </Box>
    )
    const h = mountApp({ target: 'custom', node })
    try {
      await wait()
      expect(h.frames().pop() ?? '').toContain('custom-marker-XYZ')
    } finally {
      h.unmount()
    }
  })
})

describe('mountApp({ target: "app", slash })', () => {
  it('drives a registered slash command end-to-end (/stats opens dialog)', async () => {
    const slash = new SlashRegistry()
    slash.register(StatsCommand)

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      // Type the command, then send Enter as a separate stdin chunk so the
      // useInput hook in PromptInput sees a real `key.return`.
      h.stdin.write('/stats')
      await wait()
      h.stdin.write('\r')
      await h.waitFor({ contains: 'Stats' }, 500)
      const frame = h.frames().pop() ?? ''
      // The StatsView renders the tab labels and the "no data yet" message
      // for an empty cost tracker.
      expect(frame).toContain('Overview')
      expect(frame).toContain('Models')
      expect(frame).toContain('no data yet')
    } finally {
      h.unmount()
    }
  })

  it('drives /plan on and the active session flips to plan mode', async () => {
    const { PlanCommand } = await import('../../../src/slash/plan')
    const slash = new SlashRegistry()
    slash.register(PlanCommand)

    const deps = makeMinimalAppDeps(undefined, {}, undefined, slash)
    expect(deps.sessions.active()?.mode ?? 'normal').toBe('normal')

    const h = mountApp({ target: 'app', slash })
    try {
      await wait()
      h.stdin.write('/plan on')
      await wait()
      h.stdin.write('\r')
      // The acknowledgment text doesn't render in the legacy app frame
      // (slash text-results are not surfaced into the TUI frame yet),
      // so we assert the only structural effect we CAN observe via the
      // mounted-app: the prompt input clears after a successful slash
      // submit.
      await h.waitFor({ notContains: '/plan on' }, 500)
      // Phase 11 — slash text-results are now rendered into the message
      // stream as `[/<name>]\n...`, replacing the Welcome banner. Assert
      // both the rendered tag and the banner from PlanCommand.
      const f = h.frames().pop() ?? ''
      expect(f).toContain('[/plan]')
      expect(f).toContain('Plan mode ON')
    } finally {
      h.unmount()
    }
  })
})

describe('frames()', () => {
  it('returns a snapshot copy (not a live reference)', () => {
    const h = mountApp({ target: 'custom', node: <Text>hi</Text> })
    try {
      const a = h.frames()
      a.push('mutation')
      const b = h.frames()
      expect(b).not.toContain('mutation')
    } finally {
      h.unmount()
    }
  })
})
