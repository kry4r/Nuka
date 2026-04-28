// src/core/lsp/tools.ts
// Agent-facing LSP tools: lsp_diagnostics, lsp_definition, lsp_references
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { Tool } from '../tools/types'
import type { LspManager } from './manager'
import type { LspDiagnostic, LspLocation } from './types'

const SEVERITY_LABELS: Record<number, string> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
}

function formatDiagnostics(diags: LspDiagnostic[], path: string): string {
  if (diags.length === 0) return `No diagnostics for ${path}`
  return diags
    .map(d => {
      const sev = SEVERITY_LABELS[d.severity ?? 1] ?? 'error'
      const line = d.range.start.line + 1
      const col = d.range.start.character + 1
      const src = d.source ? ` [${d.source}]` : ''
      return `${sev} ${line}:${col} ${d.message}${src}`
    })
    .join('\n')
}

function formatLocations(locs: LspLocation[], path: string, line: number, character: number, kind: string): string {
  if (locs.length === 0) return `No ${kind} found at ${path}:${line}:${character}`
  return locs
    .map(loc => {
      const l = loc.range.start.line + 1
      const c = loc.range.start.character + 1
      const file = loc.uri.startsWith('file://') ? loc.uri.slice('file://'.length) : loc.uri
      return `${file}:${l}:${c}`
    })
    .join('\n')
}

// Simple language ID inference (duplicates manager.ts for now — could share)
function inferLanguageIdFromPath(filePath: string): string {
  const extMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript',
    jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript',
    py: 'python', go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
    cs: 'csharp', java: 'java', swift: 'swift', kt: 'kotlin',
    md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', sh: 'shellscript', bash: 'shellscript',
    c: 'c', cpp: 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
  }
  const ext = (filePath.split('.').pop() ?? '').toLowerCase()
  return extMap[ext] ?? ext
}

async function ensureFileOpen(
  manager: LspManager,
  filePath: string,
): Promise<{ uri: string; client: Awaited<ReturnType<LspManager['clientFor']>> }> {
  const client = await manager.clientFor(filePath)
  if (!client) return { uri: pathToFileURL(filePath).href, client: null }

  const uri = pathToFileURL(filePath).href
  const tracker = manager.trackerFor(client)
  if (!tracker.isOpen(uri)) {
    let text = ''
    try {
      text = await readFile(filePath, 'utf8')
    } catch {
      // File might not exist yet; use empty string
    }
    const languageId = inferLanguageIdFromPath(filePath)
    await tracker.ensureOpen(uri, text, languageId)
  }
  return { uri, client }
}

export function makeLspDiagnosticsTool(manager: LspManager): Tool<{ path: string }> {
  return {
    name: 'lsp_diagnostics',
    description: 'Get LSP diagnostics (errors, warnings) for a file. Returns cached diagnostics pushed by the language server; waits up to 2s for the first push if the file is newly opened.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file.' },
      },
    },
    source: 'builtin',
    tags: [],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input) {
      try {
        const { uri, client } = await ensureFileOpen(manager, input.path)
        if (!client) {
          return { isError: false, output: `No LSP server registered for ${input.path}` }
        }

        // If no diagnostics yet, wait up to 2s for the first push
        let diags = client.diagnosticsFor(uri)
        if (diags.length === 0) {
          diags = await new Promise<LspDiagnostic[]>(resolve => {
            const timeout = setTimeout(() => resolve([]), 2_000)
            const unsub = client.onDiagnostics(uri, (d) => {
              clearTimeout(timeout)
              unsub()
              resolve(d)
            })
          })
        }

        return { isError: false, output: formatDiagnostics(diags, input.path) }
      } catch (err) {
        return { isError: true, output: `lsp_diagnostics failed: ${(err as Error).message}` }
      }
    },
  }
}

export function makeLspDefinitionTool(
  manager: LspManager,
): Tool<{ path: string; line: number; character: number }> {
  return {
    name: 'lsp_definition',
    description: 'Go-to-definition via LSP. Returns file paths and positions of the definition(s). Line and character are 0-based.',
    parameters: {
      type: 'object',
      required: ['path', 'line', 'character'],
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file.' },
        line: { type: 'number', description: '0-based line number.' },
        character: { type: 'number', description: '0-based character offset.' },
      },
    },
    source: 'builtin',
    tags: [],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input) {
      try {
        const { uri, client } = await ensureFileOpen(manager, input.path)
        if (!client) {
          return { isError: false, output: `No LSP server registered for ${input.path}` }
        }

        const result = await client.request<LspLocation | LspLocation[] | null>(
          'textDocument/definition',
          {
            textDocument: { uri },
            position: { line: input.line, character: input.character },
          },
          10_000,
        )

        const locs: LspLocation[] = result == null ? [] : Array.isArray(result) ? result : [result]
        return { isError: false, output: formatLocations(locs, input.path, input.line, input.character, 'definition') }
      } catch (err) {
        return { isError: true, output: `lsp_definition failed: ${(err as Error).message}` }
      }
    },
  }
}

export function makeLspReferencesTool(
  manager: LspManager,
): Tool<{ path: string; line: number; character: number }> {
  return {
    name: 'lsp_references',
    description: 'Find all references via LSP. Returns file paths and positions. Line and character are 0-based.',
    parameters: {
      type: 'object',
      required: ['path', 'line', 'character'],
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file.' },
        line: { type: 'number', description: '0-based line number.' },
        character: { type: 'number', description: '0-based character offset.' },
      },
    },
    source: 'builtin',
    tags: [],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input) {
      try {
        const { uri, client } = await ensureFileOpen(manager, input.path)
        if (!client) {
          return { isError: false, output: `No LSP server registered for ${input.path}` }
        }

        const result = await client.request<LspLocation[] | null>(
          'textDocument/references',
          {
            textDocument: { uri },
            position: { line: input.line, character: input.character },
            context: { includeDeclaration: true },
          },
          10_000,
        )

        const locs: LspLocation[] = result ?? []
        return { isError: false, output: formatLocations(locs, input.path, input.line, input.character, 'references') }
      } catch (err) {
        return { isError: true, output: `lsp_references failed: ${(err as Error).message}` }
      }
    },
  }
}
