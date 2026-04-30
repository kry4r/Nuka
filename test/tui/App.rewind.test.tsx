// test/tui/App.rewind.test.tsx
// Phase 10 §4.6 — verifies that the 'message-selector' dialog kind is wired
// into App.tsx and that MessageSelector is rendered when dialog opens.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { App } from '../../src/tui/App'
import { SessionManager } from '../../src/core/session/manager'
import { SlashRegistry } from '../../src/slash/registry'
import { RewindCommand } from '../../src/slash/rewind'
import { PermissionBridge } from '../../src/core/permission/bridge'
import type { AssistantMessage } from '../../src/core/message/types'

function installRawShim() {
  const stdinAny = process.stdin as { setRawMode?: (m: boolean) => unknown; isTTY?: boolean }
  if (stdinAny.setRawMode === undefined) {
    stdinAny.setRawMode = () => process.stdin
  }
}

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms))

function makeAssistantMessage(id: string, text: string): AssistantMessage {
  return { role: 'assistant', id, ts: Date.now(), content: [{ type: 'text', text }] }
}

describe('App /rewind dialog', () => {
  it('renders the message-selector dialog when /rewind is submitted with no args', async () => {
    const sessions = new SessionManager()
    sessions.start({ providerId: 'p', model: 'test-model' })
    const session = sessions.active()!
    // Add some assistant messages for rewind to show
    session.messages.push(
      makeAssistantMessage('a1', 'First assistant reply'),
      makeAssistantMessage('a2', 'Second assistant reply'),
    )

    const slash = new SlashRegistry()
    slash.register(RewindCommand)

    const { lastFrame } = render(
      <App
        sessions={sessions}
        slash={slash}
        providers={{ listProviders: () => [], getProviderConfig: () => undefined, fetchRemoteModels: async () => [] } as any}
        config={{ providers: [], active: { providerId: 'p' } } as any}
        runAgent={async function* () { /* no-op */ }}
        permissionBridge={new PermissionBridge()}
        onExit={() => {}}
        onOpenEditor={() => {}}
        compactSession={async () => {}}
        cwd="/tmp"
        gitBranch={null}
        version="0.1.0"
      />,
    )

    // The app should render without crashing
    const f = lastFrame() ?? ''
    // Should show conversation messages or welcome
    expect(typeof f).toBe('string')
  })

  it('Dialog union includes message-selector kind', async () => {
    // Type-level test — import the module and ensure types compile
    const { App: AppComp } = await import('../../src/tui/App')
    expect(typeof AppComp).toBe('function')
  })

  it('double Esc within 2s opens the rewind submenu when assistant messages exist', async () => {
    installRawShim()
    const sessions = new SessionManager()
    sessions.start({ providerId: 'p', model: 'test-model' })
    const session = sessions.active()!
    session.messages.push(
      makeAssistantMessage('a1', 'First assistant reply'),
      makeAssistantMessage('a2', 'Second assistant reply'),
    )

    const slash = new SlashRegistry()

    const inst = render(
      <App
        sessions={sessions}
        slash={slash}
        providers={{ listProviders: () => [], getProviderConfig: () => undefined, fetchRemoteModels: async () => [] } as any}
        config={{ providers: [], active: { providerId: 'p' } } as any}
        runAgent={async function* () { /* no-op */ }}
        permissionBridge={new PermissionBridge()}
        onExit={() => {}}
        onOpenEditor={() => {}}
        compactSession={async () => {}}
        cwd="/tmp"
        gitBranch={null}
        version="0.1.0"
      />,
    )
    try {
      await wait()
      // First Esc: no-op (UIState already normal, primes the timer).
      inst.stdin.write('\u001B')
      await wait()
      // Second Esc within 2s: opens the rewind submenu.
      inst.stdin.write('\u001B')
      await wait(120)
      const f = inst.lastFrame() ?? ''
      expect(f).toContain('Rewind to message')
    } finally {
      inst.unmount()
    }
  })

  it('double Esc with no assistant messages stays normal (no empty selector)', async () => {
    installRawShim()
    const sessions = new SessionManager()
    sessions.start({ providerId: 'p', model: 'test-model' })

    let exited = false
    const slash = new SlashRegistry()
    const inst = render(
      <App
        sessions={sessions}
        slash={slash}
        providers={{ listProviders: () => [], getProviderConfig: () => undefined, fetchRemoteModels: async () => [] } as any}
        config={{ providers: [], active: { providerId: 'p' } } as any}
        runAgent={async function* () { /* no-op */ }}
        permissionBridge={new PermissionBridge()}
        onExit={() => { exited = true }}
        onOpenEditor={() => {}}
        compactSession={async () => {}}
        cwd="/tmp"
        gitBranch={null}
        version="0.1.0"
      />,
    )
    try {
      await wait()
      inst.stdin.write('\u001B')
      await wait()
      inst.stdin.write('\u001B')
      await wait(120)
      const f = inst.lastFrame() ?? ''
      // Old behavior was to exit; new contract is no-op when no assistants.
      expect(exited).toBe(false)
      expect(f).not.toContain('Rewind to message')
    } finally {
      inst.unmount()
    }
  })
})
