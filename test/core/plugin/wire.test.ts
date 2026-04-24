import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { wirePlugin } from '../../../src/core/plugin/wire'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { SlashRegistry } from '../../../src/slash/registry'
import type { LoadedPlugin } from '../../../src/core/plugin/manifest'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(os.tmpdir(), 'nuka-wire-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function makeFixtures(): Promise<void> {
  // Tool module
  await writeFile(
    join(root, 'mytool.mjs'),
    `export default {
  name: 'Hello',
  description: 'says hi',
  parameters: { type: 'object', properties: {} },
  source: 'builtin',
  needsPermission: () => 'none',
  run: async () => ({ output: 'hi', isError: false }),
}
`,
    'utf8',
  )

  // Slash command module
  await writeFile(
    join(root, 'myslash.mjs'),
    `export default {
  name: 'greet',
  description: 'greets',
  run: async () => ({ type: 'text', text: 'hi' }),
}
`,
    'utf8',
  )

  // Skill markdown
  await writeFile(
    join(root, 'myskill.md'),
    `---\nname: hello-skill\n---\n\nbody`,
    'utf8',
  )
}

function makePlugin(overrides: Partial<LoadedPlugin['manifest']> = {}): LoadedPlugin {
  return {
    manifest: {
      name: 'demo',
      tools: ['mytool.mjs'],
      slashCommands: ['myslash.mjs'],
      skills: ['myskill.md'],
      mcpServers: {
        'local-fs': { type: 'stdio', command: 'node', args: ['server.js'] },
      },
      ...overrides,
    },
    rootDir: root,
  }
}

describe('wirePlugin', () => {
  it('wires all contributions and returns correct counts', async () => {
    await makeFixtures()
    const tools = new ToolRegistry()
    const slash = new SlashRegistry()
    const skills: import('../../../src/core/skill/types').Skill[] = []
    const mcpServers: Record<string, import('../../../src/core/mcp/types').McpServerConfig> = {}

    const result = await wirePlugin(makePlugin(), { tools, slash, skills, mcpServers })

    expect(result).toEqual({ toolsAdded: 1, slashAdded: 1, skillsAdded: 1, mcpAdded: 1, errors: [] })

    const t = tools.find('plugin__demo__Hello')
    expect(t).toBeDefined()
    expect(t?.source).toBe('plugin')

    const cmd = slash.find('demo:greet')
    expect(cmd).toBeDefined()

    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('hello-skill')

    expect(mcpServers['local-fs']).toBeDefined()
  })

  it('duplicate tool: counts 0, no exception, builtin survives', async () => {
    await makeFixtures()
    const tools = new ToolRegistry()
    // Pre-register a tool with the same namespaced name
    tools.register({
      name: 'plugin__demo__Hello',
      description: 'pre-registered',
      parameters: {},
      source: 'builtin',
      needsPermission: () => 'none',
      run: async () => ({ output: 'pre', isError: false }),
    })
    const slash = new SlashRegistry()
    const skills: import('../../../src/core/skill/types').Skill[] = []
    const mcpServers: Record<string, import('../../../src/core/mcp/types').McpServerConfig> = {}

    const result = await wirePlugin(makePlugin(), { tools, slash, skills, mcpServers })

    expect(result.toolsAdded).toBe(0)
    expect(result.errors).toEqual([])
    const t = tools.find('plugin__demo__Hello')
    expect(t?.source).toBe('builtin')
  })

  it('malformed module (throws at import) pushes error and does not crash', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'mytool.mjs'), `throw new Error('boom')`, 'utf8')

    const tools = new ToolRegistry()
    const slash = new SlashRegistry()
    const skills: import('../../../src/core/skill/types').Skill[] = []
    const mcpServers: Record<string, import('../../../src/core/mcp/types').McpServerConfig> = {}

    const result = await wirePlugin(
      makePlugin({ tools: ['mytool.mjs'], slashCommands: [], skills: [], mcpServers: {} }),
      { tools, slash, skills, mcpServers },
    )

    expect(result.toolsAdded).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatch(/boom/)
  })

  it('duplicate mcp server pushes error and skips', async () => {
    await makeFixtures()
    const tools = new ToolRegistry()
    const slash = new SlashRegistry()
    const skills: import('../../../src/core/skill/types').Skill[] = []
    const mcpServers: Record<string, import('../../../src/core/mcp/types').McpServerConfig> = {
      'local-fs': { type: 'stdio', command: 'existing', args: [] },
    }

    const result = await wirePlugin(makePlugin(), { tools, slash, skills, mcpServers })

    expect(result.mcpAdded).toBe(0)
    expect(result.errors.some(e => e.includes("mcp server 'local-fs'"))).toBe(true)
    // original entry survives
    expect((mcpServers['local-fs'] as { command: string }).command).toBe('existing')
  })
})
