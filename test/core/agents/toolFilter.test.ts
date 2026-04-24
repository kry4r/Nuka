import { describe, it, expect } from 'vitest'
import { filterTools } from '../../../src/core/agents/toolFilter'
import type { Tool } from '../../../src/core/tools/types'

function mkTool(name: string): Tool {
  return {
    name,
    description: name,
    parameters: {},
    source: 'builtin',
    needsPermission: () => 'none',
    run: async () => ({ output: '', isError: false }),
  }
}

describe('filterTools', () => {
  const all = [mkTool('Read'), mkTool('Bash'), mkTool('Write'), mkTool('mcp__fs__read')]

  it('returns all tools when neither allow nor deny is set', () => {
    const out = filterTools(all, {})
    expect(out.map(t => t.name)).toEqual(['Read', 'Bash', 'Write', 'mcp__fs__read'])
  })

  it('allowedTools acts as a strict whitelist', () => {
    const out = filterTools(all, { allowedTools: ['Read'] })
    expect(out.map(t => t.name)).toEqual(['Read'])
  })

  it('deniedTools removes matching names', () => {
    const out = filterTools(all, { deniedTools: ['Bash'] })
    expect(out.map(t => t.name)).toEqual(['Read', 'Write', 'mcp__fs__read'])
  })

  it('both: intersection then subtraction', () => {
    const out = filterTools(all, { allowedTools: ['Read', 'Bash', 'Write'], deniedTools: ['Bash'] })
    expect(out.map(t => t.name)).toEqual(['Read', 'Write'])
  })

  it('allowedTools matches MCP namespaced names exactly', () => {
    const out = filterTools(all, { allowedTools: ['mcp__fs__read'] })
    expect(out.map(t => t.name)).toEqual(['mcp__fs__read'])
  })

  it('empty allowedTools produces an empty list (strict whitelist)', () => {
    const out = filterTools(all, { allowedTools: [] })
    expect(out).toEqual([])
  })

  it('empty deniedTools is a no-op', () => {
    const out = filterTools(all, { deniedTools: [] })
    expect(out.map(t => t.name)).toEqual(['Read', 'Bash', 'Write', 'mcp__fs__read'])
  })

  it('unknown name in allow/deny is silently ignored', () => {
    const out = filterTools(all, { allowedTools: ['Read', 'Nope'], deniedTools: ['Absent'] })
    expect(out.map(t => t.name)).toEqual(['Read'])
  })
})
