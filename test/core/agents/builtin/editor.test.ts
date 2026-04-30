import { describe, it, expect } from 'vitest'
import { editorAgent } from '../../../../src/core/agents/builtin/editor'

describe('editorAgent', () => {
  it('denies write tools', () => {
    expect(editorAgent.deniedTools).toContain('Edit')
    expect(editorAgent.deniedTools).toContain('Write')
    expect(editorAgent.deniedTools).toContain('Bash')
  })
  it('allows swarm dispatch tools', () => {
    expect(editorAgent.allowedTools).toContain('dispatch_agent')
    expect(editorAgent.allowedTools).toContain('team_create')
    expect(editorAgent.allowedTools).toContain('send_message')
  })
  it('has high maxTurns for long-running coordination', () => {
    expect(editorAgent.maxTurns).toBeGreaterThanOrEqual(50)
  })
})
