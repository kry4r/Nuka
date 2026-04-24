import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveAgentDef } from '../../../src/core/agents/loader'

function mkPlugin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nuka-agent-loader-'))
  return dir
}

describe('resolveAgentDef', () => {
  it('passes through an inline systemPrompt', async () => {
    const dir = mkPlugin()
    const resolved = await resolveAgentDef(
      {
        name: 'reviewer',
        description: 'reviews code',
        systemPrompt: 'You are a reviewer.',
        maxTurns: 20,
      },
      dir,
      'core',
    )
    expect(resolved.systemPrompt).toBe('You are a reviewer.')
    expect(resolved.pluginName).toBe('core')
    expect(resolved.name).toBe('reviewer')
    expect('systemPromptPath' in resolved).toBe(false)
  })

  it('reads systemPromptPath relative to pluginDir', async () => {
    const dir = mkPlugin()
    mkdirSync(join(dir, 'prompts'), { recursive: true })
    writeFileSync(join(dir, 'prompts', 'tester.md'), 'Act as a tester.')
    const resolved = await resolveAgentDef(
      {
        name: 'tester',
        description: 'runs tests',
        systemPromptPath: 'prompts/tester.md',
        maxTurns: 20,
      },
      dir,
      'core',
    )
    expect(resolved.systemPrompt).toBe('Act as a tester.')
    expect(resolved.pluginName).toBe('core')
  })

  it('throws a descriptive error when systemPromptPath is missing', async () => {
    const dir = mkPlugin()
    await expect(
      resolveAgentDef(
        {
          name: 'ghost',
          description: 'missing',
          systemPromptPath: 'no/such/file.md',
          maxTurns: 20,
        },
        dir,
        'core',
      ),
    ).rejects.toThrow(/systemPromptPath/)
  })
})
