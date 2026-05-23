import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { App } from '../../src/tui/App'
import { SessionManager } from '../../src/core/session/manager'
import { SlashRegistry } from '../../src/slash/registry'
import { HelpCommand } from '../../src/slash/help'
import { PermissionBridge } from '../../src/core/permission/bridge'
import { appendMessage } from '../../src/core/session/session'
import { CompactCommand } from '../../src/slash/compact'

describe('App', () => {
  it('boots with welcome screen when no messages exist', () => {
    const sessions = new SessionManager()
    sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    const slash = new SlashRegistry()
    slash.register(HelpCommand)

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
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )
    const f = lastFrame() ?? ''
    // 3D NUKA logo replaces literal text wordmark — cwd remains a stable marker.
    expect(f).toContain('/root/codes/Nuka')
    expect(f).toContain('/ for commands')
  })

  it('scrolls older messages with raw PageUp escape sequences', async () => {
    const sessions = new SessionManager()
    const session = sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    for (let i = 1; i <= 24; i++) {
      appendMessage(session, {
        role: 'user',
        id: `u${i}`,
        ts: i,
        content: [{ type: 'text', text: `message-${String(i).padStart(2, '0')}` }],
      })
    }
    const slash = new SlashRegistry()
    const { stdin, lastFrame } = render(
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
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )

    expect(lastFrame() ?? '').toContain('message-24')
    stdin.write('\u001B[5~')
    await new Promise(r => setImmediate(r))

    const f = lastFrame() ?? ''
    expect(f).toContain('older')
    expect(f).toContain('newer')
    expect(f).toContain('message-15')
    expect(f).not.toContain('message-24')
    expect(f).not.toContain('[5~')
  })

  it('scrolls older messages while an agent turn is running', async () => {
    const sessions = new SessionManager()
    const session = sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    for (let i = 1; i <= 24; i++) {
      appendMessage(session, {
        role: 'user',
        id: `u${i}`,
        ts: i,
        content: [{ type: 'text', text: `message-${String(i).padStart(2, '0')}` }],
      })
    }
    const slash = new SlashRegistry()
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const { stdin, lastFrame, unmount } = render(
      <App
        sessions={sessions}
        slash={slash}
        providers={{ listProviders: () => [], getProviderConfig: () => undefined, fetchRemoteModels: async () => [] } as any}
        config={{ providers: [], active: { providerId: 'p' } } as any}
        runAgent={async function* () {
          await hold
        }}
        permissionBridge={new PermissionBridge()}
        onExit={() => {}}
        onOpenEditor={() => {}}
        compactSession={async () => {}}
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )

    try {
      stdin.write('start running\r')
      await new Promise(r => setTimeout(r, 30))
      expect(lastFrame() ?? '').toContain('running')

      stdin.write('\u001B[5~')
      await new Promise(r => setTimeout(r, 30))

      const f = lastFrame() ?? ''
      expect(f).toContain('older')
      expect(f).toContain('newer')
      expect(f).toContain('message-15')
      expect(f).not.toContain('message-24')
      expect(f).not.toContain('[5~')
    } finally {
      release()
      unmount()
    }
  })

  it('renders provider name in the statusline instead of provider id', () => {
    const sessions = new SessionManager()
    sessions.start({ providerId: 'custom-2', model: 'gpt-5.5' })
    const slash = new SlashRegistry()
    const providerConfig = {
      id: 'custom-2',
      name: 'Nuka',
      format: 'openai',
      baseUrl: 'https://ai.mangny.com/v1',
      models: ['gpt-5.5'],
      selectedModel: 'gpt-5.5',
    }

    const { lastFrame } = render(
      <App
        sessions={sessions}
        slash={slash}
        providers={{
          listProviders: () => [providerConfig],
          getProviderConfig: () => providerConfig,
          fetchRemoteModels: async () => [],
        } as any}
        config={{ providers: [providerConfig], active: { providerId: 'custom-2' } } as any}
        runAgent={async function* () { /* no-op */ }}
        permissionBridge={new PermissionBridge()}
        onExit={() => {}}
        onOpenEditor={() => {}}
        compactSession={async () => {}}
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )

    const f = lastFrame() ?? ''
    expect(f).toContain('Nuka/gpt-5.5')
    expect(f).not.toContain('custom-2/gpt-5.5')
  })

  it('renders the active session goal in the statusline', () => {
    const sessions = new SessionManager()
    const session = sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    sessions.setGoal(session.id, {
      objective: 'ship statusline goal',
      status: 'active',
    })
    const slash = new SlashRegistry()

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
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )

    expect(lastFrame() ?? '').toContain('goal: ship statusline goal')
  })

  it('shows manual compact progress while /compact is running', async () => {
    const sessions = new SessionManager()
    sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    const slash = new SlashRegistry()
    slash.register(CompactCommand)
    let resolveCompact!: () => void
    const compactDone = new Promise<void>(resolve => { resolveCompact = resolve })

    const { stdin, lastFrame, unmount } = render(
      <App
        sessions={sessions}
        slash={slash}
        providers={{ listProviders: () => [], getProviderConfig: () => undefined, fetchRemoteModels: async () => [] } as any}
        config={{ providers: [], active: { providerId: 'p' } } as any}
        runAgent={async function* () { /* no-op */ }}
        permissionBridge={new PermissionBridge()}
        onExit={() => {}}
        onOpenEditor={() => {}}
        compactSession={async () => { await compactDone }}
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )

    try {
      stdin.write('/compact\r')
      await new Promise(r => setTimeout(r, 30))
      expect(lastFrame() ?? '').toContain('compact: running')

      resolveCompact()
      await new Promise(r => setTimeout(r, 30))
      expect(lastFrame() ?? '').toContain('compact: done')
    } finally {
      unmount()
    }
  })

  it('shows manual compact failure without crashing the TUI', async () => {
    const sessions = new SessionManager()
    sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    const slash = new SlashRegistry()
    slash.register(CompactCommand)

    const { stdin, lastFrame, unmount } = render(
      <App
        sessions={sessions}
        slash={slash}
        providers={{ listProviders: () => [], getProviderConfig: () => undefined, fetchRemoteModels: async () => [] } as any}
        config={{ providers: [], active: { providerId: 'p' } } as any}
        runAgent={async function* () { /* no-op */ }}
        permissionBridge={new PermissionBridge()}
        onExit={() => {}}
        onOpenEditor={() => {}}
        compactSession={async () => { throw new Error('compact endpoint blocked') }}
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )

    try {
      stdin.write('/compact\r')
      await new Promise(r => setTimeout(r, 30))
      expect(lastFrame() ?? '').toContain('compact: failed')
      expect(lastFrame() ?? '').toContain('compact endpoint blocked')
    } finally {
      unmount()
    }
  })
})
