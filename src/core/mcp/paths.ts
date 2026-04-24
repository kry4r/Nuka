// src/core/mcp/paths.ts
// Filesystem paths for MCP runtime artefacts.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Returns the directory used for storing MCP temporary files
 * (e.g. decoded image blobs).  Creates the directory on first call.
 *
 * Default: `~/.nuka/tmp`
 */
export function mcpTmpDir(home?: string): string {
  const base = home ?? os.homedir()
  const dir = path.join(base, '.nuka', 'tmp')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Map a MIME type to a file extension for image blobs. */
export function mimeToExt(mimeType: string): string {
  switch (mimeType) {
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/gif': return '.gif'
    case 'image/webp': return '.webp'
    default: return '.bin'
  }
}
