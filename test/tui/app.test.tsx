import React from 'react'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render } from 'ink-testing-library'
import { App, findLatestReadResultId } from '../../src/tui/App'
import { SessionManager } from '../../src/core/session/manager'
import { SessionStore } from '../../src/core/session/store'
import { SlashRegistry } from '../../src/slash/registry'
import { HelpCommand } from '../../src/slash/help'
import { PermissionBridge } from '../../src/core/permission/bridge'
import { appendMessage, createSession } from '../../src/core/session/session'
import { CompactCommand } from '../../src/slash/compact'
import { eventBus } from '../../src/core/events/bus'
import { HistoryCommand } from '../../src/slash/history'
import { makeUserMessage } from '../../src/core/message/factories'

describe('App', () => {
  afterEach(() => {
    cleanup()
  })

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

  it('scrolls older messages with modified PageUp escape sequences', async () => {
    const sessions = new SessionManager()
    const session = sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    for (let i = 1; i <= 24; i++) {
      appendMessage(session, {
        role: 'user',
        id: `u${i}`,
        ts: i,
        content: [{ type: 'text', text: `modified-page-message-${String(i).padStart(2, '0')}` }],
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

    expect(lastFrame() ?? '').toContain('modified-page-message-24')
    stdin.write('\u001B[5;2~')
    await new Promise(r => setImmediate(r))

    const f = lastFrame() ?? ''
    expect(f).toContain('older')
    expect(f).toContain('newer')
    expect(f).toContain('modified-page-message-15')
    expect(f).not.toContain('modified-page-message-24')
    expect(f).not.toContain('[5;2~')
  })

  it('scrolls older messages with mouse wheel escape sequences', async () => {
    const sessions = new SessionManager()
    const session = sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    for (let i = 1; i <= 24; i++) {
      appendMessage(session, {
        role: 'user',
        id: `u${i}`,
        ts: i,
        content: [{ type: 'text', text: `wheel-message-${String(i).padStart(2, '0')}` }],
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

    expect(lastFrame() ?? '').toContain('wheel-message-24')
    stdin.write('\u001B[<64;10;12M')
    await new Promise(r => setImmediate(r))

    const f = lastFrame() ?? ''
    expect(f).toContain('older')
    expect(f).toContain('newer')
    expect(f).toContain('wheel-message-15')
    expect(f).not.toContain('wheel-message-24')
    expect(f).not.toContain('[<64;10;12M')
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
    expect(f).toContain('Nuka · gpt-5.5')
    expect(f).not.toContain('custom-2')
  })

  it('opens filtered session history from /history query', async () => {
    const oldPersist = process.env['NUKA_SESSION_PERSIST']
    process.env['NUKA_SESSION_PERSIST'] = '1'
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-app-history-'))
    const store = new SessionStore({ dir })
    const past = createSession({ providerId: 'p', model: 'm' })
    past.createdAt = 100
    past.updatedAt = 100
    appendMessage(past, makeUserMessage({ text: 'AUTH BUG in app history route' }))
    await store.appendMessage(past.id, past.messages[0]!)
    await store.writeMeta(past)

    const sessions = new SessionManager()
    sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    const slash = new SlashRegistry()
    slash.register(HistoryCommand)
    const { stdin, lastFrame, unmount } = render(
      <App
        sessions={sessions}
        store={store}
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

    try {
      stdin.write('/history auth bug\r')
      await new Promise(r => setTimeout(r, 50))
      const frame = lastFrame() ?? ''
      expect(frame).toContain('History')
      expect(frame).toContain('Search: auth bug')
      expect(frame).toContain('AUTH BUG')
    } finally {
      unmount()
      rmSync(dir, { recursive: true, force: true })
      if (oldPersist === undefined) delete process.env['NUKA_SESSION_PERSIST']
      else process.env['NUKA_SESSION_PERSIST'] = oldPersist
    }
  })

  it('keeps the search query after deleting from filtered history', async () => {
    const oldPersist = process.env['NUKA_SESSION_PERSIST']
    process.env['NUKA_SESSION_PERSIST'] = '1'
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-app-history-'))
    const store = new SessionStore({ dir })
    const match = createSession({ providerId: 'p', model: 'm' })
    match.createdAt = 100
    match.updatedAt = 100
    appendMessage(match, makeUserMessage({ text: 'AUTH BUG delete candidate' }))
    await store.appendMessage(match.id, match.messages[0]!)
    await store.writeMeta(match)
    const other = createSession({ providerId: 'p', model: 'm' })
    other.createdAt = 200
    other.updatedAt = 200
    appendMessage(other, makeUserMessage({ text: 'unrelated deployment note' }))
    await store.appendMessage(other.id, other.messages[0]!)
    await store.writeMeta(other)

    const sessions = new SessionManager()
    sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    const slash = new SlashRegistry()
    slash.register(HistoryCommand)
    const { stdin, lastFrame, unmount } = render(
      <App
        sessions={sessions}
        store={store}
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

    try {
      stdin.write('/history auth bug\r')
      await new Promise(r => setTimeout(r, 50))
      expect(lastFrame() ?? '').toContain('AUTH BUG delete candidate')

      stdin.write('d')
      await new Promise(r => setTimeout(r, 50))

      const frame = lastFrame() ?? ''
      expect(frame).toContain('Search: auth bug')
      expect(frame).toContain('0 results')
      expect(frame).toContain('No matching sessions.')
      expect(frame).not.toContain('unrelated deployment note')
    } finally {
      unmount()
      rmSync(dir, { recursive: true, force: true })
      if (oldPersist === undefined) delete process.env['NUKA_SESSION_PERSIST']
      else process.env['NUKA_SESSION_PERSIST'] = oldPersist
    }
  })

  it('shows provider retry events in status without appending transcript noise', async () => {
    const sessions = new SessionManager()
    const session = sessions.start({ providerId: 'p', model: 'mimo-v2-pro' })
    const slash = new SlashRegistry()
    const providerConfig = {
      id: 'p',
      name: 'Xiaomi Mimo',
      format: 'openai',
      baseUrl: 'https://ai.example/v1',
      models: ['mimo-v2-pro'],
      selectedModel: 'mimo-v2-pro',
    }

    const { lastFrame, unmount } = render(
      <App
        sessions={sessions}
        slash={slash}
        providers={{
          listProviders: () => [providerConfig],
          getProviderConfig: () => providerConfig,
          fetchRemoteModels: async () => [],
        } as any}
        config={{ providers: [providerConfig], active: { providerId: 'p' } } as any}
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

    try {
      eventBus.emit('agent', {
        type: 'agent.provider.retry',
        sessionId: session.id,
        providerId: 'p',
        model: 'mimo-v2-pro',
        attempt: 1,
        delayMs: 2500,
        error: 'socket reset',
      })
      await new Promise(r => setImmediate(r))

      const f = lastFrame() ?? ''
      expect(f).toContain('retry: attempt 2 in 2.5s')
      expect(f).toContain('Xiaomi Mimo · mimo-v2-pro')
      expect(session.messages).toHaveLength(0)
    } finally {
      unmount()
    }
  })

  it('Ctrl+O expands and collapses the latest read tool result', async () => {
    const sessions = new SessionManager()
    const session = sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    appendMessage(session, {
      role: 'assistant',
      id: 'a-read',
      ts: 1,
      content: [{ type: 'tool_use', id: 'read-app-1', name: 'Read', input: { path: '/tmp/app-read.ts' } }],
    })
    appendMessage(session, {
      role: 'tool',
      id: 't-read',
      ts: 2,
      toolUseId: 'read-app-1',
      content: '1\tconst visibleWhenExpanded = true\n2\tconst stillHiddenWhileCollapsed = true',
      isError: false,
    })
    appendMessage(session, {
      role: 'assistant',
      id: 'a-after',
      ts: 3,
      content: [{ type: 'text', text: 'after read' }],
    })
    const slash = new SlashRegistry()
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
        compactSession={async () => {}}
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )

    try {
      expect(lastFrame() ?? '').toContain('Read result: /tmp/app-read.ts')
      expect(lastFrame() ?? '').not.toContain('stillHiddenWhileCollapsed')

      stdin.write('\u000f')
      await new Promise(r => setImmediate(r))
      expect(lastFrame() ?? '').toContain('stillHiddenWhileCollapsed')

      stdin.write('\u000f')
      await new Promise(r => setImmediate(r))
      expect(lastFrame() ?? '').toContain('Read result: /tmp/app-read.ts')
      expect(lastFrame() ?? '').not.toContain('stillHiddenWhileCollapsed')
    } finally {
      unmount()
    }
  })

  it('Ctrl+O opens a bounded diff detail and PageDown scrolls it', async () => {
    const sessions = new SessionManager()
    const session = sessions.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    appendMessage(session, {
      role: 'assistant',
      id: 'a-diff',
      ts: 1,
      content: [{ type: 'tool_use', id: 'diff-app-1', name: 'git_diff', input: { path: 'src/app.ts' } }],
    })
    appendMessage(session, {
      role: 'tool',
      id: 't-diff',
      ts: 2,
      toolUseId: 'diff-app-1',
      content: Array.from(
        { length: 18 },
        (_, i) => `diff-app-line-${String(i + 1).padStart(2, '0')}`,
      ).join('\n'),
      isError: false,
    })
    appendMessage(session, {
      role: 'assistant',
      id: 'a-after-diff',
      ts: 3,
      content: [{ type: 'text', text: 'after diff detail' }],
    })
    const slash = new SlashRegistry()
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
        compactSession={async () => {}}
        cwd="/root/codes/Nuka"
        gitBranch={{ branch: 'main', dirty: false }}
        version="0.1.0"
      />,
    )

    try {
      expect(lastFrame() ?? '').toContain('git_diff result: src/app.ts')
      expect(lastFrame() ?? '').not.toContain('diff-app-line-18')

      stdin.write('\u000f')
      await new Promise(r => setImmediate(r))
      expect(lastFrame() ?? '').toContain('git_diff result: src/app.ts · lines 1-6/18')
      expect(lastFrame() ?? '').toContain('diff-app-line-01')
      expect(lastFrame() ?? '').not.toContain('diff-app-line-18')

      stdin.write('\u001B[6~')
      await new Promise(r => setImmediate(r))
      const f = lastFrame() ?? ''
      expect(f).toContain('git_diff result: src/app.ts · lines 4-9/18')
      expect(f).toContain('diff-app-line-04')
      expect(f).toContain('diff-app-line-09')
      expect(f).not.toContain('diff-app-line-01')
      expect(f).not.toContain('[6~')
      expect(f).toContain('after diff detail')
    } finally {
      unmount()
    }
  })

  it('findLatestReadResultId returns the newest successful read-like tool result', () => {
    expect(findLatestReadResultId([
      {
        role: 'assistant',
        id: 'a1',
        ts: 1,
        content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { path: 'old.ts' } }],
      },
      {
        role: 'tool',
        id: 't1',
        ts: 2,
        toolUseId: 'read-1',
        content: 'old',
        isError: false,
      },
      {
        role: 'assistant',
        id: 'a2',
        ts: 3,
        content: [{ type: 'tool_use', id: 'read-2', name: 'read_file', input: { path: 'new.ts' } }],
      },
      {
        role: 'tool',
        id: 't2',
        ts: 4,
        toolUseId: 'read-2',
        content: 'new',
        isError: false,
      },
    ])).toBe('read-2')
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
