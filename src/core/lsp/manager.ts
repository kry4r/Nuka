// src/core/lsp/manager.ts
// LspManager — routes files to LSP clients, lazy-spawning on first use.
import { extname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LspClient } from './client'
import { DocumentTracker } from './documentTracker'
import type { LspServerDef } from './types'
import type { spawn } from 'node:child_process'

// Extension → LSP language ID mapping
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
}

function inferLanguageId(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return EXT_TO_LANG[ext] ?? ext.slice(1) // fallback to extension without dot
}

/**
 * Minimal glob matching: supports * as wildcard matching any sequence of non-separator chars,
 * and ** matching across separators. For simplicity we support only * (not **).
 */
function globMatches(pattern: string, filePath: string): boolean {
  // Check basename match first (e.g. "*.ts" matches "/path/to/foo.ts")
  const base = basename(filePath)
  if (matchGlob(pattern, base)) return true
  // Also try full path match
  if (matchGlob(pattern, filePath)) return true
  return false
}

function matchGlob(pattern: string, str: string): boolean {
  // Convert glob to regex: * → [^/]*, ** → .*
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except *
    .replace(/\*\*/g, '\u0000STAR\u0000') // placeholder for **
    .replace(/\*/g, '[^/]*') // * → match within segment
    .replace(/\u0000STAR\u0000/g, '.*') // ** → match across segments
  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(str)
}

function selectorMatches(
  selector: LspServerDef['documentSelector'][number],
  filePath: string,
): boolean {
  if (selector.language !== undefined) {
    if (inferLanguageId(filePath) === selector.language) return true
  }
  if (selector.pattern !== undefined) {
    if (globMatches(selector.pattern, filePath)) return true
  }
  return false
}

function defMatchesFile(def: LspServerDef, filePath: string): boolean {
  return def.documentSelector.some(s => selectorMatches(s, filePath))
}

type SpawnFn = typeof spawn

export class LspManager {
  private readonly _spawnFn: SpawnFn | undefined
  private _defs: LspServerDef[] = []
  private _clients: Map<string, LspClient> = new Map() // def.name → client
  private _trackers: Map<LspClient, DocumentTracker> = new Map()

  constructor(opts?: {
    /** @internal for testing only */
    _spawnFn?: SpawnFn
  }) {
    this._spawnFn = opts?._spawnFn
  }

  /**
   * Register an LSP server definition.
   * Collision policy: first registration for a given selector wins.
   * Returns {ok: false} with reason if skipped.
   */
  register(def: LspServerDef): { ok: true } | { ok: false; reason: string } {
    // Check if any existing def already covers the same selector
    for (const existing of this._defs) {
      for (const newSel of def.documentSelector) {
        for (const existSel of existing.documentSelector) {
          const sameLang = newSel.language !== undefined && newSel.language === existSel.language
          const samePat = newSel.pattern !== undefined && newSel.pattern === existSel.pattern
          if (sameLang || samePat) {
            return {
              ok: false,
              reason: `already registered for selector (${sameLang ? `language:'${newSel.language}'` : `pattern:'${newSel.pattern}'`}) by '${existing.name}'`,
            }
          }
        }
      }
    }
    this._defs.push(def)
    return { ok: true }
  }

  /**
   * Returns all registered server definitions.
   */
  list(): LspServerDef[] {
    return [...this._defs]
  }

  /**
   * Returns the client for a given file path, lazy-spawning if needed.
   * Returns null if no registered server matches the file.
   */
  async clientFor(filePath: string): Promise<LspClient | null> {
    const def = this._defs.find(d => defMatchesFile(d, filePath))
    if (!def) return null

    const existing = this._clients.get(def.name)
    if (existing) return existing

    // Lazy spawn
    const client = new LspClient({
      def,
      rootUri: pathToFileURL(process.cwd()).href,
      ...(this._spawnFn ? { _spawnFn: this._spawnFn } : {}),
    })
    this._clients.set(def.name, client)
    this._trackers.set(client, new DocumentTracker(client))
    await client.start()
    return client
  }

  /**
   * Returns (or creates) the DocumentTracker for a given client.
   */
  trackerFor(client: LspClient): DocumentTracker {
    let tracker = this._trackers.get(client)
    if (!tracker) {
      tracker = new DocumentTracker(client)
      this._trackers.set(client, tracker)
    }
    return tracker
  }

  /**
   * Notify the manager that a file has changed (e.g. after Write/Edit).
   * If a client has the file open, sends applyChange. Non-blocking.
   */
  notifyFileChanged(filePath: string, newText: string): void {
    const uri = pathToFileURL(filePath).href
    for (const client of this._clients.values()) {
      const tracker = this._trackers.get(client)
      if (tracker?.isOpen(uri)) {
        // Non-blocking — don't await
        void tracker.applyChange(uri, newText).catch(() => {
          // Ignore errors (client may have died)
        })
      }
    }
  }

  /**
   * Shut down all spawned clients.
   */
  async closeAll(): Promise<void> {
    const shutdowns = Array.from(this._clients.values()).map(c =>
      c.shutdown().catch(() => {}),
    )
    await Promise.all(shutdowns)
    this._clients.clear()
    this._trackers.clear()
  }
}
