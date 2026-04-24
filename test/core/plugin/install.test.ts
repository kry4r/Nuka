import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { readManifestFrom, installPluginFromPath } from '../../../src/core/plugin/install'

let sourceDir: string
let home: string

beforeEach(async () => {
  sourceDir = await mkdtemp(join(os.tmpdir(), 'nuka-install-src-'))
  home = await mkdtemp(join(os.tmpdir(), 'nuka-install-home-'))
})

afterEach(async () => {
  await rm(sourceDir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

async function writeManifest(dir: string, content: string, filename = 'plugin.yaml'): Promise<void> {
  await writeFile(join(dir, filename), content, 'utf8')
}

describe('readManifestFrom', () => {
  it('throws when no manifest file found', async () => {
    await expect(readManifestFrom(sourceDir)).rejects.toThrow('no plugin.yaml or plugin.json')
  })

  it('reads plugin.yaml successfully', async () => {
    await writeManifest(sourceDir, 'name: my-plugin\n')
    const manifest = await readManifestFrom(sourceDir)
    expect(manifest.name).toBe('my-plugin')
  })

  it('falls back to plugin.json', async () => {
    await writeManifest(sourceDir, JSON.stringify({ name: 'json-plugin' }), 'plugin.json')
    const manifest = await readManifestFrom(sourceDir)
    expect(manifest.name).toBe('json-plugin')
  })

  it('throws on invalid manifest (bad name)', async () => {
    await writeManifest(sourceDir, 'name: "Bad Name"\n')
    await expect(readManifestFrom(sourceDir)).rejects.toThrow()
  })
})

describe('installPluginFromPath', () => {
  it('installs successfully when confirmed', async () => {
    await writeManifest(
      sourceDir,
      [
        'name: my-plugin',
        'tools: [tool1.js, tool2.js]',
        'slashCommands: [cmd.js]',
        'skills: [skill.md]',
        'mcpServers:',
        '  srv: { type: stdio, command: node }',
      ].join('\n'),
    )

    const result = await installPluginFromPath({
      source: sourceDir,
      home,
      confirm: async () => true,
    })

    expect(result.name).toBe('my-plugin')
    expect(result.targetDir).toBe(join(home, '.nuka', 'plugins', 'my-plugin'))
    expect(result.toolsCount).toBe(2)
    expect(result.slashCount).toBe(1)
    expect(result.skillsCount).toBe(1)
    expect(result.mcpCount).toBe(1)

    // Verify the target directory was actually created with the manifest
    const targetStat = await stat(result.targetDir)
    expect(targetStat.isDirectory()).toBe(true)
  })

  it('throws "install cancelled" when user declines', async () => {
    await writeManifest(sourceDir, 'name: my-plugin\n')

    await expect(
      installPluginFromPath({
        source: sourceDir,
        home,
        confirm: async () => false,
      }),
    ).rejects.toThrow('install cancelled')
  })

  it('throws "already installed" when target exists and force is false', async () => {
    await writeManifest(sourceDir, 'name: my-plugin\n')

    // Pre-create target
    const targetDir = join(home, '.nuka', 'plugins', 'my-plugin')
    await mkdir(targetDir, { recursive: true })
    await writeManifest(targetDir, 'name: my-plugin\nversion: "0.1"\n')

    await expect(
      installPluginFromPath({
        source: sourceDir,
        home,
        force: false,
        confirm: async () => true,
      }),
    ).rejects.toThrow("already installed")
  })

  it('overwrites when target exists and force is true', async () => {
    await writeManifest(sourceDir, 'name: my-plugin\ntools: [a.js, b.js]\n')

    // Pre-create target with different manifest
    const targetDir = join(home, '.nuka', 'plugins', 'my-plugin')
    await mkdir(targetDir, { recursive: true })
    await writeManifest(targetDir, 'name: my-plugin\n')

    const result = await installPluginFromPath({
      source: sourceDir,
      home,
      force: true,
      confirm: async () => true,
    })

    expect(result.name).toBe('my-plugin')
    expect(result.toolsCount).toBe(2)
  })

  it('throws when source has no manifest', async () => {
    await expect(
      installPluginFromPath({
        source: sourceDir,
        home,
        confirm: async () => true,
      }),
    ).rejects.toThrow('no plugin.yaml or plugin.json')
  })

  it('throws on manifest with invalid name', async () => {
    await writeManifest(sourceDir, 'name: "Bad Name"\n')

    await expect(
      installPluginFromPath({
        source: sourceDir,
        home,
        confirm: async () => true,
      }),
    ).rejects.toThrow()
  })
})
