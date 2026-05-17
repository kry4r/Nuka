// src/core/lsp/lspQueryTool.ts
//
// LSPQuery — agent-facing tool wrapping the existing `LspManager` /
// `LspClient` infrastructure into a single discriminated-action
// surface for navigation-style LSP queries (`definition`,
// `references`, `hover`, `documentSymbols`, `workspaceSymbol`,
// `implementation`, `callHierarchy`).
//
// Why a single tool? The legacy per-action helpers in `./tools.ts`
// (`lsp_diagnostics`, `lsp_definition`, `lsp_references`) only get
// auto-registered when *some* `LspServerDef` is configured (see
// `cli.tsx` near `lspManager.list().length > 0`). They are kept
// around for backward compatibility with anyone wiring those names
// directly. This new tool follows the multi-action convention used
// by `TokenCountTool` / `AnsiStyleTool` / `WhitespaceTool` — same
// `action` discriminator, same JSON-stringified structured payload
// out — and is always registered (even when no server is
// configured) so the agent gets a stable schema. With no server
// configured, every action returns the friendly "No LSP server
// registered for <path>" message with `isError: false`, matching
// the legacy tools.
//
// Capability scope: the underlying `LspClient` declares
// `definition` / `references` / `publishDiagnostics` /
// `implementation` / `callHierarchy` / `workspace.symbol` in its
// `initialize` request (see client.ts). LSP servers in practice
// answer `textDocument/hover` and `textDocument/documentSymbol`
// regardless of the client's declared capabilities, since the
// client declaration is a hint about what *the client* will handle,
// not a gate on what it can ask. For an underlying server that
// genuinely lacks the method, the request will error with
// `MethodNotFound` and we surface that as `isError: true`.
//
// Side-effects: opens the target file inside the LSP server's
// document tracker (idempotent — `DocumentTracker.ensureOpen` no-ops
// if already open) and then sends a single `request` RPC.
// `workspaceSymbol` is a workspace-level query and doesn't need a
// specific file open — we still go through `clientFor(filePath)` to
// pick the right server, and treat `filePath` as a routing hint.
// `callHierarchy` issues two RPCs in sequence (prepare → incoming/
// outgoing) and aggregates the result. Does not modify the file. We
// declare `readOnly: true` and `parallelSafe: true` — concurrent
// invocations against different files do not collide because each
// invocation uses its own URI; concurrent invocations against the
// same file share the tracker's per-URI state (open is idempotent,
// request IDs are per-call).
//
// Output: every action returns a tagged structured payload (see
// `LspQueryToolResult`). The tool's `output` is the
// JSON-stringified payload so structured consumers (palette,
// transcripts, sibling agents) can `JSON.parse` it round-trip.
//
// Line/character convention: 0-based throughout the LSP, which is
// what we pass through verbatim. Result `range`s are also 0-based.

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import type { LspManager } from './manager'
import type { LspClient } from './client'
import type { LspLocation, LspRange } from './types'

export const LSP_QUERY_TOOL_NAME = 'LSPQuery'

/** Discriminator values accepted by the tool. */
export type LspQueryAction =
  | 'definition'
  | 'references'
  | 'hover'
  | 'documentSymbols'
  | 'workspaceSymbol'
  | 'implementation'
  | 'callHierarchy'

/**
 * Direction parameter for `callHierarchy`. `incoming` asks "who
 * calls this symbol?", `outgoing` asks "what does this symbol
 * call?". The two LSP methods are `callHierarchy/incomingCalls`
 * and `callHierarchy/outgoingCalls` respectively.
 */
export type LspCallHierarchyDirection = 'incoming' | 'outgoing'

export type LspQueryToolInput = {
  action: LspQueryAction
  /**
   * Absolute or relative path to the file. Resolved via
   * `pathToFileURL(filePath)` — relative paths are interpreted
   * against the process cwd by Node, so the agent should prefer
   * absolute paths for stability.
   *
   * For `workspaceSymbol`, `filePath` is used only to route to the
   * right LSP server — the query itself is workspace-scoped.
   */
  filePath?: string
  /** Required for definition / references / hover / implementation / callHierarchy. 0-based. */
  line?: number
  /** Required for definition / references / hover / implementation / callHierarchy. 0-based. */
  character?: number
  /** Required for `workspaceSymbol`. Empty string is valid (= "all symbols"). */
  query?: string
  /** Required for `callHierarchy`. */
  direction?: LspCallHierarchyDirection
}

