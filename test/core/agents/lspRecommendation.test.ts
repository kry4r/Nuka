// test/core/agents/lspRecommendation.test.ts
// Iter IIII — verify builtin agent prompts steer toward LSPQuery for
// code-intelligence ops, with grep as a fallback when notConfigured.
import { describe, it, expect } from 'vitest'
import { editorAgent } from '../../../src/core/agents/builtin/editor'
import { ROLE_AGENTS } from '../../../src/core/agents/builtin/roles'

function role(name: string) {
  const def = ROLE_AGENTS.find(a => a.name === name)
  if (!def) throw new Error(`role agent ${name} not found`)
  return def
}

describe('LSPQuery recommendation in builtin agent prompts', () => {
  it('editorAgent prompt mentions LSPQuery', () => {
    expect(editorAgent.systemPrompt).toMatch(/LSPQuery/)
  })

  it('editorAgent prompt instructs fallback to grep on notConfigured', () => {
    expect(editorAgent.systemPrompt.toLowerCase()).toMatch(/notconfigured/)
  })

  it('core:researcher prompt mentions LSPQuery', () => {
    expect(role('core:researcher').systemPrompt).toMatch(/LSPQuery/)
  })

  it('core:researcher exposes LSPQuery in allowedTools', () => {
    const allowed = role('core:researcher').allowedTools ?? []
    expect(allowed).toContain('LSPQuery')
  })

  it('core:implementer prompt mentions LSPQuery', () => {
    expect(role('core:implementer').systemPrompt).toMatch(/LSPQuery/)
  })

  it('core:implementer prompt instructs fallback to grep on notConfigured', () => {
    expect(role('core:implementer').systemPrompt.toLowerCase()).toMatch(/notconfigured/)
  })
})
