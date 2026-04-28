import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { wirePlugin } from '../../../src/core/plugin/wire'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { SlashRegistry } from '../../../src/slash/registry'
import { AgentRegistry } from '../../../src/core/agents/registry'
import { LspManager } from '../../../src/core/lsp/manager'
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
      ...overrides,
    },
    rootDir: root,
    source: 'installed' as const,
  }
}

describe('wirePlugin', () => {
  it('wires all contributions and returns correct counts', async () => {
    await makeFixtures()
    const tools = new ToolRegistry()
    const slash = new SlashRegistry()
    const skills: import('../../../src/core/skill/types').Skill[] = []

    const result = await wirePlugin(makePlugin(), { tools, slash, skills })

    expect(result).toEqual({ toolsAdded: 1, slashAdded: 1, skillsAdded: 1, hooksAdded: 0, agentsAdded: 0, lspAdded: 0, errors: [] })

    const t = tools.find('plugin__demo__Hello')
    expect(t).toBeDefined()
    expect(t?.source).toBe('plugin')

    const cmd = slash.find('demo:greet')
    expect(cmd).toBeDefined()

    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('hello-skill')
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

    const result = await wirePlugin(makePlugin(), { tools, slash, skills })

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

    const result = await wirePlugin(
      makePlugin({ tools: ['mytool.mjs'], slashCommands: [], skills: [] }),
      { tools, slash, skills },
    )

    expect(result.toolsAdded).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatch(/boom/)
  })

  it('registers agents under <plugin>:<name>', async () => {
    await writeFile(join(root, 'tester.md'), 'Act as a tester.', 'utf8')
    const tools = new ToolRegistry()
    const slash = new SlashRegistry()
    const skills: import('../../../src/core/skill/types').Skill[] = []
    const agents = new AgentRegistry()
    const plugin: LoadedPlugin = {
      manifest: {
        name: 'demo',
        tools: [],
        slashCommands: [],
        skills: [],
        agents: [
          { name: 'reviewer', description: 'reviews code', systemPrompt: 'you review', maxTurns: 20 },
          { name: 'tester', description: 'runs tests', systemPromptPath: 'tester.md', maxTurns: 20 },
        ],
      },
      rootDir: root,
      source: 'installed' as const,
    }
    const result = await wirePlugin(plugin, { tools, slash, skills, agents })
    expect(result.agentsAdded).toBe(2)
    expect(result.errors).toEqual([])
    expect(agents.find('demo:reviewer')?.systemPrompt).toBe('you review')
    expect(agents.find('demo:tester')?.systemPrompt).toBe('Act as a tester.')
  })

  describe('lspServers', () => {
    it('registers each lspServers entry with LspManager — namespaced as <plugin>:<name>', async () => {
      const tools = new ToolRegistry()
      const slash = new SlashRegistry()
      const skills: import('../../../src/core/skill/types').Skill[] = []
      const lsp = new LspManager()

      const plugin: LoadedPlugin = {
        manifest: {
          name: 'demo',
          tools: [],
          slashCommands: [],
          skills: [],
          lspServers: [
            {
              name: 'ts',
              command: 'typescript-language-server',
              args: ['--stdio'],
              documentSelector: [{ language: 'typescript' }],
            },
          ],
        },
        rootDir: root,
        source: 'installed' as const,
      }

      const result = await wirePlugin(plugin, { tools, slash, skills, lsp })
      expect(result.lspAdded).toBe(1)
      expect(result.errors).toEqual([])
      expect(lsp.list()).toHaveLength(1)
      expect(lsp.list()[0]!.name).toBe('demo:ts')
    })

    it('reports collision as error when two plugins declare same selector', async () => {
      const tools = new ToolRegistry()
      const slash = new SlashRegistry()
      const skills: import('../../../src/core/skill/types').Skill[] = []
      const lsp = new LspManager()

      // Pre-register a TS server
      lsp.register({
        name: 'existing:ts',
        command: 'tsserver',
        documentSelector: [{ language: 'typescript' }],
      })

      const plugin: LoadedPlugin = {
        manifest: {
          name: 'demo',
          tools: [],
          slashCommands: [],
          skills: [],
          lspServers: [
            {
              name: 'ts',
              command: 'typescript-language-server',
              args: ['--stdio'],
              documentSelector: [{ language: 'typescript' }],
            },
          ],
        },
        rootDir: root,
        source: 'installed' as const,
      }

      const result = await wirePlugin(plugin, { tools, slash, skills, lsp })
      expect(result.lspAdded).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatch(/already registered/)
    })

    it('skips lsp registration when no lsp dep is provided', async () => {
      const tools = new ToolRegistry()
      const slash = new SlashRegistry()
      const skills: import('../../../src/core/skill/types').Skill[] = []

      const plugin: LoadedPlugin = {
        manifest: {
          name: 'demo',
          tools: [],
          slashCommands: [],
          skills: [],
          lspServers: [{ name: 'ts', command: 'tsserver', documentSelector: [{ language: 'typescript' }] }],
        },
        rootDir: root,
        source: 'installed' as const,
      }

      // No lsp dep — should silently skip
      const result = await wirePlugin(plugin, { tools, slash, skills })
      expect(result.lspAdded).toBe(0)
      expect(result.errors).toEqual([])
    })
  })

  it('missing systemPromptPath: logs error, other agents still load', async () => {
    const tools = new ToolRegistry()
    const slash = new SlashRegistry()
    const skills: import('../../../src/core/skill/types').Skill[] = []
    const agents = new AgentRegistry()
    const plugin: LoadedPlugin = {
      manifest: {
        name: 'demo',
        tools: [],
        slashCommands: [],
        skills: [],
        agents: [
          { name: 'ghost', description: 'missing', systemPromptPath: 'nope.md', maxTurns: 20 },
          { name: 'ok', description: 'ok', systemPrompt: 'fine', maxTurns: 20 },
        ],
      },
      rootDir: root,
      source: 'installed' as const,
    }
    const result = await wirePlugin(plugin, { tools, slash, skills, agents })
    expect(result.agentsAdded).toBe(1)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toMatch(/ghost/)
    expect(agents.find('demo:ok')).toBeDefined()
    expect(agents.find('demo:ghost')).toBeUndefined()
  })
})
