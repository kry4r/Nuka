// src/core/testing/explorer/L4_repair/subagent.ts
//
// M5.T3 — Opus tool-use loop: read/grep/edit/verify until clean.
// See locked spec §4.6 step 2.
//
// Architecture (Anthropic tool-use protocol):
//
//   1. Build system + initial-user messages from FailureRecord.
//   2. POST /v1/messages with tools[] enabled.
//   3. Response contains a content[] array. Each tool_use block is
//      executed locally; the result is folded back as a tool_result
//      block in the *next* user message.
//   4. Loop until verify reports clean, or maxTurns is hit, or the
//      wall clock crosses timeoutMs. Both budgets are checked at the
//      *top* of each loop iteration so we never start a turn we can't
//      finish under-budget.
//
// The Anthropic API requires that whenever an assistant turn ends with
// stop_reason='tool_use', the very next user turn MUST contain matching
// tool_result blocks for every tool_use id the assistant emitted. If
// the model emits N tool_use blocks in a single turn we run all N
// (top-to-bottom) and pack all N tool_results into one user message.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  callMessagesWithTools as defaultClient,
  type ContentBlock,
  type ToolDef,
  type ToolMessage,
  type ToolResponse,
} from '../L3_judge/client'
import { verify } from './verify'
import type { FailureRecord, Violation } from '../types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EditLogEntry = {
  path: string
  before: string
  after: string
  reason: string
}

export type EditLog = EditLogEntry[]

export type RepairStatus = 'verified' | 'exhausted' | 'timeout'

export type RepairSubagentResult = {
  status: RepairStatus
  edits: EditLog
  summary: string
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Test-friendly client type. The subagent only consumes `stop_reason`
 * and `content` from the response; tests can therefore supply a mock
 * that omits the `usage` block, which is purely an audit field. Keep
 * the production export tight (defaultClient = full callMessagesWithTools)
 * but loosen the DI handle to the minimal contract the loop reads.
 */
type ClientFn = (opts: {
  apiKey: string
  model: Parameters<typeof defaultClient>[0]['model']
  system: string
  messages: ToolMessage[]
  tools: ToolDef[]
  maxTokens: number
}) => Promise<{
  stop_reason: ToolResponse['stop_reason']
  content: ContentBlock[]
  usage?: ToolResponse['usage'] | { input_tokens?: number; output_tokens?: number }
}>

type SubagentOpts = {
  failure: FailureRecord
  cwd: string
  apiKey: string
  maxTurns?: number
  timeoutMs?: number
  _client?: ClientFn
  _now?: () => number
}

// ---------------------------------------------------------------------------
// Tool catalogue exposed to the model
// ---------------------------------------------------------------------------

const TOOLS: ToolDef[] = [
  {
    name: 'read_file',
    description:
      'Read the full contents of a project file. Use to inspect source ' +
      'before proposing an edit. Paths are resolved relative to cwd.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description:
      'Search the project for a string or regex. Returns at most 200 ' +
      'matches with file path, line number, and line text.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        glob: { type: 'string', description: 'optional path glob filter' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace exact match of old_string with new_string in the given ' +
      'file. Fails if old_string is not a unique substring of the file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'verify',
    description:
      'Re-mount the failing fixture/case at the failing viewport and ' +
      'return { clean: boolean, violations?: Violation[] }. Call this ' +
      'after any edit to confirm the fix.',
    input_schema: { type: 'object', properties: {} },
  },
]

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return [
    'You are an expert React + Ink TUI engineer repairing a layout/render ' +
      'bug in the current project.',
    '',
    'You have read/edit access to the project via the tools provided. The ' +
      'project is laid out under <cwd>; all file paths must be absolute or ' +
      'relative to cwd.',
    '',
    'Loop until verify reports { clean: true }. Make minimal, targeted ' +
      'edits. After every edit, call verify to confirm. Do not fabricate ' +
      'context — always read the file before editing it.',
  ].join('\n')
}

