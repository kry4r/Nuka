import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock detectIdes so tests don't run real probes.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const detected: Array<{ family: string; port?: number }> = []

  return {
    detected,
    reset() {
      detected.length = 0
    },
    setDetected(...ides: Array<{ family: string; port?: number }>) {
      detected.length = 0
      detected.push(...ides)
    },
  }
})

vi.mock('../../src/core/ide/detect', () => ({
  detectIdes: vi.fn(async () => [...mocks.detected]),
  IDE_PORTS: {
    vscode: 4096,
    cursor: 4097,
    windsurf: 4098,
    jetbrains: 4099,
  },
}))

import { IdeCommand } from '../../src/slash/ide'
import type { SlashContext } from '../../src/slash/types'

// ---------------------------------------------------------------------------
// Helper to build a minimal SlashContext with optional mcpManager.
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<SlashContext> = {}): SlashContext {
  return {
    sessions: {} as SlashContext['sessions'],
    providers: {} as SlashContext['providers'],
    config: {} as SlashContext['config'],
    ...overrides,
  }
}

function makeMcpManager() {
  return {
    addServer: vi.fn().mockResolvedValue(undefined),
    removeServer: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/ide', () => {
  beforeEach(() => {
    mocks.reset()
  })

  // -------------------------------------------------------------------------
  // /ide (list)
  // -------------------------------------------------------------------------
  it('returns no-IDE message when nothing is detected', async () => {
    const result = await IdeCommand.run('', makeCtx())
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('no IDEs detected')
    }
  })

  it('lists detected IDEs numbered from 1', async () => {
    mocks.setDetected(
      { family: 'vscode', port: 4096 },
      { family: 'cursor', port: 4097 },
    )
    const result = await IdeCommand.run('', makeCtx())
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('1. vscode')
      expect(result.text).toContain('2. cursor')
    }
  })

  it('"list" subcommand behaves the same as empty args', async () => {
    mocks.setDetected({ family: 'windsurf', port: 4098 })
    const r1 = await IdeCommand.run('', makeCtx())
    const r2 = await IdeCommand.run('list', makeCtx())
    expect(r1).toEqual(r2)
  })

  // -------------------------------------------------------------------------
  // /ide connect <n>
  // -------------------------------------------------------------------------
  it('connect <n> calls addServer with the correct SSE url', async () => {
    mocks.setDetected({ family: 'vscode', port: 4096 })
    const mgr = makeMcpManager()
    const result = await IdeCommand.run('connect 1', makeCtx({ mcpManager: mgr as unknown as SlashContext['mcpManager'] }))
    expect(mgr.addServer).toHaveBeenCalledWith('ide', {
      type: 'sse',
      url: 'http://localhost:4096/mcp',
    })
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('vscode')
    }
  })

  it('connect <n> with out-of-range index returns error text', async () => {
    mocks.setDetected({ family: 'vscode', port: 4096 })
    const mgr = makeMcpManager()
    const result = await IdeCommand.run('connect 5', makeCtx({ mcpManager: mgr as unknown as SlashContext['mcpManager'] }))
    expect(mgr.addServer).not.toHaveBeenCalled()
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('Invalid selection')
    }
  })

  it('connect with no mcpManager returns a graceful message', async () => {
    mocks.setDetected({ family: 'vscode', port: 4096 })
    const result = await IdeCommand.run('connect 1', makeCtx())
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('No MCP manager available')
    }
  })

  it('connect when no IDEs detected returns no-IDE message', async () => {
    const mgr = makeMcpManager()
    const result = await IdeCommand.run('connect 1', makeCtx({ mcpManager: mgr as unknown as SlashContext['mcpManager'] }))
    expect(mgr.addServer).not.toHaveBeenCalled()
    if (result.type === 'text') {
      expect(result.text).toContain('no IDEs detected')
    }
  })

  // -------------------------------------------------------------------------
  // /ide disconnect
  // -------------------------------------------------------------------------
  it('disconnect calls removeServer("ide")', async () => {
    const mgr = makeMcpManager()
    const result = await IdeCommand.run('disconnect', makeCtx({ mcpManager: mgr as unknown as SlashContext['mcpManager'] }))
    expect(mgr.removeServer).toHaveBeenCalledWith('ide')
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('disconnected')
    }
  })

  it('disconnect with no mcpManager returns a graceful message', async () => {
    const result = await IdeCommand.run('disconnect', makeCtx())
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('No MCP manager available')
    }
  })

  // -------------------------------------------------------------------------
  // Unknown subcommand
  // -------------------------------------------------------------------------
  it('unknown subcommand returns usage hint', async () => {
    const result = await IdeCommand.run('frobnicate', makeCtx())
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('Usage')
    }
  })
})
