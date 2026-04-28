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
// Helper to build a minimal SlashContext.
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<SlashContext> = {}): SlashContext {
  return {
    sessions: {} as SlashContext['sessions'],
    providers: {} as SlashContext['providers'],
    config: {} as SlashContext['config'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Phase 11 M3: /ide is now list-only — connect/disconnect were the
// MCP-bridge UX and have been removed pending the new tool platform.
// ---------------------------------------------------------------------------

describe('/ide', () => {
  beforeEach(() => {
    mocks.reset()
  })

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

  it('renders the IDE family port hint when present', async () => {
    mocks.setDetected({ family: 'windsurf', port: 4098 })
    const result = await IdeCommand.run('', makeCtx())
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('windsurf')
      expect(result.text).toContain('4098')
    }
  })
})
