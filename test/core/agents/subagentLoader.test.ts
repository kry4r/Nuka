// test/core/agents/subagentLoader.test.ts
//
// Coverage for the loose-file subagent loader. Uses real temp dirs so
// fs walking, YAML/JSON parsing, and per-file error isolation are
// exercised end-to-end. Mock-free by design — the loader is a thin
// wrapper around `node:fs`, `yaml`, and Zod, and mocking those would
// only re-prove they work.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import {
  loadSubagentFile,
  loadSubagentsFromDir,
  defaultSubagentDirs,
  subagentToAgentDef,
} from '../../../src/core/agents/subagentLoader'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(os.tmpdir(), 'nuka-subagent-loader-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadSubagentFile — happy path', () => {
  it('loads a valid YAML file', async () => {
    const filePath = join(dir, 'reviewer.yaml')
    await writeFile(
      filePath,
      [
        'name: reviewer',
        'description: reviews code carefully',
        "systemPrompt: 'You are a code reviewer.'",
        'tools:',
        '  - Read',
        '  - Grep',
        'model: claude-opus-4-7',
        'maxTurns: 10',
      ].join('\n'),
      'utf8',
    )
    const def = await loadSubagentFile(filePath)
    expect(def.name).toBe('reviewer')
    expect(def.description).toBe('reviews code carefully')
    expect(def.systemPrompt).toBe('You are a code reviewer.')
    expect(def.tools).toEqual(['Read', 'Grep'])
    expect(def.model).toBe('claude-opus-4-7')
    expect(def.maxTurns).toBe(10)
    expect(def.sourcePath).toBe(filePath)
  })

  it('loads a valid JSON file', async () => {
    const filePath = join(dir, 'planner.json')
    await writeFile(
      filePath,
      JSON.stringify({
        name: 'planner',
        description: 'plans the work',
        systemPrompt: 'You are a planner.',
        tools: ['Read', 'Write'],
        keywords: ['plan', 'design'],
      }),
      'utf8',
    )
    const def = await loadSubagentFile(filePath)
    expect(def.name).toBe('planner')
    expect(def.tools).toEqual(['Read', 'Write'])
    expect(def.keywords).toEqual(['plan', 'design'])
  })

  it('loads a .yml file (alternate YAML extension)', async () => {
    const filePath = join(dir, 'tester.yml')
    await writeFile(
      filePath,
      ['name: tester', 'description: runs tests', 'systemPrompt: Test.'].join(
        '\n',
      ),
      'utf8',
    )
    const def = await loadSubagentFile(filePath)
    expect(def.name).toBe('tester')
    expect(def.systemPrompt).toBe('Test.')
  })

  it('loads a Nuka-Code style markdown file with frontmatter', async () => {
    const filePath = join(dir, 'explore.md')
    await writeFile(
      filePath,
      [
        '---',
        'name: explore',
        'description: read the codebase and report findings',
        'tools:',
        '  - Read',
        '  - Grep',
        'model: inherit',
        'maxTurns: 7',
        '---',
        '',
        'You are a read-only explorer.',
        'Return concise findings.',
      ].join('\n'),
      'utf8',
    )
    const def = await loadSubagentFile(filePath)
    expect(def.name).toBe('explore')
    expect(def.description).toBe('read the codebase and report findings')
    expect(def.systemPrompt).toBe('You are a read-only explorer.\nReturn concise findings.')
    expect(def.tools).toEqual(['Read', 'Grep'])
    expect(def.model).toBe('inherit')
    expect(def.maxTurns).toBe(7)
  })

  it('loads Nuka-Code memory frontmatter scope', async () => {
    const filePath = join(dir, 'researcher.md')
    await writeFile(
      filePath,
      [
        '---',
        'name: researcher',
        'description: research with persistent notes',
        'memory: project',
        '---',
        '',
        'You remember project-specific research patterns.',
      ].join('\n'),
      'utf8',
    )

    const def = await loadSubagentFile(filePath)
    expect(def.memory).toBe('project')
  })

  it('loads Nuka-Code isolation frontmatter', async () => {
    const filePath = join(dir, 'worker.md')
    await writeFile(
      filePath,
      [
        '---',
        'name: worker',
        'description: implements in an isolated checkout',
        'isolation: worktree',
        '---',
        '',
        'You implement changes without touching the parent checkout.',
      ].join('\n'),
      'utf8',
    )

    const def = await loadSubagentFile(filePath)
    expect(def.isolation).toBe('worktree')
  })

  it('loads Nuka-Code background frontmatter', async () => {
    const filePath = join(dir, 'verifier.md')
    await writeFile(
      filePath,
      [
        '---',
        'name: verifier',
        'description: verifies independently',
        'background: true',
        '---',
        '',
        'You verify in the background.',
      ].join('\n'),
      'utf8',
    )

    const def = await loadSubagentFile(filePath)
    expect(def.background).toBe(true)
  })

  it('accepts quoted Nuka-Code background frontmatter booleans', async () => {
    const filePath = join(dir, 'foreground.md')
    await writeFile(
      filePath,
      [
        '---',
        'name: foreground',
        'description: stays synchronous by default',
        'background: "false"',
        '---',
        '',
        'You can run in the foreground.',
      ].join('\n'),
      'utf8',
    )

    const def = await loadSubagentFile(filePath)
    expect(def.background).toBe(false)
  })

  it('adds memory file tools when memory is enabled with an explicit allowlist', async () => {
    const filePath = join(dir, 'remembering-reviewer.md')
    await writeFile(
      filePath,
      [
        '---',
        'name: remembering-reviewer',
        'description: reviews and remembers feedback',
        'tools:',
        '  - Grep',
        'memory: local',
        '---',
        '',
        'You review code.',
      ].join('\n'),
      'utf8',
    )

    const def = await loadSubagentFile(filePath)
    expect(def.tools).toEqual(['Grep', 'Read', 'Write', 'Edit'])
  })

  it('maps Nuka-Code disallowedTools frontmatter to deniedTools', async () => {
    const filePath = join(dir, 'verify.md')
    await writeFile(
      filePath,
      [
        '---',
        'name: verify',
        'description: verify code changes',
        'tools: "*"',
        'disallowedTools:',
        '  - Write',
        '  - Bash',
        '---',
        'You verify.',
      ].join('\n'),
      'utf8',
    )
    const def = await loadSubagentFile(filePath)
    expect(def.tools).toBeUndefined()
    expect(def.deniedTools).toEqual(['Write', 'Bash'])
  })

  it('accepts allowedTools as an alias for tools', async () => {
    const filePath = join(dir, 'auditor.json')
    await writeFile(
      filePath,
      JSON.stringify({
        name: 'auditor',
        description: 'security auditor',
        systemPrompt: 'You audit code.',
        allowedTools: ['Read', 'Grep'],
      }),
      'utf8',
    )
    const def = await loadSubagentFile(filePath)
    expect(def.tools).toEqual(['Read', 'Grep'])
  })

  it('preserves deniedTools, maxTokens, temperature when provided', async () => {
    const filePath = join(dir, 'gen.json')
    await writeFile(
      filePath,
      JSON.stringify({
        name: 'gen',
        description: 'codegen',
        systemPrompt: 'Generate code.',
        deniedTools: ['Bash'],
        maxTokens: 4096,
        temperature: 0.7,
      }),
      'utf8',
    )
    const def = await loadSubagentFile(filePath)
    expect(def.deniedTools).toEqual(['Bash'])
    expect(def.maxTokens).toBe(4096)
    expect(def.temperature).toBe(0.7)
  })
})

