import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { App } from '../../src/tui/App'
import { SessionManager } from '../../src/core/session/manager'
import { SlashRegistry } from '../../src/slash/registry'
import { HelpCommand } from '../../src/slash/help'
import { PermissionBridge } from '../../src/core/permission/bridge'

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
})
