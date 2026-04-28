import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, stat, readlink, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { linkBins, unlinkBins } from '../../../src/core/plugin/install'
import type { PluginManifest } from '../../../src/core/plugin/manifest'

let pluginRoot: string
let home: string

beforeEach(async () => {
  pluginRoot = await mkdtemp(join(os.tmpdir(), 'nuka-binlink-plugin-'))
  home = await mkdtemp(join(os.tmpdir(), 'nuka-binlink-home-'))
})

afterEach(async () => {
  await rm(pluginRoot, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

/** Minimal manifest with bin entry */
function makeManifest(bin: Record<string, string>): PluginManifest {
  return {
    name: 'fixture-plugin',
    version: '0.1.0',
    tools: [],
    slashCommands: [],
    skills: [],
    bin,
  }
}

async function writeBinScript(relPath: string): Promise<string> {
  const abs = join(pluginRoot, relPath)
  await mkdir(join(pluginRoot, 'bin'), { recursive: true })
  await writeFile(abs, '#!/usr/bin/env node\nconsole.log("hello")\n', 'utf8')
  return abs
}

describe('linkBins / unlinkBins', () => {
  it('no-ops when bin is empty', async () => {
    const manifest = makeManifest({})
    // Should not throw
    await linkBins(manifest, pluginRoot, home)
    // ~/.nuka/bin should not be created (or at worst is empty)
    const binDir = join(home, '.nuka', 'bin')
    try {
      const s = await stat(binDir)
      // if it exists it should be empty
      expect(s.isDirectory()).toBe(true)
    } catch {
      // doesn't exist — also fine
    }
  })

  it('no-ops when bin is undefined', async () => {
    const manifest: PluginManifest = {
      name: 'fixture-plugin',
      tools: [],
      slashCommands: [],
      skills: [],
    }
    await linkBins(manifest, pluginRoot, home)
    // Should succeed without error
  })

  if (process.platform !== 'win32') {
    it('creates a symlink in ~/.nuka/bin/ pointing at the plugin script (POSIX)', async () => {
      const absScript = await writeBinScript('bin/run.js')
      const manifest = makeManifest({ 'fixture-bin': './bin/run.js' })

      await linkBins(manifest, pluginRoot, home)

      const linkPath = join(home, '.nuka', 'bin', 'fixture-bin')
      const linkStat = await lstat(linkPath)
      expect(linkStat.isSymbolicLink()).toBe(true)

      const target = await readlink(linkPath)
      expect(target).toBe(absScript)
    })

    it('replaces an existing symlink when called again (replace-on-conflict)', async () => {
      await writeBinScript('bin/run.js')
      const manifest = makeManifest({ 'fixture-bin': './bin/run.js' })

      // First install
      await linkBins(manifest, pluginRoot, home)
      // Second install — should not throw
      await linkBins(manifest, pluginRoot, home)

      const linkPath = join(home, '.nuka', 'bin', 'fixture-bin')
      const linkStat = await lstat(linkPath)
      expect(linkStat.isSymbolicLink()).toBe(true)
    })

    it('removes the symlink on unlinkBins', async () => {
      await writeBinScript('bin/run.js')
      const manifest = makeManifest({ 'fixture-bin': './bin/run.js' })

      await linkBins(manifest, pluginRoot, home)

      const linkPath = join(home, '.nuka', 'bin', 'fixture-bin')
      // Confirm it exists
      await lstat(linkPath)

      await unlinkBins(manifest, home)

      await expect(lstat(linkPath)).rejects.toThrow()
    })

    it('unlinkBins does not throw if symlink was already removed', async () => {
      const manifest = makeManifest({ 'fixture-bin': './bin/run.js' })
      // Never linked — should not throw
      await unlinkBins(manifest, home)
    })
  } else {
    it('creates a .cmd shim on Windows', async () => {
      await writeBinScript('bin/run.js')
      const manifest = makeManifest({ 'fixture-bin': './bin/run.js' })

      await linkBins(manifest, pluginRoot, home)

      const shimPath = join(home, '.nuka', 'bin', 'fixture-bin.cmd')
      const s = await stat(shimPath)
      expect(s.isFile()).toBe(true)
    })

    it('removes the .cmd shim on unlinkBins (Windows)', async () => {
      await writeBinScript('bin/run.js')
      const manifest = makeManifest({ 'fixture-bin': './bin/run.js' })

      await linkBins(manifest, pluginRoot, home)

      const shimPath = join(home, '.nuka', 'bin', 'fixture-bin.cmd')
      await stat(shimPath) // confirm exists

      await unlinkBins(manifest, home)

      await expect(stat(shimPath)).rejects.toThrow()
    })
  }
})