describe('loadSubagentFile — invalid shape', () => {
  async function writeJson(name: string, obj: unknown): Promise<string> {
    const filePath = join(dir, name)
    await writeFile(filePath, JSON.stringify(obj), 'utf8')
    return filePath
  }

  it('throws on missing required name field', async () => {
    const fp = await writeJson('bad.json', {
      description: 'd',
      systemPrompt: 'p',
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/invalid shape/i)
  })

  it('throws on missing required description field', async () => {
    const fp = await writeJson('bad.json', {
      name: 'x',
      systemPrompt: 'p',
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/description/)
  })

  it('throws on missing required systemPrompt field', async () => {
    const fp = await writeJson('bad.json', {
      name: 'x',
      description: 'd',
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/systemPrompt/)
  })

  it('throws when tools is not an array', async () => {
    const fp = await writeJson('bad.json', {
      name: 'x',
      description: 'd',
      systemPrompt: 'p',
      tools: 'Read,Grep',
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/invalid shape/i)
  })

  it('throws when name contains uppercase / invalid chars', async () => {
    const fp = await writeJson('bad.json', {
      name: 'BadName',
      description: 'd',
      systemPrompt: 'p',
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/name/)
  })

  it('throws when both tools and allowedTools are supplied', async () => {
    const fp = await writeJson('bad.json', {
      name: 'x',
      description: 'd',
      systemPrompt: 'p',
      tools: ['Read'],
      allowedTools: ['Grep'],
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/tools.*allowedTools/)
  })

  it('throws when memory scope is invalid', async () => {
    const fp = await writeJson('bad.json', {
      name: 'x',
      description: 'd',
      systemPrompt: 'p',
      memory: 'repo',
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/memory/)
  })

  it('throws when isolation mode is invalid', async () => {
    const fp = await writeJson('bad.json', {
      name: 'x',
      description: 'd',
      systemPrompt: 'p',
      isolation: 'container',
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/isolation/)
  })

  it('throws when background mode is invalid', async () => {
    const fp = await writeJson('bad.json', {
      name: 'x',
      description: 'd',
      systemPrompt: 'p',
      background: 'sometimes',
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/background/)
  })

  it('throws on unknown/extra field (strict schema)', async () => {
    const fp = await writeJson('bad.json', {
      name: 'x',
      description: 'd',
      systemPrompt: 'p',
      bogus: true,
    })
    await expect(loadSubagentFile(fp)).rejects.toThrow(/invalid shape/i)
  })
})

describe('loadSubagentFile — file system errors', () => {
  it('throws on file-not-found', async () => {
    const fp = join(dir, 'missing.yaml')
    await expect(loadSubagentFile(fp)).rejects.toThrow(/read failed/)
  })

  it('throws on unsupported extension', async () => {
    const fp = join(dir, 'agent.toml')
    await writeFile(fp, 'name = "x"', 'utf8')
    await expect(loadSubagentFile(fp)).rejects.toThrow(/unsupported file extension/)
  })

  it('throws on malformed JSON', async () => {
    const fp = join(dir, 'broken.json')
    await writeFile(fp, '{ name: "x"', 'utf8')
    await expect(loadSubagentFile(fp)).rejects.toThrow(/JSON/)
  })

  it('throws on malformed YAML', async () => {
    const fp = join(dir, 'broken.yaml')
    // Deliberately invalid: mismatched indentation inside a flow mapping
    await writeFile(fp, 'name: x\n: : :', 'utf8')
    await expect(loadSubagentFile(fp)).rejects.toThrow(/YAML|invalid shape/)
  })
})

describe('loadSubagentsFromDir', () => {
  it('returns empty result for a non-existent directory', async () => {
    const res = await loadSubagentsFromDir(join(dir, 'does-not-exist'))
    expect(res.loaded).toEqual([])
    expect(res.errors).toEqual([])
  })

  it('returns empty result for an empty directory', async () => {
    const res = await loadSubagentsFromDir(dir)
    expect(res.loaded).toEqual([])
    expect(res.errors).toEqual([])
  })

  it('loads multiple files into a single batch', async () => {
    await writeFile(
      join(dir, 'a.yaml'),
      'name: a\ndescription: a\nsystemPrompt: prompt-a\n',
    )
    await writeFile(
      join(dir, 'b.json'),
      JSON.stringify({ name: 'b', description: 'b', systemPrompt: 'prompt-b' }),
    )
    const res = await loadSubagentsFromDir(dir)
    expect(res.errors).toEqual([])
    const names = res.loaded.map((d) => d.name).sort()
    expect(names).toEqual(['a', 'b'])
  })

  it('collects per-file errors without failing the whole batch', async () => {
    await writeFile(
      join(dir, 'good.yaml'),
      'name: good\ndescription: g\nsystemPrompt: gp\n',
    )
    await writeFile(join(dir, 'broken.json'), '{ not valid')
    const res = await loadSubagentsFromDir(dir)
    expect(res.loaded.map((d) => d.name)).toEqual(['good'])
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.path).toMatch(/broken\.json$/)
    expect(res.errors[0]!.message).toMatch(/JSON/)
  })

  it('ignores files with non-agent extensions', async () => {
    await writeFile(
      join(dir, 'good.yaml'),
      'name: good\ndescription: g\nsystemPrompt: gp\n',
    )
    await writeFile(join(dir, 'README.md'), '# not an agent')
    await writeFile(join(dir, 'config.toml'), 'unrelated = true')
    const res = await loadSubagentsFromDir(dir)
    expect(res.loaded).toHaveLength(1)
    expect(res.errors).toEqual([])
  })

  it('ignores markdown files without frontmatter during directory scans', async () => {
    await writeFile(
      join(dir, 'good.md'),
      ['---', 'name: good', 'description: g', '---', 'prompt'].join('\n'),
    )
    await writeFile(join(dir, 'README.md'), '# subagents\n\nProject notes only.')
    const res = await loadSubagentsFromDir(dir)
    expect(res.errors).toEqual([])
    expect(res.loaded.map((d) => d.name)).toEqual(['good'])
  })

  it('ignores markdown frontmatter documents without agent name during directory scans', async () => {
    await writeFile(
      join(dir, 'good.md'),
      ['---', 'name: good', 'description: g', '---', 'prompt'].join('\n'),
    )
    await writeFile(
      join(dir, 'notes.md'),
      ['---', 'title: subagent notes', '---', '# Notes only'].join('\n'),
    )
    const res = await loadSubagentsFromDir(dir)
    expect(res.errors).toEqual([])
    expect(res.loaded.map((d) => d.name)).toEqual(['good'])
  })

  it('scans nested directories when recursive: true (default)', async () => {
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(
      join(dir, 'top.yaml'),
      'name: top\ndescription: t\nsystemPrompt: tp\n',
    )
    await writeFile(
      join(dir, 'nested', 'inner.yaml'),
      'name: inner\ndescription: i\nsystemPrompt: ip\n',
    )
    const res = await loadSubagentsFromDir(dir)
    expect(res.loaded.map((d) => d.name).sort()).toEqual(['inner', 'top'])
  })

  it('skips nested directories when recursive: false', async () => {
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(
      join(dir, 'top.yaml'),
      'name: top\ndescription: t\nsystemPrompt: tp\n',
    )
    await writeFile(
      join(dir, 'nested', 'inner.yaml'),
      'name: inner\ndescription: i\nsystemPrompt: ip\n',
    )
    const res = await loadSubagentsFromDir(dir, { recursive: false })
    expect(res.loaded.map((d) => d.name)).toEqual(['top'])
  })

  it('handles duplicate names: last wins with a warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Filenames are scanned in sorted order — `b-second.yaml` loads after
    // `a-first.yaml`, so the "second" file wins. The fixture below makes
    // both files declare `name: dup` with different prompts so we can
    // verify which definition survived.
    await writeFile(
      join(dir, 'a-first.yaml'),
      'name: dup\ndescription: first\nsystemPrompt: first-prompt\n',
    )
    await writeFile(
      join(dir, 'b-second.yaml'),
      'name: dup\ndescription: second\nsystemPrompt: second-prompt\n',
    )
    const res = await loadSubagentsFromDir(dir)
    expect(res.errors).toEqual([])
    expect(res.loaded).toHaveLength(1)
    expect(res.loaded[0]!.systemPrompt).toBe('second-prompt')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]![0]).toMatch(/duplicate name 'dup'/)
    warnSpy.mockRestore()
  })
})

describe('defaultSubagentDirs', () => {
  it('returns project-scoped path first, user-scoped second', () => {
    const paths = defaultSubagentDirs('/cwd', '/home')
    expect(paths).toEqual([
      join('/cwd', '.nuka', 'subagents'),
      join('/home', '.nuka', 'subagents'),
    ])
  })

  it('omits the user-scoped path when home is empty', () => {
    const paths = defaultSubagentDirs('/cwd', '')
    expect(paths).toEqual([join('/cwd', '.nuka', 'subagents')])
  })

  it('falls back to process.cwd() / HOME when args omitted', () => {
    const paths = defaultSubagentDirs()
    expect(paths.length).toBeGreaterThanOrEqual(1)
    expect(paths[0]).toContain('.nuka/subagents')
  })
})

describe('subagentToAgentDef', () => {
  it('preserves loose-file runtime metadata for registry resolution', () => {
    const agentDef = subagentToAgentDef({
      name: 'worker',
      description: 'implements isolated changes',
      systemPrompt: 'Implement carefully.',
      tools: ['Read', 'Edit'],
      deniedTools: ['Bash'],
      model: 'inherit',
      maxTurns: 8,
      maxTokens: 4096,
      temperature: 0.2,
      memory: 'project',
      isolation: 'worktree',
      background: true,
      keywords: ['implement'],
      sourcePath: '/tmp/worker.md',
    })

    expect(agentDef).toEqual({
      name: 'worker',
      description: 'implements isolated changes',
      systemPrompt: 'Implement carefully.',
      allowedTools: ['Read', 'Edit'],
      deniedTools: ['Bash'],
      model: 'inherit',
      maxTurns: 8,
      maxTokens: 4096,
      temperature: 0.2,
      memory: 'project',
      isolation: 'worktree',
      background: true,
      keywords: ['implement'],
    })
  })

  it('defaults maxTurns to 20 for loose-file agents', () => {
    const agentDef = subagentToAgentDef({
      name: 'reader',
      description: 'reads code',
      systemPrompt: 'Read.',
      sourcePath: '/tmp/reader.md',
    })

    expect(agentDef.maxTurns).toBe(20)
  })
})
