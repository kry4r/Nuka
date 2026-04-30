import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { App } from '../../src/tui/App'
import { SessionManager } from '../../src/core/session/manager'
import { ProviderResolver } from '../../src/core/provider/resolver'
import { SlashRegistry } from '../../src/slash/registry'
import { ToolRegistry } from '../../src/core/tools/registry'
import { PermissionBridge } from '../../src/core/permission/bridge'
import { PermissionChecker } from '../../src/core/permission/checker'
import { CostTracker } from '../../src/core/cost/tracker'
import { runAgent } from '../../src/core/agent/loop'
import type { Config } from '../../src/core/config/schema'
import type { LLMProvider, LLMRequest, ProviderEvent } from '../../src/core/provider/types'

const flush = () => new Promise(r => setImmediate(r))
const wait = async (n = 6) => { for (let i = 0; i < n; i++) await flush() }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

class StreamingMockProvider implements LLMProvider {
  readonly id = 'mock'
  readonly format = 'anthropic' as const
  private chunks: string[]
  private chunkDelayMs: number
  /** Optional gate: resolved by tests after asserting the partial frame, allowing the next chunk to flow. */
  gate?: { wait: () => Promise<void>; release: () => void }
  constructor(chunks: string[], chunkDelayMs = 5) {
    this.chunks = chunks
    this.chunkDelayMs = chunkDelayMs
  }
  async listRemoteModels(): Promise<string[]> { return [] }
  async *stream(_req: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    void _req
    for (let i = 0; i < this.chunks.length; i++) {
      if (signal.aborted) return
      await sleep(this.chunkDelayMs)
      yield { type: 'text_delta', text: this.chunks[i]! }
      // After the FIRST chunk yields, optionally block until the test
      // releases the gate. This lets the test verify mid-stream rendering.
      if (i === 0 && this.gate) {
        await this.gate.wait()
      }
    }
    if (signal.aborted) return
    await sleep(this.chunkDelayMs)
    yield {
      type: 'message_stop',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 3 },
    }
  }
}

function makeGate(): { wait: () => Promise<void>; release: () => void } {
  let release: () => void = () => {}
  const promise = new Promise<void>(r => { release = r })
  return { wait: () => promise, release }
}

function mountChatApp(provider: LLMProvider) {
  const stdinAny = process.stdin as { setRawMode?: (m: boolean) => unknown }
  if (stdinAny.setRawMode === undefined) {
    stdinAny.setRawMode = () => process.stdin
  }
  const cfg: Config = {
    providers: [{
      id: 'mock', name: 'Mock', format: 'anthropic',
      baseUrl: 'http://x.invalid', apiKey: '', models: ['mock-model'],
      selectedModel: 'mock-model',
    }],
    active: { providerId: 'mock' },
  } as unknown as Config

  const sessions = new SessionManager()
  sessions.start({ providerId: 'mock', model: 'mock-model' })
  const providers = new ProviderResolver(cfg, { providers: { mock: provider } })
  const slash = new SlashRegistry()
  const tools = new ToolRegistry()
  const permissionBridge = new PermissionBridge()
  const permission = new PermissionChecker(
    () => sessions.active()!.permissionCache,
    async () => ({ allowed: true }),
  )

  const runner: AppProps['runAgent'] = (input, session, signal) =>
    runAgent(input, session, { provider: providers, tools, permission }, signal)

  return render(
    <App
      sessions={sessions}
      slash={slash}
      providers={providers}
      config={cfg}
      runAgent={runner}
      permissionBridge={permissionBridge}
      onExit={() => {}}
      onOpenEditor={() => {}}
      compactSession={async () => {}}
      cwd="/tmp"
      gitBranch={{ branch: 'main', dirty: false }}
      version="0.0.0-test"
      tools={tools}
      costTracker={new CostTracker()}
    />,
  )
}

async function waitForFrameContains(
  inst: ReturnType<typeof render>,
  needle: string,
  timeoutMs = 2000,
): Promise<string> {
  const start = Date.now()
  let frame = ''
  while (Date.now() - start < timeoutMs) {
    await wait(2)
    frame = inst.lastFrame() ?? ''
    if (frame.includes(needle)) return frame
  }
  return frame
}

describe('chat render — assistant reply surfaces in conversation pane', () => {
  it('renders a single-chunk assistant reply', async () => {
    const provider = new StreamingMockProvider(['Hello there!'])
    const inst = mountChatApp(provider)
    try {
      await wait()
      inst.stdin.write('hello')
      await wait()
      inst.stdin.write('\r')
      const frame = await waitForFrameContains(inst, 'Hello there!')
      expect(frame).toContain('hello')
      expect(frame).toContain('Hello there!')
    } finally {
      inst.unmount()
    }
  })

  it('renders a multi-chunk streamed assistant reply', async () => {
    const provider = new StreamingMockProvider(['piece-A ', 'piece-B ', 'piece-C'])
    const inst = mountChatApp(provider)
    try {
      await wait()
      inst.stdin.write('streamtest')
      await wait()
      inst.stdin.write('\r')
      const frame = await waitForFrameContains(inst, 'piece-C')
      expect(frame).toContain('streamtest')
      expect(frame).toContain('piece-A')
      expect(frame).toContain('piece-B')
      expect(frame).toContain('piece-C')
    } finally {
      inst.unmount()
    }
  })

  it('shows mid-stream text live before turn_end fires', async () => {
    const provider = new StreamingMockProvider(['LIVE-A ', 'LIVE-B ', 'LIVE-C'])
    const gate = makeGate()
    provider.gate = gate
    const inst = mountChatApp(provider)
    try {
      await wait()
      inst.stdin.write('livestream')
      await wait()
      inst.stdin.write('\r')
      // Provider yields the first chunk and then blocks on the gate. We must
      // see LIVE-A in the live frame BEFORE message_stop / turn_end fires.
      const partial = await waitForFrameContains(inst, 'LIVE-A')
      expect(partial).toContain('LIVE-A')
      expect(partial).not.toContain('LIVE-C')
      // Release the gate; the rest of the stream completes normally.
      gate.release()
      const final = await waitForFrameContains(inst, 'LIVE-C')
      expect(final).toContain('LIVE-A')
      expect(final).toContain('LIVE-B')
      expect(final).toContain('LIVE-C')
    } finally {
      inst.unmount()
    }
  })
})

type AppProps = React.ComponentProps<typeof App>