function buildInitialUserMessage(failure: FailureRecord): string {
  const v0 = failure.violations[0]
  return [
    `# Failure to repair`,
    ``,
    `- id: ${failure.id}`,
    `- component: ${failure.component}`,
    `- case: ${failure.fixtureCase}`,
    `- viewport: ${failure.viewport.cols}x${failure.viewport.rows}`,
    failure.fixturePath ? `- fixturePath: ${failure.fixturePath}` : '',
    ``,
    `## Violations`,
    ...failure.violations.map(
      (v) => `- ${v.rule} (${v.severity}): ${v.message}`,
    ),
    ``,
    `## Last frame`,
    '```',
    failure.asciiView,
    '```',
    ``,
    `## Suggested first step`,
    v0
      ? `Investigate rule '${v0.rule}'. Read the component source, find the ` +
        `layout primitive that produces the violation, propose a minimal ` +
        `edit, then call verify.`
      : `Investigate the component source, propose a minimal edit, then call verify.`,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

type ToolDispatchResult =
  | { kind: 'json'; payload: unknown }
  | { kind: 'verify_clean' }
  | { kind: 'error'; message: string }

async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: {
    failure: FailureRecord
    cwd: string
    editLog: EditLog
  },
): Promise<ToolDispatchResult> {
  try {
    switch (name) {
      case 'read_file':
        return dispatchReadFile(input, ctx.cwd)
      case 'grep':
        return dispatchGrep(input, ctx.cwd)
      case 'edit_file':
        return dispatchEditFile(input, ctx.cwd, ctx.editLog)
      case 'verify':
        return await dispatchVerify(ctx.failure, ctx.cwd)
      default:
        return { kind: 'error', message: `unknown tool '${name}'` }
    }
  } catch (err) {
    return { kind: 'error', message: (err as Error).message }
  }
}

function dispatchReadFile(
  input: Record<string, unknown>,
  cwd: string,
): ToolDispatchResult {
  const p = typeof input.path === 'string' ? input.path : ''
  if (!p) return { kind: 'error', message: 'read_file: missing path' }
  const abs = path.isAbsolute(p) ? p : path.join(cwd, p)
  const content = readFileSync(abs, 'utf8')
  return { kind: 'json', payload: { content } }
}

function dispatchGrep(
  input: Record<string, unknown>,
  cwd: string,
): ToolDispatchResult {
  const pattern = typeof input.pattern === 'string' ? input.pattern : ''
  if (!pattern) return { kind: 'error', message: 'grep: missing pattern' }
  const glob =
    typeof input.glob === 'string' && input.glob.length > 0
      ? (input.glob as string)
      : '**/*.{ts,tsx,js,jsx}'
  const matches = grepFiles(cwd, pattern, glob, 200)
  return { kind: 'json', payload: { matches } }
}

function dispatchEditFile(
  input: Record<string, unknown>,
  cwd: string,
  editLog: EditLog,
): ToolDispatchResult {
  const p = typeof input.path === 'string' ? input.path : ''
  const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
  const newStr = typeof input.new_string === 'string' ? input.new_string : ''
  if (!p || !oldStr) {
    return {
      kind: 'json',
      payload: { ok: false, error: 'edit_file: missing path or old_string' },
    }
  }
  const abs = path.isAbsolute(p) ? p : path.join(cwd, p)
  const before = readFileSync(abs, 'utf8')
  const idx = before.indexOf(oldStr)
  if (idx === -1) {
    return {
      kind: 'json',
      payload: { ok: false, error: `edit_file: old_string not found in ${p}` },
    }
  }
  if (before.indexOf(oldStr, idx + oldStr.length) !== -1) {
    return {
      kind: 'json',
      payload: {
        ok: false,
        error: `edit_file: old_string not unique in ${p}`,
      },
    }
  }
  const after = before.replace(oldStr, newStr)
  writeFileSync(abs, after, 'utf8')
  editLog.push({ path: abs, before, after, reason: 'subagent edit' })
  return { kind: 'json', payload: { ok: true } }
}

async function dispatchVerify(
  failure: FailureRecord,
  cwd: string,
): Promise<ToolDispatchResult> {
  if (!failure.fixturePath) {
    return {
      kind: 'json',
      payload: {
        clean: false,
        violations: [
          {
            rule: 'verify_no_fixture_path',
            severity: 'error',
            message:
              'failure.fixturePath is unset — the verify tool cannot re-mount.',
          } satisfies Violation,
        ],
      },
    }
  }
  const res = await verify({
    fixturePath: failure.fixturePath,
    caseName: failure.fixtureCase,
    viewport: failure.viewport,
    cwd,
  })
  if (res.clean) return { kind: 'verify_clean' }
  return { kind: 'json', payload: { clean: false, violations: res.violations } }
}

// ---------------------------------------------------------------------------
// Lightweight grep (no shell)
// ---------------------------------------------------------------------------

function grepFiles(
  cwd: string,
  pattern: string,
  glob: string,
  limit: number,
): Array<{ file: string; line: number; text: string }> {
  // The subagent's grep is best-effort and intentionally small — it walks
  // the project under cwd and collects matches up to `limit`. The model
  // gets exact files+lines but no shell access. We avoid execa/spawn so
  // verify's hard "no subprocess" sibling promise survives at module
  // level (subagent imports verify — we don't want verify's surface to
  // drag in subprocess deps via this file).
  const out: Array<{ file: string; line: number; text: string }> = []
  let re: RegExp
  try {
    re = new RegExp(pattern, 'm')
  } catch {
    // Treat as literal substring search if regex compilation fails.
    re = new RegExp(escapeRegExp(pattern), 'm')
  }
  walk(cwd, (file) => {
    if (out.length >= limit) return
    if (!matchesGlob(path.relative(cwd, file), glob)) return
    try {
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      for (let i = 0; i < lines.length && out.length < limit; i++) {
        if (re.test(lines[i]!)) {
          out.push({ file, line: i + 1, text: lines[i]!.slice(0, 200) })
        }
      }
    } catch {
      /* unreadable file, skip */
    }
  })
  return out
}

function walk(
  dir: string,
  visit: (file: string) => void,
  depth = 0,
): void {
  if (depth > 8) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (
      name === 'node_modules' ||
      name === '.git' ||
      name === 'dist' ||
      name === 'coverage' ||
      name.startsWith('.tmp-')
    ) {
      continue
    }
    const full = path.join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, visit, depth + 1)
    else visit(full)
  }
}

