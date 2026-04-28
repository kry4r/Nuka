import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { loadConfig } from '../../../src/core/config/load'

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

})