/**
 * Hover content shape returned by `textDocument/hover`. The LSP
 * spec allows the contents field to be a raw string, a
 * `MarkupContent` object, or an array of `MarkedString` (legacy).
 * We normalise to a single `value` string for the agent and tag
 * the markup `kind` when available.
 */
export type LspHoverResult = {
  /** Markup body, joined with double newlines if the server returned multiple parts. */
  value: string
  /**
   * 'markdown' when at least one part declared markdown; 'plaintext'
   * otherwise. Mirrors LSP `MarkupKind`. Defaults to 'plaintext' for
   * raw-string contents and legacy `MarkedString[]` entries without
   * a language tag.
   */
  kind: 'markdown' | 'plaintext'
  /** Optional range the hover applies to (0-based, LSP-native). */
  range?: LspRange
}

/**
 * Document symbol shape returned by `textDocument/documentSymbol`.
 * LSP defines two response variants: hierarchical `DocumentSymbol`
 * (the modern shape, returned by tsserver / gopls) and flat
 * `SymbolInformation[]` (the legacy shape). We normalise to a
 * shared structure: every entry has a `name`, `kind`, `range`,
 * `selectionRange`, optional `detail`, and optional `children`.
 *
 * `kind` is the numeric LSP SymbolKind (1..26 in 3.17). We surface
 * the integer rather than mapping to a string to avoid lying about
 * cases we don't recognise; the agent or palette can map the int
 * downstream.
 */
export type LspDocumentSymbol = {
  name: string
  kind: number
  range: LspRange
  selectionRange: LspRange
  detail?: string
  children?: LspDocumentSymbol[]
}

/**
 * Workspace symbol info returned by `workspace/symbol`. LSP defines
 * two variants: the legacy `SymbolInformation` and the modern
 * `WorkspaceSymbol`. Both have `name`, `kind`, and a `location`
 * (modern servers may return a `location` with only `uri`,
 * deferring the range until `workspaceSymbol/resolve` — we surface
 * a range when present, omit otherwise). `containerName` is the
 * enclosing class/namespace and is optional.
 */
export type LspWorkspaceSymbol = {
  name: string
  kind: number
  /** May be omitted when the server defers range resolution. */
  location: { uri: string; range?: LspRange }
  containerName?: string
}

/**
 * `CallHierarchyItem` as returned by `textDocument/prepareCallHierarchy`.
 * Mirrors the LSP 3.16+ shape; we preserve the `data` blob verbatim
 * because servers use it to round-trip stateful info between the
 * prepare step and the follow-up incoming/outgoing calls.
 */
export type LspCallHierarchyItem = {
  name: string
  kind: number
  uri: string
  range: LspRange
  selectionRange: LspRange
  detail?: string
  tags?: number[]
  /** Server-defined opaque payload — round-tripped untouched. */
  data?: unknown
}

/**
 * `CallHierarchyIncomingCall` shape. `from` is the *caller* and
 * `fromRanges` are the call sites within that caller's body.
 */
export type LspCallHierarchyIncomingCall = {
  from: LspCallHierarchyItem
  fromRanges: LspRange[]
}

/**
 * `CallHierarchyOutgoingCall` shape. `to` is the *callee* and
 * `fromRanges` are the call sites within the original symbol's
 * body. (Yes, the spec really does call them `fromRanges` here too
 * — the ranges are still in the *original* file, not the callee's.)
 */
export type LspCallHierarchyOutgoingCall = {
  to: LspCallHierarchyItem
  fromRanges: LspRange[]
}

/** Tagged result payload per action. */
export type LspQueryToolResult =
  | {
      action: 'definition'
      locations: LspLocation[]
    }
  | {
      action: 'references'
      locations: LspLocation[]
    }
  | {
      action: 'hover'
      hover: LspHoverResult | null
    }
  | {
      action: 'documentSymbols'
      symbols: LspDocumentSymbol[]
    }
  | {
      action: 'workspaceSymbol'
      symbols: LspWorkspaceSymbol[]
    }
  | {
      action: 'implementation'
      locations: LspLocation[]
    }
  | {
      action: 'callHierarchy'
      direction: LspCallHierarchyDirection
      /**
       * Items from `prepareCallHierarchy`. Useful for clients that
       * want to display the resolved symbol(s) the call hierarchy is
       * anchored on. Always non-empty when `incoming`/`outgoing` is
       * non-empty.
       */
      items: LspCallHierarchyItem[]
      /** Populated when `direction === 'incoming'`. */
      incoming?: LspCallHierarchyIncomingCall[]
      /** Populated when `direction === 'outgoing'`. */
      outgoing?: LspCallHierarchyOutgoingCall[]
    }