function matchesGlob(relPath: string, glob: string): boolean {
  // Very small glob: '**/*.{ts,tsx,js,jsx}' style only. We rebuild a regex.
  const re = globToRegExp(glob)
  return re.test(relPath)
}

function globToRegExp(glob: string): RegExp {
  // Translate a tiny subset: **, *, ?, {a,b,c}, literal segments.
  let s = ''
  let i = 0
  while (i < glob.length) {
    const ch = glob[i]!
    if (ch === '*' && glob[i + 1] === '*') {
      s += '.*'
      i += 2
      if (glob[i] === '/') i++
    } else if (ch === '*') {
      s += '[^/]*'
      i++
    } else if (ch === '?') {
      s += '[^/]'
      i++
    } else if (ch === '{') {
      const end = glob.indexOf('}', i)
      if (end < 0) {
        s += escapeRegExp(ch)
        i++
      } else {
        const inner = glob.slice(i + 1, end)
        const parts = inner.split(',').map(escapeRegExp)
        s += `(?:${parts.join('|')})`
        i = end + 1
      }
    } else {
      s += escapeRegExp(ch)
      i++
    }
  }
  return new RegExp('^' + s + '$')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/**
 * Drive the Opus tool-use loop until verify reports clean (or the turn
 * / time budget is exhausted).
 */
export async function runRepairSubagent(
  opts: SubagentOpts,
): Promise<RepairSubagentResult> {
  const {
    failure,
    cwd,
    apiKey,
    maxTurns = 20,
    timeoutMs = 300000,
    _client,
    _now,
  } = opts

  const client: ClientFn = _client ?? defaultClient
  const now: () => number = _now ?? (() => Date.now())

  const startedAt = now()
  const editLog: EditLog = []

  const messages: ToolMessage[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: buildInitialUserMessage(failure) }],
    },
  ]

  let turn = 0
  let status: RepairStatus = 'exhausted'
  let summary = ''

  while (turn < maxTurns) {
    // Wall-clock guard — check before each model call. We never start a
    // turn we can't expect to finish within budget.
    if (now() - startedAt > timeoutMs) {
      status = 'timeout'
      summary = `Subagent timed out after ${turn} turns ` +
        `(elapsed=${now() - startedAt}ms > timeoutMs=${timeoutMs}).`
      return { status, edits: editLog, summary }
    }
    turn++

    let response: Awaited<ReturnType<ClientFn>>
    try {
      response = await client({
        apiKey,
        model: 'claude-opus-4-7',
        system: buildSystemPrompt(),
        messages,
        tools: TOOLS,
        maxTokens: 4096,
      })
    } catch (err) {
      // Treat upstream API errors as a non-fatal "exhausted" outcome so
      // the caller can decide whether to retry. The summary records the
      // error so the dump annotation is useful.
      summary = `Subagent halted after ${turn} turns: ${(err as Error).message}`
      return { status: 'exhausted', edits: editLog, summary }
    }

    // Record the assistant turn in the conversation.
    messages.push({ role: 'assistant', content: response.content })

    // Collect any text the model emitted as the rolling summary; the
    // last assistant text block wins so the final summary reflects the
    // model's terminal observation.
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) summary = block.text
    }

    if (response.stop_reason !== 'tool_use') {
      // Model finished without invoking a tool — treat as exhausted; we
      // never reached verify-clean.
      status = 'exhausted'
      if (!summary) summary = 'Subagent ended without invoking verify.'
      return { status, edits: editLog, summary }
    }

    // Execute every tool_use block in order, build the user tool_result.
    const toolResultBlocks: ContentBlock[] = []
    let verifiedClean = false

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const result = await dispatchTool(block.name, block.input, {
        failure,
        cwd,
        editLog,
      })
      const resultText =
        result.kind === 'verify_clean'
          ? JSON.stringify({ clean: true })
          : result.kind === 'error'
            ? JSON.stringify({ error: result.message })
            : JSON.stringify(result.payload).slice(0, 64 * 1024)
      const tr: ContentBlock = {
        type: 'tool_result',
        tool_use_id: block.id,
        content: resultText,
        ...(result.kind === 'error' ? { is_error: true } : {}),
      }
      toolResultBlocks.push(tr)
      if (result.kind === 'verify_clean') verifiedClean = true
    }

    messages.push({ role: 'user', content: toolResultBlocks })

    if (verifiedClean) {
      status = 'verified'
      if (!summary) {
        summary = `Subagent reached verify-clean after ${turn} turn(s) ` +
          `with ${editLog.length} edit(s).`
      }
      return { status, edits: editLog, summary }
    }
  }

  // Out of the loop without verify-clean → exhausted.
  if (!summary) {
    summary = `Subagent exhausted ${maxTurns} turns without reaching verify-clean.`
  }
  return { status: 'exhausted', edits: editLog, summary }
}
