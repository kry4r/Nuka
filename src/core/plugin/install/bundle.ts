import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, extname, basename, dirname } from 'node:path'
import { inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'

const inflateRawAsync = promisify(inflateRaw)

/**
 * Minimal ZIP file parser using Node built-ins.
 *
 * ZIP container format uses local file headers with DEFLATE compression (method=8)
 * or STORE (method=0). We parse each local file header, decompress the data using
 * node:zlib's inflateRaw (for deflate) or slice directly (for store), and yield
 * the entries.
 *
 * Node's zlib handles gzip/deflate but NOT the ZIP container format — we parse
 * the ZIP binary framing here, then delegate decompression to zlib.
 */

interface ZipEntry {
  filename: string
  data: Buffer
}

const LOCAL_FILE_SIG = 0x04034b50

function readUInt16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset)
}

function readUInt32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset)
}

async function parseZip(buf: Buffer): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = []
  let offset = 0

  while (offset + 30 <= buf.length) {
    const sig = readUInt32LE(buf, offset)

    if (sig !== LOCAL_FILE_SIG) {
      // Not a local file header — could be central directory or end
      break
    }

    const compressionMethod = readUInt16LE(buf, offset + 8)
    const compressedSize = readUInt32LE(buf, offset + 18)
    const uncompressedSize = readUInt32LE(buf, offset + 22)
    const filenameLength = readUInt16LE(buf, offset + 26)
    const extraLength = readUInt16LE(buf, offset + 28)

    const filenameStart = offset + 30
    const filename = buf.slice(filenameStart, filenameStart + filenameLength).toString('utf8')

    const dataStart = filenameStart + filenameLength + extraLength
    const compressedData = buf.slice(dataStart, dataStart + compressedSize)

    // Skip directory entries
    if (!filename.endsWith('/')) {
      let data: Buffer
      if (compressionMethod === 0) {
        // STORE — no compression
        data = compressedData
      } else if (compressionMethod === 8) {
        // DEFLATE — use inflateRaw
        data = await inflateRawAsync(compressedData)
      } else {
        throw new Error(
          `Unsupported ZIP compression method ${compressionMethod} for entry: ${filename}`,
        )
      }

      if (data.length !== uncompressedSize) {
        throw new Error(
          `Decompressed size mismatch for ${filename}: expected ${uncompressedSize}, got ${data.length}`,
        )
      }

      entries.push({ filename, data })
    }

    offset = dataStart + compressedSize
  }

  return entries
}

/**
 * Install a plugin from a .mcpb or .dxt bundle file.
 *
 * Both formats are ZIP archives. Node's built-in zlib only handles gzip/deflate
 * compression, not the ZIP container format. We parse the ZIP container manually
 * and use zlib.inflateRaw for DEFLATE-compressed entries. No new npm dependencies.
 *
 * If the ZIP uses an unsupported compression method, a clear error is thrown.
 *
 * Returns the cache directory, the version string from the manifest, and the
 * SHA-256 hash of the bundle file.
 */
export async function installFromBundle(opts: {
  bundlePath: string
  home: string
}): Promise<{ cacheDir: string; version: string; sha256: string }> {
  const ext = extname(opts.bundlePath).toLowerCase()
  if (ext !== '.mcpb' && ext !== '.dxt') {
    throw new Error(
      `Unsupported bundle extension: ${ext}. Expected .mcpb or .dxt`,
    )
  }

  // Read the bundle file
  let bundleBytes: Buffer
  try {
    bundleBytes = await readFile(opts.bundlePath)
  } catch (err) {
    throw new Error(
      `Cannot read bundle file ${opts.bundlePath}: ${(err as Error).message}`,
    )
  }

  // Compute SHA-256
  const sha256 = createHash('sha256').update(bundleBytes).digest('hex')

  // Parse the ZIP archive
  let entries: ZipEntry[]
  try {
    entries = await parseZip(bundleBytes)
  } catch (err) {
    throw new Error(
      `Failed to parse bundle ${basename(opts.bundlePath)}: ${(err as Error).message}`,
    )
  }

  if (entries.length === 0) {
    throw new Error(
      `Bundle ${basename(opts.bundlePath)} appears to be empty or uses an unsupported format`,
    )
  }

  // Locate plugin manifest (plugin.yaml or plugin.json at root of archive)
  // "Root" means no path prefix (just filename, no directory separators)
  function isRootEntry(filename: string): boolean {
    return !filename.includes('/')
  }

  const manifestEntry = entries.find(e =>
    isRootEntry(e.filename) &&
    (e.filename === 'plugin.yaml' || e.filename === 'plugin.json'),
  )

  if (manifestEntry === undefined) {
    throw new Error(
      `Bundle ${basename(opts.bundlePath)} does not contain a plugin.yaml or plugin.json at its root`,
    )
  }

  // Parse manifest
  let pluginName: string
  let version: string
  try {
    const { parse: parseYaml } = await import('yaml')
    const raw = manifestEntry.data.toString('utf8')
    const data = parseYaml(raw) as Record<string, unknown>
    if (typeof data['name'] !== 'string' || !data['name']) {
      throw new Error('manifest missing required field: name')
    }
    pluginName = data['name']
    version = typeof data['version'] === 'string' && data['version']
      ? data['version']
      : sha256.slice(0, 8)
  } catch (err) {
    throw new Error(
      `Failed to parse manifest in bundle ${basename(opts.bundlePath)}: ${(err as Error).message}`,
    )
  }

  // Compute versioned cache dir
  const safeName = pluginName.replace(/[^a-z0-9-]/gi, '_').toLowerCase()
  const bundleCacheDir = join(opts.home, '.nuka', 'plugins', 'cache', 'bundle', safeName, version)

  // Idempotent: return if already cached
  try {
    await import('node:fs/promises').then(fs => fs.stat(bundleCacheDir))
    return { cacheDir: bundleCacheDir, version, sha256 }
  } catch {
    // Does not exist — proceed
  }

  // Extract entries to a staging directory then rename atomically
  const stagingDir = join(
    opts.home,
    '.nuka',
    'plugins',
    'cache',
    'bundle',
    '_staging',
    sha256.slice(0, 16),
  )
  await mkdir(stagingDir, { recursive: true })

  for (const entry of entries) {
    // Sanitize filename — prevent path traversal
    const safePath = entry.filename
      .split('/')
      .filter(part => part !== '..' && part !== '' && part !== '.')
      .join('/')

    if (!safePath) continue

    const destPath = join(stagingDir, safePath)
    await mkdir(dirname(destPath), { recursive: true })
    await writeFile(destPath, entry.data)
  }

  // Move staging to versioned cache
  await mkdir(join(opts.home, '.nuka', 'plugins', 'cache', 'bundle', safeName), {
    recursive: true,
  })
  await rename(stagingDir, bundleCacheDir)

  return { cacheDir: bundleCacheDir, version, sha256 }
}