/**
 * "Server not configured" sentinel returned (with `isError: false`)
 * for every action when no `LspServerDef` matches the file. Mirrors
 * the legacy tools' behavior so the agent gets a consistent friendly
 * message regardless of which tool name it called.
 */
export type LspQueryNotConfigured = {
  action: LspQueryAction
  notConfigured: true
  filePath: string
}

const VALID_ACTIONS: ReadonlySet<LspQueryAction> = new Set([
  'definition',
  'references',
  'hover',
  'documentSymbols',
  'workspaceSymbol',
  'implementation',
  'callHierarchy',
])

const POSITION_ACTIONS: ReadonlySet<LspQueryAction> = new Set([
  'definition',
  'references',
  'hover',
  'implementation',
  'callHierarchy',
])

/**
 * Actions that need a `filePath`. `workspaceSymbol` is the lone
 * holdout — it queries the workspace, not a specific file. We still
 * accept an optional `filePath` to route to the right server when
 * multiple servers are registered (otherwise we fall back to the
 * first registered server below).
 */
const FILEPATH_REQUIRED_ACTIONS: ReadonlySet<LspQueryAction> = new Set([
  'definition',
  'references',
  'hover',
  'documentSymbols',
  'implementation',
  'callHierarchy',
])

const VALID_DIRECTIONS: ReadonlySet<LspCallHierarchyDirection> = new Set(['incoming', 'outgoing'])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `LSPQuery: ${msg}` }
}

function requireString(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: `'${field}' must be a string (got ${typeof value}).` }
  }
  if (value.length === 0) {
    return { ok: false, error: `'${field}' must be a non-empty string.` }
  }
  return { ok: true, value }
}

function requireNonNegativeInteger(
  value: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `'${field}' must be a finite number (got ${String(value)}).` }
  }
  if (!Number.isInteger(value)) {
    return { ok: false, error: `'${field}' must be an integer (got ${value}).` }
  }
  if (value < 0) {
    return { ok: false, error: `'${field}' must be non-negative (got ${value}).` }
  }
  return { ok: true, value }
}

// LSP language ID inference (kept in sync with `tools.ts`'s helper).
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
): Promise<{ uri: string; client: LspClient | null }> {
  const client = await manager.clientFor(filePath)
  if (!client) return { uri: pathToFileURL(filePath).href, client: null }

  const uri = pathToFileURL(filePath).href
  const tracker = manager.trackerFor(client)
  if (!tracker.isOpen(uri)) {
    let text = ''
    try {
      text = await readFile(filePath, 'utf8')
    } catch {
      // File might not exist yet; use empty string. The server will
      // emit a diagnostic about the empty file rather than crash.
    }
    const languageId = inferLanguageIdFromPath(filePath)
    await tracker.ensureOpen(uri, text, languageId)
  }
  return { uri, client }
}

/**
 * Best-effort normaliser for the `hover.contents` union. Returns
 * `null` if the server replied with no body (LSP allows a `null`
 * `result`). Otherwise returns a `LspHoverResult` with a single
 * `value` string and a coarse `kind`.
 */
function normaliseHoverContents(
  raw: unknown,
): { value: string; kind: 'markdown' | 'plaintext' } | null {
  if (raw == null) return null

  // Variant 1: raw string.
  if (typeof raw === 'string') {
    return { value: raw, kind: 'plaintext' }
  }

  // Variant 2: MarkupContent — { kind: 'markdown'|'plaintext', value: string }
  if (typeof raw === 'object' && 'value' in raw && typeof (raw as { value: unknown }).value === 'string') {
    const obj = raw as { kind?: unknown; value: string }
    const kind = obj.kind === 'markdown' ? 'markdown' : 'plaintext'
    return { value: obj.value, kind }
  }

  // Variant 3: MarkedString | MarkedString[] (legacy).
  //   MarkedString = string | { language: string, value: string }
  if (Array.isArray(raw)) {
    let anyMarkdown = false
    const parts: string[] = []
    for (const part of raw) {
      if (typeof part === 'string') {
        parts.push(part)
      } else if (
        part != null &&
        typeof part === 'object' &&
        'value' in part &&
        typeof (part as { value: unknown }).value === 'string'
      ) {
        const p = part as { language?: unknown; value: string }
        if (typeof p.language === 'string' && p.language.length > 0) {
          // Wrap fenced — counts as markdown.
          anyMarkdown = true
          parts.push('```' + p.language + '\n' + p.value + '\n```')
        } else {
          parts.push(p.value)
        }
      }
    }
    if (parts.length === 0) return null
    return { value: parts.join('\n\n'), kind: anyMarkdown ? 'markdown' : 'plaintext' }
  }

  return null
}

