// test/core/config/scope.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { loadScopedConfig } from '../../../src/core/config/load'
import { deepMergeWithLock, extractLocked, SCOPE_ORDER } from '../../../src/core/config/scopeMerge'

/** Create a tmp directory tree for testing. */
function tmpDir(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-scope-'))
}

function writeConfig(dir: string, filename: string, content: string): void {
  const nukaDir = join(dir, '.nuka')
  mkdirSync(nukaDir, { recursive: true })
  writeFileSync(join(nukaDir, filename), content, 'utf8')
}

const VALID_PROVIDER = `
  - id: p1
    name: Test
    format: anthropic
    baseUrl: https://api.anthropic.com
    models: []
`

describe('SCOPE_ORDER', () => {
  it('is enterprise → user → project → local', () => {
    expect(SCOPE_ORDER).toEqual(['enterprise', 'user', 'project', 'local'])
  })
})

describe('extractLocked', () => {
  it('extracts locked array from enterprise config', () => {
    const raw = { locked: ['providers.openai.apiKey', 'mcp'] }
    expect(extractLocked(raw)).toEqual(['providers.openai.apiKey', 'mcp'])
  })

  it('returns empty array when no locked field', () => {
    expect(extractLocked({ providers: [] })).toEqual([])
  })

  it('returns empty array for non-object input', () => {
    expect(extractLocked(null)).toEqual([])
    expect(extractLocked('string')).toEqual([])
  })
})

