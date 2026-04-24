import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { execa } from 'execa'
import { installFromNpm } from '../../../src/core/plugin/install/npm'

let home: string
let fixtureDir: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-npm-home-'))
  fixtureDir = await mkdtemp(join(os.tmpdir(), 'nuka-npm-fixture-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(home, { recursive: true, force: true })
  await rm(fixtureDir, { recursive: true, force: true })
})

/**
 * Create a minimal npm package fixture tarball in the given directory.
 * Returns the path to the created .tgz file.
 */
async function createFixtureTarball(
  dir: string,
  opts: {
    name?: string
    version?: string
    scripts?: Record<string, string>
    includeManifest?: boolean
  } = {},
): Promise<string> {
  const name = opts.name ?? 'test-plugin'
  const version = opts.version ?? '1.0.0'
  const pkgDir = join(dir, 'package')
  await mkdir(pkgDir, { recursive: true })

  const pkg: Record<string, unknown> = {
    name,
    version,
  }
  if (opts.scripts) {
    pkg['scripts'] = opts.scripts
  }
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8')

  if (opts.includeManifest !== false) {
    await writeFile(join(pkgDir, 'plugin.yaml'), `name: ${name}\n`, 'utf8')
  }

  // Create tarball using tar (same tool the installer uses)
  const tarball = join(dir, `${name}-${version}.tgz`)
  await execa('tar', ['czf', tarball, '-C', dir, 'package'])
  return tarball
}

describe('installFromNpm', () => {
  it('installs from a fixture tarball successfully', async () => {
    const tarball = await createFixtureTarball(fixtureDir, {
      name: 'my-plugin',
      version: '1.2.3',
    })

    // Mock execa-based npm pack to return the fixture tarball path
    vi.mock('execa', async (importOriginal) => {
      const original = await importOriginal<typeof import('execa')>()
      return original
    })

    // We cannot easily mock execa inline since it's already imported,
    // so instead we use a wrapper approach: monkey-patch npm pack result
    // by testing the extraction + validation logic through a direct test
    // that bypasses npm pack.

    // Since we need to test the real pipeline, let's test the underlying
    // logic using the raw tar + package directory approach.
    // We create a fake "npm pack" by writing the tarball and mocking the execa call.

    // Re-import with mock
    const { execa: execaMock } = await import('execa')

    // Use the real execa for tar but mock for npm pack
    const workDir = join(home, '.nuka', 'plugins', 'cache', 'npm', '_work')
    await mkdir(workDir, { recursive: true })

    // Copy our tarball to workDir so the installer can find it
    const tarName = `my-plugin-1.2.3.tgz`
    const destTarball = join(workDir, tarName)
    await execa('cp', [tarball, destTarball])

    // We'll test the full flow by mocking only the npm pack call via vi.spyOn
    // Import the module fresh so we can spy on the execa import
    // Since spying on execa in ESM is tricky, we test via integration:
    // call the function with a real local npm package if possible.

    // Simpler approach: directly verify that tar extraction works for a valid package.
    // We'll create a test that mocks the npm pack step via __mocks__.
    // For now, test through the full installFromNpm by creating a local npm package.

    // Create a proper npm package for local pack
    const pkgDir = join(fixtureDir, 'local-pkg')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'local-test-plugin', version: '0.1.0' }),
      'utf8',
    )
    await writeFile(join(pkgDir, 'plugin.yaml'), 'name: local-test-plugin\n', 'utf8')

    const result = await installFromNpm({
      pkg: pkgDir,  // local path — npm pack accepts local paths
      home,
    })

    expect(result.version).toBe('0.1.0')
    expect(result.cacheDir).toContain('.nuka/plugins/cache/npm/')
    expect(result.cacheDir).toContain('0.1.0')

    // plugin.yaml should be present in cache
    const { stat } = await import('node:fs/promises')
    const s = await stat(join(result.cacheDir, 'plugin.yaml'))
    expect(s.isFile()).toBe(true)
  })

  it('rejects packages with lifecycle scripts', async () => {
    const pkgDir = join(fixtureDir, 'evil-pkg')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'evil-plugin',
        version: '0.0.1',
        scripts: { preinstall: 'echo evil' },
      }),
      'utf8',
    )
    await writeFile(join(pkgDir, 'plugin.yaml'), 'name: evil-plugin\n', 'utf8')

    await expect(
      installFromNpm({ pkg: pkgDir, home }),
    ).rejects.toThrow(/lifecycle scripts/)
  })

  it('rejects packages with install scripts', async () => {
    const pkgDir = join(fixtureDir, 'install-pkg')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'install-plugin',
        version: '0.0.1',
        scripts: { install: 'node ./setup.js', postinstall: 'echo post' },
      }),
      'utf8',
    )
    await writeFile(join(pkgDir, 'plugin.yaml'), 'name: install-plugin\n', 'utf8')

    await expect(
      installFromNpm({ pkg: pkgDir, home }),
    ).rejects.toThrow(/lifecycle scripts.*install.*postinstall/)
  })

  it('rejects packages without a plugin manifest', async () => {
    const pkgDir = join(fixtureDir, 'no-manifest-pkg')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'no-manifest', version: '1.0.0' }),
      'utf8',
    )
    // No plugin.yaml or plugin.json

    await expect(
      installFromNpm({ pkg: pkgDir, home }),
    ).rejects.toThrow(/plugin\.yaml or plugin\.json/)
  })

  it('is idempotent — installing same version twice does not error', async () => {
    const pkgDir = join(fixtureDir, 'idem-pkg')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'idem-plugin', version: '2.0.0' }),
      'utf8',
    )
    await writeFile(join(pkgDir, 'plugin.yaml'), 'name: idem-plugin\n', 'utf8')

    const result1 = await installFromNpm({ pkg: pkgDir, home })
    const result2 = await installFromNpm({ pkg: pkgDir, home })

    expect(result1.cacheDir).toBe(result2.cacheDir)
    expect(result1.version).toBe(result2.version)
  })
})