/**
 * Recursively normalise a `DocumentSymbol` or `SymbolInformation`
 * entry into our shared `LspDocumentSymbol` shape. Returns `null`
 * if the entry is missing the required `name`/`range` fields, so
 * we drop garbage entries rather than throwing.
 */
function normaliseDocumentSymbol(raw: unknown): LspDocumentSymbol | null {
  if (raw == null || typeof raw !== 'object') return null
  const obj = raw as {
    name?: unknown
    kind?: unknown
    detail?: unknown
    range?: unknown
    selectionRange?: unknown
    location?: unknown
    children?: unknown
  }
  if (typeof obj.name !== 'string') return null

  // Hierarchical DocumentSymbol — has `range` + `selectionRange`.
  if (obj.range && obj.selectionRange) {
    const range = obj.range as LspRange
    const selectionRange = obj.selectionRange as LspRange
    const out: LspDocumentSymbol = {
      name: obj.name,
      kind: typeof obj.kind === 'number' ? obj.kind : 0,
      range,
      selectionRange,
    }
    if (typeof obj.detail === 'string') out.detail = obj.detail
    if (Array.isArray(obj.children)) {
      const children: LspDocumentSymbol[] = []
      for (const c of obj.children) {
        const norm = normaliseDocumentSymbol(c)
        if (norm) children.push(norm)
      }
      if (children.length > 0) out.children = children
    }
    return out
  }

  // Flat SymbolInformation — has `location: { uri, range }`.
  if (
    obj.location &&
    typeof obj.location === 'object' &&
    'range' in obj.location
  ) {
    const loc = obj.location as { range: LspRange }
    const range = loc.range
    return {
      name: obj.name,
      kind: typeof obj.kind === 'number' ? obj.kind : 0,
      range,
      // No selectionRange in the flat shape — repeat the full range.
      selectionRange: range,
    }
  }

  return null
}

/**
 * Normalise a `WorkspaceSymbol` / `SymbolInformation` entry to our
 * shared shape. Returns `null` for malformed entries. Both LSP
 * variants share the `name` / `kind` / `location` triple at the top
 * level; only the `location.range` may be absent (modern
 * `WorkspaceSymbol` allows servers to defer range resolution).
 */
function normaliseWorkspaceSymbol(raw: unknown): LspWorkspaceSymbol | null {
  if (raw == null || typeof raw !== 'object') return null
  const obj = raw as {
    name?: unknown
    kind?: unknown
    containerName?: unknown
    location?: unknown
  }
  if (typeof obj.name !== 'string') return null
  if (obj.location == null || typeof obj.location !== 'object') return null

  const loc = obj.location as { uri?: unknown; range?: unknown }
  if (typeof loc.uri !== 'string') return null

  const out: LspWorkspaceSymbol = {
    name: obj.name,
    kind: typeof obj.kind === 'number' ? obj.kind : 0,
    location: { uri: loc.uri },
  }
  if (loc.range != null && typeof loc.range === 'object') {
    out.location.range = loc.range as LspRange
  }
  if (typeof obj.containerName === 'string') {
    out.containerName = obj.containerName
  }
  return out
}

/**
 * Normalise a `CallHierarchyItem` from `prepareCallHierarchy`.
 * Returns `null` for malformed entries. `data` is preserved
 * verbatim because servers use it to round-trip stateful info to
 * the follow-up `incomingCalls` / `outgoingCalls` request.
 */
