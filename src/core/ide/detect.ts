/**
 * src/core/ide/detect.ts — Phase 8 §4.5
 *
 * Probes the local environment for running IDEs. All probes are best-effort:
 * errors are caught and contribute an empty result rather than propagating.
 *
 * Returns: Array<{ family, version?, port? }>
 *   family: 'vscode' | 'jetbrains' | 'cursor' | 'windsurf'
 *   port:   advertised IDE-bridge port for the family (informational only —
 *           the connect path was removed in Phase 11 M3).
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type IdeFamily = 'vscode' | 'jetbrains' | 'cursor' | 'windsurf'

export type DetectedIde = {
  family: IdeFamily
  version?: string
  port?: number
}

/** Default IDE-bridge ports per IDE family (informational — see file header). */
export const IDE_PORTS: Record<IdeFamily, number> = {
  vscode: 4096,
  cursor: 4097,
  windsurf: 4098,
  jetbrains: 4099,
}

/**
 * Run a command and return its exit code. Resolves with the exit code (0 = ok)
 * or rejects on spawn error. Never throws — callers wrap in try/catch.
 */
function spawnExitCode(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

/**
 * Check whether a command exists on PATH via `which <cmd>`.
 * Resolves true/false, never throws.
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const code = await spawnExitCode('which', [cmd])
    return code === 0
  } catch {
    return false
  }
}

/** Probe for VS Code: `which code` AND `code --status` exits 0. */
async function probeVSCode(): Promise<DetectedIde[]> {
  try {
    const has = await commandExists('code')
    if (!has) return []
    const code = await spawnExitCode('code', ['--status'])
    if (code !== 0) return []
    return [{ family: 'vscode', port: IDE_PORTS.vscode }]
  } catch {
    return []
  }
}

/** Probe for JetBrains: scan known lockfile dirs for *.lock files. */
async function probeJetBrains(): Promise<DetectedIde[]> {
  const home = os.homedir()
  const dirs = [
    path.join(home, '.config', 'JetBrains'),
    path.join(home, 'Library', 'Application Support', 'JetBrains'),
  ]
  for (const dir of dirs) {
    try {
      const entries = await fs.promises.readdir(dir)
      const hasLock = entries.some((e) => e.endsWith('.lock'))
      if (hasLock) {
        return [{ family: 'jetbrains', port: IDE_PORTS.jetbrains }]
      }
    } catch {
      // Dir doesn't exist or isn't readable — skip.
    }
  }
  return []
}

/** Probe for Cursor: `which cursor` exits 0. */
async function probeCursor(): Promise<DetectedIde[]> {
  try {
    const exists = await commandExists('cursor')
    if (!exists) return []
    return [{ family: 'cursor', port: IDE_PORTS.cursor }]
  } catch {
    return []
  }
}

/** Probe for Windsurf: `which windsurf` exits 0. */
async function probeWindsurf(): Promise<DetectedIde[]> {
  try {
    const exists = await commandExists('windsurf')
    if (!exists) return []
    return [{ family: 'windsurf', port: IDE_PORTS.windsurf }]
  } catch {
    return []
  }
}

/**
 * Run all IDE probes concurrently and return the combined list.
 * Never throws — individual probe failures yield empty results.
 */
export async function detectIdes(): Promise<DetectedIde[]> {
  const results = await Promise.all([
    probeVSCode(),
    probeJetBrains(),
    probeCursor(),
    probeWindsurf(),
  ])
  return results.flat()
}
