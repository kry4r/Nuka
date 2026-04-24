/**
 * Persistence helpers for large MCP tool outputs.
 *
 * When a tool returns more text than the configured threshold, the full
 * pre-truncation output is written to disk so callers can inspect it later.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

/**
 * Write the full tool output text to `~/.nuka/tmp/mcp-out-<id>.txt`.
 *
 * @param opts.home    Override the home directory (defaults to `os.homedir()`).
 * @param opts.fullText The complete, un-truncated tool output.
 * @returns The absolute path of the file written.
 */
export async function persistLargeOutput(opts: {
  home?: string
  fullText: string
}): Promise<{ path: string }> {
  const base = opts.home ?? os.homedir()
  const dir = path.join(base, '.nuka', 'tmp')
  fs.mkdirSync(dir, { recursive: true })

  const id = `${Date.now()}${crypto.randomBytes(4).toString('hex')}`
  const filePath = path.join(dir, `mcp-out-${id}.txt`)

  await fs.promises.writeFile(filePath, opts.fullText, 'utf8')
  return { path: filePath }
}
