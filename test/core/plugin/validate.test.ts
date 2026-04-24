import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { validatePlugin, formatReport } from '../../../src/core/plugin/validate'

let pluginDir: string

beforeEach(async () => {
  pluginDir = await mkdtemp(join(os.tmpdir(), 'nuka-validate-'))
})

afterEach(async () => {
  await rm(pluginDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeManifest(content: string, filename = 'plugin.yaml'): Promise<void> {
  await writeFile(join(pluginDir, filename), content, 'utf8')
}

async function writeManifestJson(content: object): Promise<void> {
  await writeFile(join(pluginDir, 'plugin.json'), JSON.stringify(content), 'utf8')
}

async function createFile(relPath: string): Promise<void> {
  const abs = join(pluginDir, relPath)
  await mkdir(join(pluginDir, relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '.'), { recursive: true })
  await writeFile(abs, '// stub', 'utf8')
}

// ---------------------------------------------------------------------------
// No manifest
// ---------------------------------------------------------------------------

describe('validatePlugin — missing manifest', () => {
  it('reports error when no manifest found', async () => {
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]!.message).toMatch(/plugin\.yaml|plugin\.json/)
  })

  it('returns early with no further checks', async () => {
    const report = await validatePlugin(pluginDir)
    expect(report.warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Valid plugin (spec acceptance 1)
// ---------------------------------------------------------------------------

describe('validatePlugin — valid plugin', () => {
  it('returns empty errors and warnings for a minimal valid plugin (no tools/slash/skills)', async () => {
    await writeManifest('name: my-plugin\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(0)
    expect(report.warnings).toHaveLength(0)
  })

  it('accepts plugin.json format', async () => {
    await writeManifestJson({ name: 'json-plugin' })
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(0)
    expect(report.warnings).toHaveLength(0)
  })

  it('valid plugin with all present files passes', async () => {
    await createFile('tool.js')
    await createFile('cmd.js')
    await createFile('guide.md')
    await writeManifest(
      [
        'name: full-plugin',
        'tools: [tool.js]',
        'slashCommands: [cmd.js]',
        'skills: [guide.md]',
      ].join('\n'),
    )
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(0)
    expect(report.warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('validatePlugin — schema errors', () => {
  it('errors on invalid name (uppercase)', async () => {
    await writeManifest('name: "BadName"\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors.length).toBeGreaterThan(0)
    expect(report.errors.some(e => e.message.toLowerCase().includes('kebab') || e.path.includes('name'))).toBe(true)
  })

  it('errors on invalid YAML', async () => {
    await writeFile(join(pluginDir, 'plugin.yaml'), '{ invalid yaml: [}', 'utf8')
    const report = await validatePlugin(pluginDir)
    expect(report.errors.length).toBeGreaterThan(0)
    expect(report.errors[0]!.message).toMatch(/parse/i)
  })
})

// ---------------------------------------------------------------------------
// tools[] path check (spec acceptance 2)
// ---------------------------------------------------------------------------

describe('validatePlugin — tools path check', () => {
  it('errors when tool import path does not exist (spec acceptance 2)', async () => {
    await writeManifest('name: my-plugin\ntools: [missing-tool.js]\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]!.message).toMatch(/missing-tool\.js/)
    expect(report.errors[0]!.path).toMatch(/tools/)
  })

  it('no error when tool file exists', async () => {
    await createFile('real-tool.js')
    await writeManifest('name: my-plugin\ntools: [real-tool.js]\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(0)
  })

  it('reports each missing tool separately', async () => {
    await writeManifest('name: my-plugin\ntools: [a.js, b.js, c.js]\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// slashCommands[] path check
// ---------------------------------------------------------------------------

describe('validatePlugin — slashCommands path check', () => {
  it('errors when slash command path does not exist', async () => {
    await writeManifest('name: my-plugin\nslashCommands: [no-such-cmd.js]\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors.some(e => e.message.includes('no-such-cmd.js'))).toBe(true)
  })

  it('no error when slash command file exists', async () => {
    await createFile('slash.js')
    await writeManifest('name: my-plugin\nslashCommands: [slash.js]\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// skills[] path check
// ---------------------------------------------------------------------------

describe('validatePlugin — skills path check', () => {
  it('errors when skill markdown does not exist', async () => {
    await writeManifest('name: my-plugin\nskills: [guide.md]\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors.some(e => e.message.includes('guide.md'))).toBe(true)
  })

  it('no error when skill file exists', async () => {
    await createFile('guide.md')
    await writeManifest('name: my-plugin\nskills: [guide.md]\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// dependencies[] warning
// ---------------------------------------------------------------------------

describe('validatePlugin — dependencies warning', () => {
  it('warns (not errors) for unresolvable dependency', async () => {
    await writeManifest(
      'name: my-plugin\ndependencies:\n  - name: totally-nonexistent-package-xyz-123\n',
    )
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(0)
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]!.message).toMatch(/totally-nonexistent-package-xyz-123/)
  })

  it('no warning when dependency resolves', async () => {
    await writeManifest('name: my-plugin\ndependencies:\n  - name: path\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors).toHaveLength(0)
    expect(report.warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// M5-compat: unknown fields passthrough
// ---------------------------------------------------------------------------

describe('validatePlugin — M5 unknown fields passthrough', () => {
  it('does not error on agents[] field (M5-agents)', async () => {
    await writeManifest(
      [
        'name: my-plugin',
        'agents:',
        '  - name: my-agent',
        '    path: agent.js',
      ].join('\n'),
    )
    const report = await validatePlugin(pluginDir)
    // No error for unknown 'agents' key
    expect(report.errors.every(e => !e.message.toLowerCase().includes('agents'))).toBe(true)
  })

  it('does not error on outputStyles[] field (M5-platform)', async () => {
    await writeManifest('name: my-plugin\noutputStyles: [{componentPath: comp.tsx}]\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors.every(e => !e.message.toLowerCase().includes('outputstyles'))).toBe(true)
  })

  it('does not error on channels[] field (M5-platform)', async () => {
    await writeManifest('name: my-plugin\nchannels: [{name: slack}]\n')
    const report = await validatePlugin(pluginDir)
    expect(report.errors.every(e => !e.message.toLowerCase().includes('channels'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe('formatReport', () => {
  it('shows success message for empty report', () => {
    const text = formatReport({ errors: [], warnings: [] }, '/my/plugin')
    expect(text).toMatch(/valid/)
  })

  it('shows errors section when there are errors', () => {
    const text = formatReport(
      { errors: [{ path: 'plugin.yaml#tools', message: 'missing tool.js' }], warnings: [] },
      '/my/plugin',
    )
    expect(text).toMatch(/error/i)
    expect(text).toMatch(/missing tool\.js/)
  })

  it('shows warnings section when there are warnings', () => {
    const text = formatReport(
      { errors: [], warnings: [{ path: 'plugin.yaml#deps', message: 'dep not found' }] },
      '/my/plugin',
    )
    expect(text).toMatch(/warn/i)
    expect(text).toMatch(/dep not found/)
  })
})