function normaliseCallHierarchyItem(raw: unknown): LspCallHierarchyItem | null {
  if (raw == null || typeof raw !== 'object') return null
  const obj = raw as {
    name?: unknown
    kind?: unknown
    detail?: unknown
    uri?: unknown
    range?: unknown
    selectionRange?: unknown
    tags?: unknown
    data?: unknown
  }
  if (typeof obj.name !== 'string') return null
  if (typeof obj.uri !== 'string') return null
  if (obj.range == null || typeof obj.range !== 'object') return null
  if (obj.selectionRange == null || typeof obj.selectionRange !== 'object') return null

  const out: LspCallHierarchyItem = {
    name: obj.name,
    kind: typeof obj.kind === 'number' ? obj.kind : 0,
    uri: obj.uri,
    range: obj.range as LspRange,
    selectionRange: obj.selectionRange as LspRange,
  }
  if (typeof obj.detail === 'string') out.detail = obj.detail
  if (Array.isArray(obj.tags)) {
    const tags: number[] = []
    for (const t of obj.tags) {
      if (typeof t === 'number') tags.push(t)
    }
    if (tags.length > 0) out.tags = tags
  }
  if (obj.data !== undefined) out.data = obj.data
  return out
}

/**
 * Run the LSP query against an already-resolved client. Exported so
 * tests can mock at the manager level without re-implementing the
 * dispatcher.
 */
