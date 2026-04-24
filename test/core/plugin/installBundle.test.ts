/**
 * Tests for the .mcpb/.dxt bundle unpacker.
 *
 * We create minimal ZIP files programmatically using Node built-ins,
 * avoiding any dependency on the `zip`/`unzip` system commands.
 *
 * ZIP local file header format (for STORE compression, method=0):
 *   4 bytes: signature (0x50 0x4B 0x03 0x04)
 *   2 bytes: version needed (0x14 0x00 = 20)
 *   2 bytes: general purpose bit flag (0x00 0x00)
 *   2 bytes: compression method (0x00 0x00 = STORE)
 *   2+2 bytes: mod time/date (zeroed)
 *   4 bytes: CRC-32
 *   4 bytes: compressed size
 *   4 bytes: uncompressed size
 *   2 bytes: filename length
 *   2 bytes: extra field length (0)
 *   N bytes: filename
 *   D bytes: data
 *
 * End of central directory record (required for valid ZIP, some parsers don't need it):
 * We include a minimal one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { installFromBundle } from '../../../src/core/plugin/install/bundle'

let home: string
let fixtureDir: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-bundle-home-'))
  fixtureDir = await mkdtemp(join(os.tmpdir(), 'nuka-bundle-fixture-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(fixtureDir, { recursive: true, force: true })
})

/**
 * Compute a CRC-32 checksum compatible with the ZIP standard.
 */
function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (~crc) >>> 0
}

/**
 * Build a minimal ZIP archive buffer with STORE compression.
 * Each entry is a { filename, content } pair.
 */
function buildZip(entries: Array<{ filename: string; content: string | Buffer }>): Buffer {
  const localHeaders: Buffer[] = []
  const centralDirEntries: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const filenameBytes = Buffer.from(entry.filename, 'utf8')
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    const crc = crc32(data)

    // Local file header
    const header = Buffer.alloc(30 + filenameBytes.length)
    header.writeUInt32LE(0x04034b50, 0)  // signature
    header.writeUInt16LE(20, 4)           // version needed: 2.0
    header.writeUInt16LE(0, 6)            // general purpose bit flag
    header.writeUInt16LE(0, 8)            // compression method: STORE
    header.writeUInt16LE(0, 10)           // mod time
    header.writeUInt16LE(0, 12)           // mod date
    header.writeUInt32LE(crc, 14)         // CRC-32
    header.writeUInt32LE(data.length, 18) // compressed size
    header.writeUInt32LE(data.length, 22) // uncompressed size
    header.writeUInt16LE(filenameBytes.length, 26) // filename length
    header.writeUInt16LE(0, 28)           // extra field length
    filenameBytes.copy(header, 30)

    localHeaders.push(header, data)

    // Central directory entry
    const cdEntry = Buffer.alloc(46 + filenameBytes.length)
    cdEntry.writeUInt32LE(0x02014b50, 0) // central dir signature
    cdEntry.writeUInt16LE(20, 4)          // version made by
    cdEntry.writeUInt16LE(20, 6)          // version needed
    cdEntry.writeUInt16LE(0, 8)           // general purpose bit flag
    cdEntry.writeUInt16LE(0, 10)          // compression method
    cdEntry.writeUInt16LE(0, 12)          // mod time
    cdEntry.writeUInt16LE(0, 14)          // mod date
    cdEntry.writeUInt32LE(crc, 16)        // CRC-32
    cdEntry.writeUInt32LE(data.length, 20) // compressed size
    cdEntry.writeUInt32LE(data.length, 24) // uncompressed size
    cdEntry.writeUInt16LE(filenameBytes.length, 28) // filename length
    cdEntry.writeUInt16LE(0, 30)          // extra field length
    cdEntry.writeUInt16LE(0, 32)          // file comment length
    cdEntry.writeUInt16LE(0, 34)          // disk number start
    cdEntry.writeUInt16LE(0, 36)          // internal attributes
    cdEntry.writeUInt32LE(0, 38)          // external attributes
    cdEntry.writeUInt32LE(localOffset, 42) // relative offset of local header
    filenameBytes.copy(cdEntry, 46)

    centralDirEntries.push(cdEntry)
    localOffset += header.length + data.length
  }

  const localData = Buffer.concat(localHeaders)
  const centralDir = Buffer.concat(centralDirEntries)

  // End of central directory record
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)        // EOCD signature
  eocd.writeUInt16LE(0, 4)                  // disk number
  eocd.writeUInt16LE(0, 6)                  // disk with CD start
  eocd.writeUInt16LE(entries.length, 8)     // total entries on this disk
  eocd.writeUInt16LE(entries.length, 10)    // total entries
  eocd.writeUInt32LE(centralDir.length, 12) // size of CD
  eocd.writeUInt32LE(localOffset, 16)       // offset of CD
  eocd.writeUInt16LE(0, 20)                 // comment length

  return Buffer.concat([localData, centralDir, eocd])
}

/**
 * Write a bundle file and return its path.
 */
