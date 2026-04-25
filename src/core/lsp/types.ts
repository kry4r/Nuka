// src/core/lsp/types.ts
// LSP 3.17 subset types for Nuka Phase 6

export type LspServerDef = {
  /** Unique identifier, namespaced as <plugin>:<name> when registered via a plugin */
  name: string
  /** Executable path or command name, e.g. "typescript-language-server" */
  command: string
  /** Command-line arguments, e.g. ["--stdio"] */
  args?: string[]
  /** Which files this server handles */
  documentSelector: Array<{
    /** LSP language ID, e.g. "typescript", "javascript" */
    language?: string
    /** Glob pattern matched against absolute file paths (supports * wildcard) */
    pattern?: string
  }>
  /** Passed as-is in the initialize request */
  initializationOptions?: unknown
  /** Workspace root URI; defaults to file:// + cwd */
  rootUri?: string
  /** Additional environment variables for the server process */
  env?: Record<string, string>
}

export type LspRange = {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export type LspDiagnostic = {
  range: LspRange
  /** 1=Error, 2=Warning, 3=Information, 4=Hint */
  severity?: 1 | 2 | 3 | 4
  message: string
  source?: string
}

export type LspLocation = {
  uri: string
  range: LspRange
}

export type LspHover = {
  contents: string
}