async function dispatchAction(
  client: LspClient,
  uri: string,
  input: LspQueryToolInput,
): Promise<LspQueryToolResult> {
  switch (input.action) {
    case 'definition': {
      const result = await client.request<LspLocation | LspLocation[] | null>(
        'textDocument/definition',
        {
          textDocument: { uri },
          position: { line: input.line ?? 0, character: input.character ?? 0 },
        },
        10_000,
      )
      const locations: LspLocation[] =
        result == null ? [] : Array.isArray(result) ? result : [result]
      return { action: 'definition', locations }
    }
    case 'references': {
      const result = await client.request<LspLocation[] | null>(
        'textDocument/references',
        {
          textDocument: { uri },
          position: { line: input.line ?? 0, character: input.character ?? 0 },
          context: { includeDeclaration: true },
        },
        10_000,
      )
      const locations: LspLocation[] = result ?? []
      return { action: 'references', locations }
    }
    case 'hover': {
      const raw = await client.request<{ contents?: unknown; range?: LspRange } | null>(
        'textDocument/hover',
        {
          textDocument: { uri },
          position: { line: input.line ?? 0, character: input.character ?? 0 },
        },
        10_000,
      )
      if (raw == null) return { action: 'hover', hover: null }
      const norm = normaliseHoverContents(raw.contents)
      if (!norm) return { action: 'hover', hover: null }
      const hover: LspHoverResult = { ...norm }
      if (raw.range) hover.range = raw.range
      return { action: 'hover', hover }
    }
    case 'documentSymbols': {
      const raw = await client.request<unknown[] | null>(
        'textDocument/documentSymbol',
        { textDocument: { uri } },
        15_000,
      )
      const arr = Array.isArray(raw) ? raw : []
      const symbols: LspDocumentSymbol[] = []
      for (const entry of arr) {
        const norm = normaliseDocumentSymbol(entry)
        if (norm) symbols.push(norm)
      }
      return { action: 'documentSymbols', symbols }
    }
    case 'workspaceSymbol': {
      // `workspace/symbol` is workspace-scoped — the request takes a
      // `query` string (servers do their own substring/fuzzy match)
      // and returns either a flat `SymbolInformation[]` or modern
      // `WorkspaceSymbol[]`. Empty query is valid in the spec and
      // most servers respond with "all known symbols" or "the most
      // common ones" — we don't second-guess them.
      const raw = await client.request<unknown[] | null>(
        'workspace/symbol',
        { query: input.query ?? '' },
        15_000,
      )
      const arr = Array.isArray(raw) ? raw : []
      const symbols: LspWorkspaceSymbol[] = []
      for (const entry of arr) {
        const norm = normaliseWorkspaceSymbol(entry)
        if (norm) symbols.push(norm)
      }
      return { action: 'workspaceSymbol', symbols }
    }
    case 'implementation': {
      // Same response shape as `textDocument/definition`: server may
      // return `Location | Location[] | null`.
      const result = await client.request<LspLocation | LspLocation[] | null>(
        'textDocument/implementation',
        {
          textDocument: { uri },
          position: { line: input.line ?? 0, character: input.character ?? 0 },
        },
        10_000,
      )
      const locations: LspLocation[] =
        result == null ? [] : Array.isArray(result) ? result : [result]
      return { action: 'implementation', locations }
    }
    case 'callHierarchy': {
      // Two-step LSP flow:
      //   1) `textDocument/prepareCallHierarchy` — resolve symbol at
      //      position to a `CallHierarchyItem[]`. The spec allows
      //      `null` (no result) or an array. Older servers
      //      occasionally returned a single item — we normalise both
      //      shapes defensively even though 3.16+ servers don't do
      //      this.
      //   2) For each item, `callHierarchy/{incoming,outgoing}Calls`
      //      based on direction. We aggregate all results.
      //
      // If the prepare returns no items, we short-circuit and return
      // empty calls without sending the second-step RPC — this
      // matches what an LSP client UI would do.
      const direction = input.direction
      if (direction !== 'incoming' && direction !== 'outgoing') {
        // Should be caught by upstream validation; defensive.
        throw new Error(`invalid callHierarchy direction: ${String(direction)}`)
      }
      const prepareRaw = await client.request<unknown>(
        'textDocument/prepareCallHierarchy',
        {
          textDocument: { uri },
          position: { line: input.line ?? 0, character: input.character ?? 0 },
        },
        10_000,
      )
      // Normalise null | single | array → array of items.
      const prepareArr: unknown[] =
        prepareRaw == null
          ? []
          : Array.isArray(prepareRaw)
            ? prepareRaw
            : [prepareRaw]
      const items: LspCallHierarchyItem[] = []
      for (const entry of prepareArr) {
        const norm = normaliseCallHierarchyItem(entry)
        if (norm) items.push(norm)
      }
      if (items.length === 0) {
        if (direction === 'incoming') {
          return { action: 'callHierarchy', direction, items, incoming: [] }
        }
        return { action: 'callHierarchy', direction, items, outgoing: [] }
      }

      // Step 2: fan-out per item. We re-serialise the item for the
      // server with its original `data` blob intact.
      const method =
        direction === 'incoming'
          ? 'callHierarchy/incomingCalls'
          : 'callHierarchy/outgoingCalls'

      if (direction === 'incoming') {
        const incoming: LspCallHierarchyIncomingCall[] = []
        for (const item of items) {
          const raw = await client.request<unknown[] | null>(
            method,
            { item },
            10_000,
          )
          if (!Array.isArray(raw)) continue
          for (const call of raw) {
            if (call == null || typeof call !== 'object') continue
            const c = call as { from?: unknown; fromRanges?: unknown }
            const from = normaliseCallHierarchyItem(c.from)
            if (!from) continue
            const ranges: LspRange[] = Array.isArray(c.fromRanges)
              ? c.fromRanges.filter(
                  (r): r is LspRange => r != null && typeof r === 'object',
                )
              : []
            incoming.push({ from, fromRanges: ranges })
          }
        }
        return { action: 'callHierarchy', direction, items, incoming }
      } else {
        const outgoing: LspCallHierarchyOutgoingCall[] = []
        for (const item of items) {
          const raw = await client.request<unknown[] | null>(
            method,
            { item },
            10_000,
          )
          if (!Array.isArray(raw)) continue
          for (const call of raw) {
            if (call == null || typeof call !== 'object') continue
            const c = call as { to?: unknown; fromRanges?: unknown }
            const to = normaliseCallHierarchyItem(c.to)
            if (!to) continue
            const ranges: LspRange[] = Array.isArray(c.fromRanges)
              ? c.fromRanges.filter(
                  (r): r is LspRange => r != null && typeof r === 'object',
                )
              : []
            outgoing.push({ to, fromRanges: ranges })
          }
        }
        return { action: 'callHierarchy', direction, items, outgoing }
      }
    }
    default: {
      // Exhaustiveness — never reached when validation runs first.
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Build the tool given an `LspManager`. Mirrors the factory pattern
 * used by the legacy `makeLsp*Tool` helpers so it composes the same
 * way under the `cli.tsx` wiring.
 */
export function makeLspQueryTool(manager: LspManager): Tool<LspQueryToolInput> {
  return defineTool<LspQueryToolInput>({
    name: LSP_QUERY_TOOL_NAME,
    description:
      'Run an LSP navigation query against an open file via the configured ' +
      'language server. Pick `action`: ' +
      '`definition` resolves the symbol at `line`/`character` to its ' +
      'definition site(s) — returns `locations` (array of `{uri, range}`); ' +
      '`references` finds all references to the symbol at `line`/`character` ' +
      '(includes the declaration) — returns `locations`; ' +
      '`hover` returns the hover (signature/docs) at `line`/`character` — ' +
      'returns `hover` (`{value, kind: "markdown"|"plaintext", range?}`) or ' +
      '`null` if the server has nothing to say; ' +
      '`documentSymbols` lists every top-level symbol in the file (functions, ' +
      'classes, exports) as a tree — returns `symbols` (array of ' +
      '`{name, kind, range, selectionRange, detail?, children?}`); ' +
      '`workspaceSymbol` searches the entire workspace for symbols matching ' +
      '`query` (empty string allowed; the server decides match semantics) — ' +
      'returns `symbols` (array of `{name, kind, location, containerName?}`); ' +
      '`implementation` goes to implementation site(s) of the interface or ' +
      'abstract method at `line`/`character` — returns `locations`; ' +
      '`callHierarchy` (needs `direction: "incoming"|"outgoing"`) walks the ' +
      'call graph at `line`/`character`: incoming = "who calls this?", ' +
      'outgoing = "what does this call?" — returns the prepare `items` plus ' +
      '`incoming` or `outgoing` (each call has `{from|to, fromRanges}`). ' +
      'All `line`/`character` are 0-based, matching the LSP spec. When no ' +
      'LSP server is configured for the file the tool returns a friendly ' +
      '`{notConfigured: true}` payload with `isError: false`. Read-only — ' +
      'opens the file in the server but never edits.',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'definition',
            'references',
            'hover',
            'documentSymbols',
            'workspaceSymbol',
            'implementation',
            'callHierarchy',
          ],
          description:
            'Which LSP query to run. `definition`/`references`/`hover`/' +
            '`implementation`/`callHierarchy` need `line` and `character`; ' +
            '`documentSymbols` does not. `workspaceSymbol` needs `query` and ' +
            'an optional `filePath` hint for server routing. `callHierarchy` ' +
            'additionally needs `direction: "incoming"|"outgoing"`.',
        },
        filePath: {
          type: 'string',
          description:
            'Absolute or relative path to the file. Relative paths are ' +
            'resolved against the process cwd; prefer absolute for stability. ' +
            'Required for everything except `workspaceSymbol`, where it acts ' +
            'as a hint for routing to the right LSP server.',
        },
        line: {
          type: 'number',
          minimum: 0,
          description:
            '0-based line number in the file. Required for `definition`, ' +
            '`references`, `hover`, `implementation`, and `callHierarchy`; ' +
            'ignored for `documentSymbols` and `workspaceSymbol`.',
        },
        character: {
          type: 'number',
          minimum: 0,
          description:
            '0-based character offset within the line. Required for ' +
            '`definition`, `references`, `hover`, `implementation`, and ' +
            '`callHierarchy`; ignored for `documentSymbols` and ' +
            '`workspaceSymbol`.',
        },
        query: {
          type: 'string',
          description:
            'Workspace symbol search string. Required for `workspaceSymbol`. ' +
            'Empty string is valid — the server interprets it (often as ' +
            '"all known symbols"). Ignored for all other actions.',
        },
        direction: {
          type: 'string',
          enum: ['incoming', 'outgoing'],
          description:
            'Which side of the call graph to walk. Required for ' +
            '`callHierarchy`. Ignored for all other actions.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'lsp', 'navigation'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    searchHint: [
      'lsp',
      'definition',
      'references',
      'hover',
      'documentSymbol',
      'documentSymbols',
      'symbols',
      'go-to-definition',
      'go to definition',
      'workspaceSymbol',
      'workspace symbols',
      'implementation',
      'go to implementation',
      'callHierarchy',
      'call hierarchy',
      'incoming calls',
      'outgoing calls',
    ],
    aliases: ['lsp_query', 'lsp', 'lspQuery'],
    async run(input: LspQueryToolInput, _ctx: ToolContext): Promise<ToolResult> {
      // ── basic shape check ───────────────────────────────────────────
      if (input == null || typeof input !== 'object') {
        return errorResult(`input must be an object (got ${String(input)}).`)
      }
      const { action } = input
      if (typeof action !== 'string') {
        return errorResult(`'action' must be a string (got ${typeof action}).`)
      }
      if (!VALID_ACTIONS.has(action as LspQueryAction)) {
        return errorResult(
          `unknown action '${action}'. Valid: definition, references, hover, documentSymbols, workspaceSymbol, implementation, callHierarchy.`,
        )
      }

      const act = action as LspQueryAction

      // ── shared validation: filePath ──────────────────────────────────
      let filePath = ''
      if (FILEPATH_REQUIRED_ACTIONS.has(act)) {
        const fp = requireString(input.filePath, 'filePath')
        if (!fp.ok) return errorResult(fp.error)
        filePath = fp.value
      } else {
        // workspaceSymbol — filePath optional. If provided, must be a
        // non-empty string; if absent, we fall back to any registered
        // server (handled below in resolveClient).
        if (input.filePath !== undefined) {
          const fp = requireString(input.filePath, 'filePath')
          if (!fp.ok) return errorResult(fp.error)
          filePath = fp.value
        }
      }

      // ── per-action validation: position fields ──────────────────────
      if (POSITION_ACTIONS.has(act)) {
        if (input.line === undefined) {
          return errorResult(`action='${action}': 'line' is required.`)
        }
        if (input.character === undefined) {
          return errorResult(`action='${action}': 'character' is required.`)
        }
        const l = requireNonNegativeInteger(input.line, 'line')
        if (!l.ok) return errorResult(l.error)
        const c = requireNonNegativeInteger(input.character, 'character')
        if (!c.ok) return errorResult(c.error)
      }

      // ── per-action validation: workspaceSymbol query ────────────────
      if (act === 'workspaceSymbol') {
        if (input.query === undefined) {
          return errorResult(`action='${action}': 'query' is required.`)
        }
        if (typeof input.query !== 'string') {
          return errorResult(
            `action='${action}': 'query' must be a string (got ${typeof input.query}).`,
          )
        }
      }

      // ── per-action validation: callHierarchy direction ─────────────
      if (act === 'callHierarchy') {
        if (input.direction === undefined) {
          return errorResult(`action='${action}': 'direction' is required.`)
        }
        if (
          typeof input.direction !== 'string' ||
          !VALID_DIRECTIONS.has(input.direction as LspCallHierarchyDirection)
        ) {
          return errorResult(
            `action='${action}': 'direction' must be 'incoming' or 'outgoing' (got ${String(input.direction)}).`,
          )
        }
      }

      // ── dispatch ────────────────────────────────────────────────────
      try {
        let client: LspClient | null
        let uri: string
        if (act === 'workspaceSymbol' && filePath === '') {
          // No file hint — fall back to the first registered server.
          // If nothing is registered, surface the same `notConfigured`
          // shape the file-bound path produces.
          const defs = manager.list()
          if (defs.length === 0) {
            const payload: LspQueryNotConfigured = {
              action: act,
              notConfigured: true,
              filePath: '',
            }
            return { isError: false, output: JSON.stringify(payload) }
          }
          // Route through the first server's selector if it has a
          // language; otherwise we fabricate a sentinel path that
          // matches "*" patterns. Practically, callers should pass a
          // filePath; this is just a graceful fallback.
          const first = defs[0]
          const langHint =
            first?.documentSelector.find(s => s.language)?.language
          const fallbackPath = langHint
            ? `/workspace.${extOfLang(langHint)}`
            : '/workspace.ts'
          const opened = await ensureFileOpen(manager, fallbackPath)
          client = opened.client
          uri = opened.uri
        } else {
          const opened = await ensureFileOpen(manager, filePath)
          client = opened.client
          uri = opened.uri
        }

        if (!client) {
          const payload: LspQueryNotConfigured = {
            action: act,
            notConfigured: true,
            filePath,
          }
          return { isError: false, output: JSON.stringify(payload) }
        }
        const payload = await dispatchAction(client, uri, { ...input, action: act, filePath })
        return { isError: false, output: JSON.stringify(payload) }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return errorResult(`action='${action}' failed: ${msg}`)
      }
    },
  })
}

/** Inverse of `inferLanguageIdFromPath` — pick a representative ext. */
function extOfLang(lang: string): string {
  const m: Record<string, string> = {
    typescript: 'ts',
    typescriptreact: 'tsx',
    javascript: 'js',
    javascriptreact: 'jsx',
    python: 'py',
    go: 'go',
    rust: 'rs',
    ruby: 'rb',
    php: 'php',
    csharp: 'cs',
    java: 'java',
    swift: 'swift',
    kotlin: 'kt',
    c: 'c',
    cpp: 'cpp',
  }
  return m[lang] ?? 'ts'
}