async function createBundle(
  dir: string,
  filename: string,
  entries: Array<{ filename: string; content: string | Buffer }>,
): Promise<string> {
  const { writeFile } = await import('node:fs/promises')
  const bundlePath = join(dir, filename)
  const zip = buildZip(entries)
  await writeFile(bundlePath, zip)
  return bundlePath
}

describe('installFromBundle', () => {
  it('unpacks a .mcpb bundle and returns cacheDir, version, sha256', async () => {
    const bundlePath = await createBundle(fixtureDir, 'my-plugin.mcpb', [
      { filename: 'plugin.yaml', content: 'name: my-bundle-plugin\nversion: 1.0.0\n' },
      { filename: 'README.md', content: '# My Plugin\n' },
    ])

    const result = await installFromBundle({ bundlePath, home })

    expect(result.version).toBe('1.0.0')

    // sha256 should match actual file hash
    const bytes = await readFile(bundlePath)
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex')
    expect(result.sha256).toBe(expectedSha256)

    // cacheDir should exist and contain plugin.yaml
    const { stat } = await import('node:fs/promises')
    const s = await stat(join(result.cacheDir, 'plugin.yaml'))
    expect(s.isFile()).toBe(true)

    expect(result.cacheDir).toContain('.nuka/plugins/cache/bundle/')
    expect(result.cacheDir).toContain('1.0.0')
  })

  it('unpacks a .dxt bundle successfully', async () => {
    const bundlePath = await createBundle(fixtureDir, 'dxt-plugin.dxt', [
      { filename: 'plugin.yaml', content: 'name: dxt-plugin\nversion: 2.3.4\n' },
    ])

    const result = await installFromBundle({ bundlePath, home })
    expect(result.version).toBe('2.3.4')
    expect(result.cacheDir).toContain('2.3.4')
  })

  it('sha256 matches the bundle file byte-for-byte', async () => {
    const bundlePath = await createBundle(fixtureDir, 'sha-plugin.mcpb', [
      { filename: 'plugin.yaml', content: 'name: sha-plugin\nversion: 0.5.0\n' },
    ])

    const bytes = await readFile(bundlePath)
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex')

    const result = await installFromBundle({ bundlePath, home })
    expect(result.sha256).toBe(expectedSha256)
  })

  it('is idempotent — installing same bundle twice does not error', async () => {
    const bundlePath = await createBundle(fixtureDir, 'idem-plugin.mcpb', [
      { filename: 'plugin.yaml', content: 'name: idem-plugin\nversion: 1.0.0\n' },
    ])

    const result1 = await installFromBundle({ bundlePath, home })
    const result2 = await installFromBundle({ bundlePath, home })

    expect(result1.cacheDir).toBe(result2.cacheDir)
    expect(result1.sha256).toBe(result2.sha256)
  })

  it('rejects unsupported file extensions with a clear message', async () => {
    const bundlePath = await createBundle(fixtureDir, 'plugin.zip', [
      { filename: 'plugin.yaml', content: 'name: x\n' },
    ])

    await expect(installFromBundle({ bundlePath, home })).rejects.toThrow(
      /Unsupported bundle extension/,
    )
  })

  it('surfaces a clear error when bundle file is missing', async () => {
    await expect(
      installFromBundle({ bundlePath: join(fixtureDir, 'nonexistent.mcpb'), home }),
    ).rejects.toThrow(/Cannot read bundle/)
  })

  it('rejects a bundle without a plugin manifest at root', async () => {
    const bundlePath = await createBundle(fixtureDir, 'no-manifest.mcpb', [
      { filename: 'README.md', content: '# no manifest\n' },
    ])

    await expect(
      installFromBundle({ bundlePath, home }),
    ).rejects.toThrow(/plugin\.yaml or plugin\.json/)
  })

  it('extracts all files including non-manifest files', async () => {
    const bundlePath = await createBundle(fixtureDir, 'full-plugin.mcpb', [
      { filename: 'plugin.yaml', content: 'name: full-plugin\nversion: 1.0.0\n' },
      { filename: 'tools/my-tool.json', content: '{"name":"tool"}\n' },
      { filename: 'README.md', content: '# Full Plugin\n' },
    ])

    const result = await installFromBundle({ bundlePath, home })

    const { stat } = await import('node:fs/promises')
    // Check README.md exists
    expect((await stat(join(result.cacheDir, 'README.md'))).isFile()).toBe(true)
    // Check nested file exists
    expect((await stat(join(result.cacheDir, 'tools', 'my-tool.json'))).isFile()).toBe(true)
  })

  it('uses sha256 prefix as version when manifest has no version field', async () => {
    const bundlePath = await createBundle(fixtureDir, 'no-version.mcpb', [
      { filename: 'plugin.yaml', content: 'name: no-version-plugin\n' },
    ])

    const bytes = await readFile(bundlePath)
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    const result = await installFromBundle({ bundlePath, home })
    expect(result.version).toBe(sha256.slice(0, 8))
  })
})
