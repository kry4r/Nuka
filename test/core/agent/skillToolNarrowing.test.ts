// test/core/agent/skillToolNarrowing.test.ts
//
// Phase 11 M2 regression: when a skill matches a user message, the model
// receives only the tools permitted by that skill's `requires` field (plus
// core tools). When no skill matches, the full tool set is preserved.

import { describe, it, expect } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import type { Tool } from '../../../src/core/tools/types'
import type { Skill } from '../../../src/core/skill/types'

// Provider that records the `tools` array passed to each stream() call.
function makeRecordingProvider(): {
  provider: LLMProvider
  recorded: Array<{ name: string }[]>
} {
  const recorded: Array<{ name: string }[]> = []
  const provider: LLMProvider = {
    id: 'p',
    format: 'openai',
    async *stream(req: { tools?: { name: string }[] }): AsyncIterable<ProviderEvent> {
      recorded.push((req.tools ?? []).map(t => ({ name: t.name })))
      yield { type: 'text_delta', text: 'ok' }
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
  return { provider, recorded }
}

function makeTool(name: string, tags: string[]): Tool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    source: 'builtin',
    tags,
    needsPermission: () => 'none',
    run: async () => ({ output: '', isError: false }),
  }
}

describe('skill tool narrowing (Phase 11 M2)', () => {
  const skill: Skill = {
    name: 's',
    when: { keyword: ['hello'] },
    requires: ['x'],
    body: 'skill body',
    source: 'global',
    path: '/fake/s.md',
  }

  it('Case A — matching input: model receives core + required tools, not unrelated ones', async () => {
    const { provider, recorded } = makeRecordingProvider()
    const tools = new ToolRegistry()
    tools.register(makeTool('core1', ['core']))
    tools.register(makeTool('a', ['x']))
    tools.register(makeTool('b', ['y']))

    const session = createSession({ providerId: 'p', model: 'm' })
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    for await (const _ of runAgent(
      { text: 'hello world' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission, skills: [skill] },
      new AbortController().signal,
    )) { /* drain */ }

    expect(recorded).toHaveLength(1)
    const names = recorded[0]!.map(t => t.name)
    expect(names).toContain('core1')
    expect(names).toContain('a')
    expect(names).not.toContain('b')
  })

  it('Case B — non-matching input: model receives all three tools (full registry)', async () => {
    const { provider, recorded } = makeRecordingProvider()
    const tools = new ToolRegistry()
    tools.register(makeTool('core1', ['core']))
    tools.register(makeTool('a', ['x']))
    tools.register(makeTool('b', ['y']))

    const session = createSession({ providerId: 'p', model: 'm' })
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    for await (const _ of runAgent(
      { text: 'unrelated' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission, skills: [skill] },
      new AbortController().signal,
    )) { /* drain */ }

    expect(recorded).toHaveLength(1)
    const names = recorded[0]!.map(t => t.name)
    expect(names).toContain('core1')
    expect(names).toContain('a')
    expect(names).toContain('b')
  })
})
