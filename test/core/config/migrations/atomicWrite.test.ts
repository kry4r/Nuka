import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { parse as parseYaml } from 'yaml'
import { atomicWriteYaml } from '../../../../src/core/config/migrations/atomicWrite'

function tmpDir(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-atomic-'))
}

describe('atomicWriteYaml', () => {
  it('writes YAML to the target path', async () => {
    const dir = tmpDir()
    const file = join(dir, 'config.yaml')
    await atomicWriteYaml(file, { version: 2, providers: [] })
    expect(existsSync(file)).toBe(true)
    const text = readFileSync(file, 'utf8')
    expect(parseYaml(text)).toEqual({ version: 2, providers: [] })
  })

  it('does not leave a .tmp sibling after success', async () => {
    const dir = tmpDir()
    const file = join(dir, 'config.yaml')
    await atomicWriteYaml(file, { version: 2 })
    expect(existsSync(file + '.tmp')).toBe(false)
  })

  it('preserves the file when an existing target is overwritten', async () => {
    const dir = tmpDir()
    const file = join(dir, 'config.yaml')
    writeFileSync(file, 'version: 1\n', { encoding: 'utf8' })
    await atomicWriteYaml(file, { version: 2 })
    const text = readFileSync(file, 'utf8')
    expect(parseYaml(text)).toEqual({ version: 2 })
  })

  it('writes with mode 0o600 (owner read/write only)', async () => {
    const dir = tmpDir()
    const file = join(dir, 'config.yaml')
    await atomicWriteYaml(file, { version: 2 })
    const mode = statSync(file).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('rejects with the underlying error if the parent directory is missing', async () => {
    const file = join(tmpDir(), 'no-such-subdir', 'config.yaml')
    await expect(atomicWriteYaml(file, { version: 2 })).rejects.toThrow()
  })
})
