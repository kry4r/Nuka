import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { loadConfig } from '../../../src/core/config/load'
import { ConfigSchema } from '../../../src/core/config/schema'
import { providerRetryOptionsFromConfig } from '../../../src/core/config/providerRetry'

function tmp(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-cfg-'))
}

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.NUKA_ACTIVE_PROVIDER_ID
  })

  it('returns default empty config when no files exist', async () => {
    const home = tmp()
    const cwd = tmp()
    const cfg = await loadConfig({ home, cwd })
    expect(cfg.providers).toEqual([])
    expect(cfg.active.providerId).toBe('')
  })

  it('reads a global yaml file', async () => {
    const home = tmp()
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'config.yaml'),
      `providers:
  - id: p1
    name: A
    format: anthropic
    baseUrl: https://api.anthropic.com
    apiKey: sk-x
    models: [claude-sonnet-4-6]
active:
  providerId: p1
`,
    )
    const cfg = await loadConfig({ home, cwd: tmp() })
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.active.providerId).toBe('p1')
  })

  it('loads provider effort capability metadata', async () => {
    const home = tmp()
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'config.yaml'),
      `providers:
  - id: p1
    name: A
    format: openai
    baseUrl: https://api.openai.com/v1
    models: [gpt-5, gpt-4o-mini]
    effort:
      gpt-5: [low, medium, high]
      gpt-4o-mini: false
active:
  providerId: p1
`,
    )

    const cfg = await loadConfig({ home, cwd: tmp() })

    expect(cfg.providers[0].effort?.['gpt-5']).toEqual(['low', 'medium', 'high'])
    expect(cfg.providers[0].effort?.['gpt-4o-mini']).toBe(false)
  })

  it('cascades non-provider fields from project scope (harness, recap)', async () => {
    const home = tmp()
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'config.yaml'),
      `harness:
  mode: deep
recap:
  awayThresholdMinutes: 5
`,
    )
    const cwd = tmp()
    mkdirSync(join(cwd, '.nuka'))
    writeFileSync(
      join(cwd, '.nuka', 'config.yaml'),
      `harness:
  mode: fast
recap:
  awayThresholdMinutes: 10
`,
    )
    const cfg = await loadConfig({ home, cwd })
    expect(cfg.harness?.mode).toBe('fast')
    expect(cfg.recap?.awayThresholdMinutes).toBe(10)
  })

  it('loads compact microCompact options from project scope', async () => {
    const home = tmp()
    const cwd = tmp()
    mkdirSync(join(cwd, '.nuka'))
    writeFileSync(
      join(cwd, '.nuka', 'config.yaml'),
      `compact:
  keepTurns: 4
  retainedMessageBudget: 8
  microCompact:
    enabled: true
    keepRecent: 2
`,
    )

    const cfg = await loadConfig({ home, cwd })

    expect(cfg.compact?.microCompact?.enabled).toBe(true)
    expect(cfg.compact?.microCompact?.keepRecent).toBe(2)
    expect(cfg.compact?.retainedMessageBudget).toBe(8)
  })

  it('loads provider retry and idle-timeout options from project scope', async () => {
    const home = tmp()
    const cwd = tmp()
    mkdirSync(join(cwd, '.nuka'))
    writeFileSync(
      join(cwd, '.nuka', 'config.yaml'),
      `provider:
  retry:
    maxAttempts: 2
    initialDelayMs: 50
    maxDelayMs: 500
    backoffFactor: 3
    jitter: false
    idleTimeoutMs: 1000
`,
    )

    const cfg = await loadConfig({ home, cwd })

    expect(cfg.provider?.retry?.maxAttempts).toBe(2)
    expect(cfg.provider?.retry?.idleTimeoutMs).toBe(1000)
    expect(providerRetryOptionsFromConfig(cfg)).toEqual({
      maxAttempts: 2,
      initialDelayMs: 50,
      maxDelayMs: 500,
      backoffFactor: 3,
      jitter: false,
      attemptTimeoutMs: 1000,
    })
  })

  it('every ConfigSchema top-level key is reachable through loadConfig', async () => {
    // Regression guard: loadConfig enumerates fields explicitly. If a new
    // field is added to ConfigSchema but not to loadConfig's merge object,
    // it will be silently dropped from project-scope config.yaml. This walk
    // writes a sentinel value for each schema key to a project-scope YAML
    // and asserts the loaded config exposes a non-undefined value for it.
    //
    // `providers` and `active` are handled with bespoke logic (id-keyed
    // dedup, project-wins-only-if-non-empty). Both are required + defaulted
    // in ConfigSchema, so loadConfig always emits them — the explicit
    // enumeration covers them. Skip them here so the harness doesn't have
    // to invent provider fixtures per key.
    const sentinels: Record<string, string> = {
      version: 'version: 1\n',
      theme: 'theme:\n  name: default-dark\n',
      compact: 'compact:\n  keepTurns: 7\n',
      search: 'search:\n  endpoint: https://example.com/search\n',
      plugins: 'plugins:\n  enabled: ["sentinel"]\n',
      vim: 'vim:\n  enabled: true\n',
      rewind: 'rewind:\n  fileCheckpointing: true\n',
      statusLine: 'statusLine:\n  intervalMs: 1234\n',
      statusBar: 'statusBar:\n  layout: oneline\n',
      harness: 'harness:\n  mode: fast\n',
      recap: 'recap:\n  awayThresholdMinutes: 42\n',
      notices: 'notices:\n  emergency:\n    tip: sentinel\n',
      effort: 'effort: high\n',
      provider: 'provider:\n  retry:\n    maxAttempts: 2\n',
      locked: 'locked: ["providers.x.apiKey"]\n',
      teamId: 'teamId: sentinel-team\n',
    }

    const skip = new Set(['providers', 'active'])
    const schemaKeys = Object.keys(ConfigSchema.shape)
    const yaml = schemaKeys
      .filter(k => !skip.has(k))
      .map(k => sentinels[k] ?? `${k}: {}\n`)
      .join('')

    const home = tmp()
    const cwd = tmp()
    mkdirSync(join(cwd, '.nuka'))
    writeFileSync(join(cwd, '.nuka', 'config.yaml'), yaml)

    const cfg = await loadConfig({ home, cwd }) as Record<string, unknown>
    for (const key of schemaKeys) {
      if (skip.has(key)) continue
      expect(cfg[key], `loadConfig dropped ConfigSchema key '${key}'`).toBeDefined()
    }
  })

  it('project config overrides global', async () => {
    const home = tmp()
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'config.yaml'),
      `providers:
  - id: p1
    name: Global
    format: anthropic
    baseUrl: https://api.anthropic.com
    models: []
active: { providerId: p1 }
`,
    )
    const cwd = tmp()
    mkdirSync(join(cwd, '.nuka'))
    writeFileSync(
      join(cwd, '.nuka', 'config.yaml'),
      `providers:
  - id: p2
    name: Project
    format: openai
    baseUrl: https://api.openai.com/v1
    models: []
active: { providerId: p2 }
`,
    )
    const cfg = await loadConfig({ home, cwd })
    expect(cfg.active.providerId).toBe('p2')
    expect(cfg.providers.map(p => p.name).sort()).toEqual(['Global', 'Project'])
  })

  it('preserves saved placeholder custom provider ids on load', async () => {
    const home = tmp()
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'config.yaml'),
      `providers:
  - id: custom-2
    name: Xiaomi Mimo
    format: openai
    baseUrl: https://token-plan-cn.xiaomimimo.com/v1/completions
    models: [mimo-v2-pro]
    selectedModel: mimo-v2-pro
active: { providerId: custom-2 }
`,
    )

    const cfg = await loadConfig({ home, cwd: tmp() })

    expect(cfg.providers[0]?.id).toBe('custom-2')
    expect(cfg.providers[0]?.name).toBe('Xiaomi Mimo')
    expect(cfg.active.providerId).toBe('custom-2')
  })

  it('preserves multiple saved custom provider ids when names collide', async () => {
    const home = tmp()
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'config.yaml'),
      `providers:
  - id: custom
    name: Gateway
    format: openai
    baseUrl: https://gateway-one.example.test/v1
    models: [m1]
  - id: custom-2
    name: Gateway
    format: openai
    baseUrl: https://gateway-two.example.test/v1
    models: [m2]
active: { providerId: custom-2 }
`,
    )

    const cfg = await loadConfig({ home, cwd: tmp() })

    expect(cfg.providers.map(p => p.id)).toEqual(['custom', 'custom-2'])
    expect(cfg.active.providerId).toBe('custom-2')
  })

})
