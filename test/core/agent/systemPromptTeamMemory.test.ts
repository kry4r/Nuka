import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../../src/core/agent/systemPrompt'
import type { MemoryEntry } from '../../../src/core/memdir'

function baseInput() {
  return {
    cwd: '/r',
    platform: 'linux',
    shell: '/bin/bash',
    nodeVersion: 'v20',
    gitBranch: null,
  } as const
}

const userEntry: MemoryEntry = {
  ts: '2026-01-01T00:00:00.000Z',
  sessionId: 'u1',
  body: 'USER MEMORY ENTRY',
  keywords: ['u'],
}
const teamEntry: MemoryEntry = {
  ts: '2026-02-01T00:00:00.000Z',
  sessionId: 't1',
  body: 'TEAM MEMORY ENTRY',
  keywords: ['t'],
}
const projectEntry: MemoryEntry = {
  ts: '2026-03-01T00:00:00.000Z',
  sessionId: 'p1',
  body: 'PROJECT MEMORY ENTRY',
  keywords: ['p'],
}

describe('buildSystemPrompt — three-tier memory ordering', () => {
  it('omits all sections when none of userMemory / teamMemory / memory is set', () => {
    const out = buildSystemPrompt(baseInput())
    expect(out).not.toMatch(/## Memory/)
    expect(out).not.toMatch(/## Team Memory/)
    expect(out).not.toMatch(/## User Memory/)
  })

  it('renders project memory only (back-compat with pre-team Nuka)', () => {
    const out = buildSystemPrompt({ ...baseInput(), memory: [projectEntry] })
    expect(out).toMatch(/## Memory/)
    expect(out).not.toMatch(/## Team Memory/)
    expect(out).not.toMatch(/## User Memory/)
    expect(out).toContain('PROJECT MEMORY ENTRY')
  })

  it('omits team memory section when teamMemory is an empty array', () => {
    const out = buildSystemPrompt({
      ...baseInput(),
      teamMemory: [],
      memory: [projectEntry],
    })
    expect(out).not.toMatch(/## Team Memory/)
    expect(out).toMatch(/## Memory/)
  })

  it('emits user → team → project in that exact order', () => {
    const out = buildSystemPrompt({
      ...baseInput(),
      userMemory: [userEntry],
      teamMemory: [teamEntry],
      memory: [projectEntry],
    })
    const idxUser = out.indexOf('## User Memory')
    const idxTeam = out.indexOf('## Team Memory')
    const idxProject = out.indexOf('## Memory')  // project section
    // All three present
    expect(idxUser).toBeGreaterThan(-1)
    expect(idxTeam).toBeGreaterThan(-1)
    expect(idxProject).toBeGreaterThan(-1)
    // ordered user < team < project
    expect(idxUser).toBeLessThan(idxTeam)
    expect(idxTeam).toBeLessThan(idxProject)
    // ## Memory header must NOT collide with `## Team Memory` for prefix matches.
    // The project header is `## Memory` (no Team prefix). Verify by counting
    // exact-headers — the substring `## Memory` appears in `## Team Memory`
    // so we use line-anchored matching for safety:
    const lines = out.split('\n')
    const headers = lines.filter(l => /^## (User Memory|Team Memory|Memory)$/.test(l))
    expect(headers).toEqual(['## User Memory', '## Team Memory', '## Memory'])
  })

  it('renders only team memory when project is absent', () => {
    const out = buildSystemPrompt({
      ...baseInput(),
      teamMemory: [teamEntry],
    })
    expect(out).toMatch(/## Team Memory/)
    expect(out).toContain('TEAM MEMORY ENTRY')
    expect(out).not.toMatch(/## Memory\b(?! Memory)/)  // no project section
  })
})
