import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveAgentDef } from '../../../src/core/agents/loader'
import { AgentDefSchema } from '../../../src/core/agents/types'

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

  it('adds memory file tools for memory-enabled plugin agents with an explicit allowlist', async () => {
    const dir = mkPlugin()
    const resolved = await resolveAgentDef(
      {
        name: 'remembering-reviewer',
        description: 'reviews and remembers feedback',
        systemPrompt: 'Review code.',
        allowedTools: ['Grep'],
        memory: 'project',
        maxTurns: 20,
      },
      dir,
      'demo',
    )

    expect(resolved.allowedTools).toEqual(['Grep', 'Read', 'Write', 'Edit'])
  })

  it('preserves plugin agent MCP and hook runtime metadata', async () => {
    const dir = mkPlugin()
    const resolved = await resolveAgentDef(
      {
        name: 'mcp-reviewer',
        description: 'reviews with MCP context',
        systemPrompt: 'Review with context.',
        maxTurns: 20,
        requiredMcpServers: ['github'],
        mcpServers: ['github', { localfs: { command: 'nuka-mcp-filesystem' } }],
        hooks: { SubagentStart: [{ command: 'echo start' }] },
      },
      dir,
      'demo',
    )

    expect(resolved.requiredMcpServers).toEqual(['github'])
    expect(resolved.mcpServers).toEqual(['github', { localfs: { command: 'nuka-mcp-filesystem' } }])
    expect(resolved.hooks).toEqual({ SubagentStart: [{ command: 'echo start' }] })
  })

  it('rejects plugin agent MCP and hook metadata that is not JSON-serializable', () => {
    expect(() => AgentDefSchema.parse({
      name: 'bad-hook-agent',
      description: 'declares non-serializable hook metadata',
      systemPrompt: 'Review with context.',
      maxTurns: 20,
      requiredMcpServers: ['github'],
      mcpServers: [{ local: { command: undefined } }],
    })).toThrow(/mcpServers/)

    expect(() => AgentDefSchema.parse({
      name: 'bad-hook-agent',
      description: 'declares non-serializable hook metadata',
      systemPrompt: 'Review with context.',
      maxTurns: 20,
      hooks: { SubagentStart: [() => undefined] },
    })).toThrow(/hooks/)
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