describe('deepMergeWithLock', () => {
  it('merges simple key-value pairs (last-wins)', () => {
    const base: Record<string, unknown> = { a: 1 }
    const sources: Record<string, string> = {}
    deepMergeWithLock(base, { a: 2, b: 3 }, 'user', [], sources)
    expect(base.a).toBe(2)
    expect(base.b).toBe(3)
    expect(sources.a).toBe('user')
    expect(sources.b).toBe('user')
  })

  it('recursively merges nested objects', () => {
    const base: Record<string, unknown> = { nested: { x: 1, y: 2 } }
    const sources: Record<string, string> = {}
    deepMergeWithLock(base, { nested: { y: 99, z: 3 } }, 'project', [], sources)
    expect((base.nested as any).x).toBe(1)
    expect((base.nested as any).y).toBe(99)
    expect((base.nested as any).z).toBe(3)
  })

  it('drops locked keys with a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const base: Record<string, unknown> = { apiKey: 'enterprise-value' }
    const sources: Record<string, string> = {}
    deepMergeWithLock(base, { apiKey: 'user-value' }, 'user', ['apiKey'], sources)
    expect(base.apiKey).toBe('enterprise-value') // unchanged
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('enterprise-locked'))
    warnSpy.mockRestore()
  })

  it('drops nested locked dot-path keys', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const base: Record<string, unknown> = { providers: { openai: { apiKey: 'locked-value' } } }
    const sources: Record<string, string> = {}
    deepMergeWithLock(
      base,
      { providers: { openai: { apiKey: 'override' } } },
      'user',
      ['providers.openai.apiKey'],
      sources,
    )
    expect((base.providers as any).openai.apiKey).toBe('locked-value')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('loadScopedConfig', () => {
  let home: string
  let cwd: string
  let dirs: string[]

  beforeEach(() => {
    home = tmpDir()
    cwd = tmpDir()
    dirs = [home, cwd]
  })

  afterEach(() => {
    for (const dir of dirs) {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  })

  it('returns null perScope entries when no config files exist', async () => {
    const result = await loadScopedConfig({
      enterprisePath: '/nonexistent/enterprise.yaml',
      userPath: join(home, '.nuka', 'config.yaml'),
      projectCwd: cwd,
    })
    expect(result.perScope.enterprise).toBeNull()
    expect(result.perScope.user).toBeNull()
    expect(result.perScope.project).toBeNull()
    expect(result.perScope.local).toBeNull()
  })

  it('reads user scope and merges into effective (acceptance criterion 4 — backward compat)', async () => {
    writeConfig(home, 'config.yaml', `
providers: []
active:
  providerId: my-provider
`)
    const result = await loadScopedConfig({
      enterprisePath: '/nonexistent/e.yaml',
      userPath: join(home, '.nuka', 'config.yaml'),
      projectCwd: cwd,
    })
    expect(result.effective.active.providerId).toBe('my-provider')
    expect(result.perScope.user).toBeDefined()
    expect(result.perScope.user).not.toBeNull()
  })

  it('project scope overrides user scope for overlapping keys (acceptance criterion 1)', async () => {
    // User sets active.providerId = 'user-provider'
    writeConfig(home, 'config.yaml', `
providers: []
active:
  providerId: user-provider
`)
    // Project overrides active.providerId = 'project-provider'
    writeConfig(cwd, 'config.yaml', `
providers: []
active:
  providerId: project-provider
`)
    const result = await loadScopedConfig({
      enterprisePath: '/nonexistent/e.yaml',
      userPath: join(home, '.nuka', 'config.yaml'),
      projectCwd: cwd,
    })
    // Project wins (last-wins)
    expect(result.effective.active.providerId).toBe('project-provider')
  })

  it('local scope overrides project scope', async () => {
    writeConfig(cwd, 'config.yaml', `
providers: []
active:
  providerId: project-provider
`)
    writeConfig(cwd, 'config.local.yaml', `
providers: []
active:
  providerId: local-provider
`)
    const result = await loadScopedConfig({
      enterprisePath: '/nonexistent/e.yaml',
      userPath: join(home, '.nuka', 'config.yaml'),
      projectCwd: cwd,
    })
    expect(result.effective.active.providerId).toBe('local-provider')
  })

  it('enterprise locks a key — user cannot override it (acceptance criterion 2)', async () => {
    const enterpriseDir = tmpDir()
    dirs.push(enterpriseDir)
    const enterprisePath = join(enterpriseDir, 'enterprise.yaml')
    mkdirSync(enterpriseDir, { recursive: true })
    writeFileSync(enterprisePath, `
providers: []
active:
  providerId: enterprise-provider
locked:
  - active.providerId
`, 'utf8')

    writeConfig(home, 'config.yaml', `
providers: []
active:
  providerId: user-wants-this
`)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await loadScopedConfig({
      enterprisePath,
      userPath: join(home, '.nuka', 'config.yaml'),
      projectCwd: cwd,
    })

    // Enterprise value preserved — user override dropped
    expect(result.effective.active.providerId).toBe('enterprise-provider')
    expect(result.locked).toContain('active.providerId')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    rmSync(enterpriseDir, { recursive: true, force: true })
  })

  it('sources record tracks which scope contributed each key', async () => {
    writeConfig(home, 'config.yaml', `
providers: []
active:
  providerId: user-provider
`)
    writeConfig(cwd, 'config.yaml', `
providers: []
active:
  providerId: project-provider
`)
    const result = await loadScopedConfig({
      enterprisePath: '/nonexistent/e.yaml',
      userPath: join(home, '.nuka', 'config.yaml'),
      projectCwd: cwd,
    })
    // active.providerId was last set by project scope
    expect(result.sources['active.providerId']).toBe('project')
  })

  it('project scope walks ancestor directories (acceptance criterion 3)', async () => {
    // Create nested cwd: cwd/sub/sub2
    const sub = join(cwd, 'sub', 'sub2')
    mkdirSync(sub, { recursive: true })
    // Write .nuka/config.yaml at cwd (the ancestor)
    writeConfig(cwd, 'config.yaml', `
providers: []
active:
  providerId: ancestor-provider
`)
    // Use sub as projectCwd — should find ancestor's config
    const result = await loadScopedConfig({
      enterprisePath: '/nonexistent/e.yaml',
      userPath: join(home, '.nuka', 'config.yaml'),
      projectCwd: sub,
    })
    expect(result.effective.active.providerId).toBe('ancestor-provider')
    expect(result.perScope.project).not.toBeNull()
  })

  it('nuka config show --scope project returns only project contribution (acceptance criterion 3)', async () => {
    writeConfig(home, 'config.yaml', `
providers: []
active:
  providerId: user-provider
`)
    writeConfig(cwd, 'config.yaml', `
providers: []
active:
  providerId: project-provider
`)
    const result = await loadScopedConfig({
      enterprisePath: '/nonexistent/e.yaml',
      userPath: join(home, '.nuka', 'config.yaml'),
      projectCwd: cwd,
    })
    // The project scope's contribution should have project's providerId
    const projectScope = result.perScope.project
    expect(projectScope).not.toBeNull()
    expect((projectScope as any)?.active?.providerId).toBe('project-provider')
  })
})

describe('loadConfig backward compat', () => {
  it('loadConfig still works and merges providers by id', async () => {
    const { loadConfig } = await import('../../../src/core/config/load')
    const home = tmpDir()
    const cwd = tmpDir()
    mkdirSync(join(home, '.nuka'))
    writeFileSync(join(home, '.nuka', 'config.yaml'), `
providers:
  - id: p1
    name: Global
    format: anthropic
    baseUrl: https://api.anthropic.com
    models: []
active: { providerId: p1 }
`, 'utf8')
    mkdirSync(join(cwd, '.nuka'))
    writeFileSync(join(cwd, '.nuka', 'config.yaml'), `
providers:
  - id: p2
    name: Project
    format: openai
    baseUrl: https://api.openai.com/v1
    models: []
active: { providerId: p2 }
`, 'utf8')
    const cfg = await loadConfig({ home, cwd })
    // Both providers present (mergeProviders deduplication preserved)
    expect(cfg.providers.map((p: any) => p.name).sort()).toEqual(['Global', 'Project'])
    expect(cfg.active.providerId).toBe('p2')
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })
})
