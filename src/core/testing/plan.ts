// src/core/testing/plan.ts
//
// Phase 9 §5 — Plan YAML schema parser + validator.
//
// `parsePlan(yamlText)` returns a typed `Plan` or throws `PlanError`. The
// error carries line/column when the underlying YAML parse fails (the `yaml`
// package surfaces these via `YAMLParseError`). Schema-level errors (unknown
// step kind, missing `name`, malformed delta) carry a path and best-effort
// position derived by walking the document AST.
//
// We intentionally keep the schema small and explicit (no zod) — the runner
// reads these objects with type guards rather than re-validating.

import { parseDocument, isMap, isSeq, isScalar, LineCounter, type Document, type Node } from 'yaml'

// ---------------------------------------------------------------------------
// Public types — discriminated unions for steps & assertions.
// ---------------------------------------------------------------------------

export type AssertSpec =
  | { contains: string }
  | { notContains: string }
  | { regex: string }
  | { equals: string }
  | { frameCount: number }
  | { lastFrameMatches: { regex: string } | { contains: string } }

export type WaitSpec =
  | { ms: number }
  | { until: AssertSpec; timeoutMs?: number }

export type ProviderDelta = { type: 'text_delta'; text: string }

export type ProviderResponse = {
  delta: ProviderDelta[]
  /** Optional usage; folded into the synthetic `message_stop` event. */
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
}

export type Step =
  | { kind: 'render'; target: string }
  | { kind: 'keystroke'; chars: string }
  | { kind: 'wait'; spec: WaitSpec }
  | { kind: 'snapshot'; name: string }
  | { kind: 'assert'; spec: AssertSpec }
  | { kind: 'slash'; command: string }
  | { kind: 'mock'; append: ProviderResponse }

export type PlanSetup = {
  config?: unknown
  mockResponses?: ProviderResponse[]
  /**
   * Phase 10 §4.2 — opt-in slash command registration. Each entry is the
   * exported symbol name from `src/slash/*.ts` (e.g. `ThemeCommand`,
   * `PlanCommand`). The runner imports & registers these so plans can
   * drive `/theme`, `/plan on`, etc., end-to-end.
   */
  slash?: string[]
}

export type Plan = {
  name: string
  description?: string
  setup?: PlanSetup
  mockResponses: ProviderResponse[]
  steps: Step[]
  cleanup?: { unmount?: boolean }
}

// ---------------------------------------------------------------------------
// PlanError — schema/parse errors.
// ---------------------------------------------------------------------------

export class PlanError extends Error {
  readonly line?: number
  readonly column?: number
  readonly path?: string
  constructor(message: string, opts: { line?: number; column?: number; path?: string } = {}) {
    super(message)
    this.name = 'PlanError'
    this.line = opts.line
    this.column = opts.column
    this.path = opts.path
  }
}

// ---------------------------------------------------------------------------
// parsePlan — top-level entry.
// ---------------------------------------------------------------------------

export function parsePlan(yamlText: string): Plan {
  const lineCounter = new LineCounter()
  const doc = parseDocument(yamlText, { prettyErrors: true, lineCounter })
  if (doc.errors.length > 0) {
    const e = doc.errors[0]!
    const pos = e.linePos?.[0]
    throw new PlanError(`yaml parse error: ${e.message}`, {
      line: pos?.line,
      column: pos?.col,
    })
  }
  const raw = doc.toJS({ maxAliasCount: -1 })
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PlanError('plan must be a mapping at the document root')
  }
  return validatePlan(raw as Record<string, unknown>, doc, lineCounter)
}

function validatePlan(o: Record<string, unknown>, doc: Document, lc: LineCounter): Plan {
  const name = o['name']
  if (typeof name !== 'string' || name.length === 0) {
    throw new PlanError('plan: missing required field "name"', { path: 'name', ...positionFor(doc, ['name'], lc) })
  }
  const description = typeof o['description'] === 'string' ? (o['description'] as string) : undefined

  const setup = o['setup'] !== undefined ? validateSetup(o['setup'], doc, lc) : undefined
  // Top-level `mockResponses` is an alias for `setup.mockResponses` — accept either.
  const topMocks = o['mockResponses'] !== undefined
    ? validateMockResponses(o['mockResponses'], 'mockResponses', doc, lc)
    : []
  const setupMocks = setup?.mockResponses ?? []
  const mockResponses = [...topMocks, ...setupMocks]

  const stepsRaw = o['steps']
  if (!Array.isArray(stepsRaw)) {
    throw new PlanError('plan: "steps" must be an array', { path: 'steps', ...positionFor(doc, ['steps'], lc) })
  }
  const steps: Step[] = stepsRaw.map((s, i) => validateStep(s, i, doc, lc))

  const cleanupRaw = o['cleanup']
  let cleanup: Plan['cleanup']
  if (cleanupRaw !== undefined) {
    if (cleanupRaw === null || typeof cleanupRaw !== 'object' || Array.isArray(cleanupRaw)) {
      throw new PlanError('plan: "cleanup" must be a mapping', { path: 'cleanup', ...positionFor(doc, ['cleanup'], lc) })
    }
    const c = cleanupRaw as Record<string, unknown>
    cleanup = {}
    if (c['unmount'] !== undefined) {
      if (typeof c['unmount'] !== 'boolean') {
        throw new PlanError('cleanup.unmount must be a boolean', { path: 'cleanup.unmount' })
      }
      cleanup.unmount = c['unmount']
    }
  }

  const plan: Plan = { name, mockResponses, steps }
  if (description !== undefined) plan.description = description
  if (setup !== undefined) plan.setup = setup
  if (cleanup !== undefined) plan.cleanup = cleanup
  return plan
}

function validateSetup(v: unknown, doc: Document, lc: LineCounter): PlanSetup {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new PlanError('plan: "setup" must be a mapping', { path: 'setup', ...positionFor(doc, ['setup'], lc) })
  }
  const o = v as Record<string, unknown>
  const out: PlanSetup = {}
  if (o['config'] !== undefined) out.config = o['config']
  if (o['mockResponses'] !== undefined) {
    out.mockResponses = validateMockResponses(o['mockResponses'], 'setup.mockResponses', doc, lc)
  }
  if (o['slash'] !== undefined) {
    if (!Array.isArray(o['slash'])) {
      throw new PlanError('setup.slash: must be an array of slash-command export names', { path: 'setup.slash' })
    }
    const arr = o['slash'] as unknown[]
    out.slash = arr.map((n, i) => {
      if (typeof n !== 'string' || n.length === 0) {
        throw new PlanError(`setup.slash[${i}]: each entry must be a non-empty string`, { path: `setup.slash[${i}]` })
      }
      return n
    })
  }
  return out
}

function validateMockResponses(v: unknown, path: string, doc: Document, lc: LineCounter): ProviderResponse[] {
  if (!Array.isArray(v)) {
    throw new PlanError(`${path}: must be an array of responses`, { path, ...positionFor(doc, path.split('.'), lc) })
  }
  return v.map((r, i) => validateResponse(r, `${path}[${i}]`, doc))
}

function validateResponse(v: unknown, path: string, _doc: Document): ProviderResponse {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new PlanError(`${path}: response must be a mapping`, { path })
  }
  const o = v as Record<string, unknown>
  const deltaRaw = o['delta']
  if (!Array.isArray(deltaRaw)) {
    throw new PlanError(`${path}.delta: must be an array`, { path: `${path}.delta` })
  }
  const delta: ProviderDelta[] = deltaRaw.map((d, i) => validateDelta(d, `${path}.delta[${i}]`))
  const out: ProviderResponse = { delta }
  if (o['usage'] !== undefined) {
    out.usage = validateUsage(o['usage'], `${path}.usage`)
  }
  return out
}

function validateDelta(v: unknown, path: string): ProviderDelta {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new PlanError(`${path}: delta must be a mapping`, { path })
  }
  const o = v as Record<string, unknown>
  const t = o['type']
  if (t !== 'text_delta') {
    throw new PlanError(`${path}: only "text_delta" is supported (got ${JSON.stringify(t)})`, { path })
  }
  if (typeof o['text'] !== 'string') {
    throw new PlanError(`${path}.text: must be a string`, { path: `${path}.text` })
  }
  return { type: 'text_delta', text: o['text'] }
}

function validateUsage(v: unknown, path: string): ProviderResponse['usage'] {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new PlanError(`${path}: must be a mapping`, { path })
  }
  const o = v as Record<string, unknown>
  // Accept snake_case from YAML (per spec example) and normalize to camelCase.
  const input = o['inputTokens'] ?? o['input_tokens']
  const output = o['outputTokens'] ?? o['output_tokens']
  const cacheRead = o['cacheReadTokens'] ?? o['cache_read_tokens']
  const cacheWrite = o['cacheWriteTokens'] ?? o['cache_write_tokens']
  if (typeof input !== 'number' || typeof output !== 'number') {
    throw new PlanError(`${path}: input_tokens and output_tokens are required numbers`, { path })
  }
  const usage: NonNullable<ProviderResponse['usage']> = { inputTokens: input, outputTokens: output }
  if (typeof cacheRead === 'number') usage.cacheReadTokens = cacheRead
  if (typeof cacheWrite === 'number') usage.cacheWriteTokens = cacheWrite
  return usage
}

const KNOWN_STEP_KEYS = new Set([
  'render', 'keystroke', 'wait', 'snapshot', 'assert', 'slash', 'mock',
])

function validateStep(v: unknown, idx: number, doc: Document, lc: LineCounter): Step {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new PlanError(`steps[${idx}]: each step must be a mapping`, { path: `steps[${idx}]` })
  }
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
  // Identify which step-kind key is present.
  const kindKey = keys.find(k => KNOWN_STEP_KEYS.has(k))
  if (!kindKey) {
    const unknown = keys.find(k => !KNOWN_STEP_KEYS.has(k))
    throw new PlanError(
      `steps[${idx}]: unknown step kind ${JSON.stringify(unknown ?? keys[0])}; expected one of ${[...KNOWN_STEP_KEYS].join(', ')}`,
      { path: `steps[${idx}]`, ...positionFor(doc, ['steps', String(idx)], lc) },
    )
  }
  const value = o[kindKey]
  switch (kindKey) {
    case 'render': {
      if (typeof value !== 'string' || value.length === 0) {
        throw new PlanError(`steps[${idx}].render: must be a non-empty string`, { path: `steps[${idx}].render` })
      }
      return { kind: 'render', target: value }
    }
    case 'keystroke': {
      if (typeof value !== 'string') {
        throw new PlanError(`steps[${idx}].keystroke: must be a string`, { path: `steps[${idx}].keystroke` })
      }
      return { kind: 'keystroke', chars: value }
    }
    case 'wait': {
      return { kind: 'wait', spec: validateWait(value, `steps[${idx}].wait`) }
    }
    case 'snapshot': {
      if (typeof value !== 'string' || value.length === 0) {
        throw new PlanError(`steps[${idx}].snapshot: must be a non-empty name`, { path: `steps[${idx}].snapshot` })
      }
      return { kind: 'snapshot', name: value }
    }
    case 'assert': {
      return { kind: 'assert', spec: validateAssert(value, `steps[${idx}].assert`) }
    }
    case 'slash': {
      if (typeof value !== 'string' || value.length === 0) {
        throw new PlanError(`steps[${idx}].slash: must be a non-empty string`, { path: `steps[${idx}].slash` })
      }
      return { kind: 'slash', command: value }
    }
    case 'mock': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new PlanError(`steps[${idx}].mock: must be a mapping`, { path: `steps[${idx}].mock` })
      }
      const m = value as Record<string, unknown>
      const provider = m['provider']
      if (provider === null || typeof provider !== 'object' || Array.isArray(provider)) {
        throw new PlanError(`steps[${idx}].mock.provider: must be a mapping`, { path: `steps[${idx}].mock.provider` })
      }
      const append = (provider as Record<string, unknown>)['append']
      if (append === undefined) {
        throw new PlanError(`steps[${idx}].mock.provider.append: required`, { path: `steps[${idx}].mock.provider.append` })
      }
      return { kind: 'mock', append: validateResponse(append, `steps[${idx}].mock.provider.append`, doc) }
    }
    default:
      // Exhaustive — KNOWN_STEP_KEYS guards entry.
      throw new PlanError(`steps[${idx}]: unhandled step kind ${kindKey}`)
  }
}

function validateWait(v: unknown, path: string): WaitSpec {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new PlanError(`${path}: must be a mapping with "ms" or "until"`, { path })
  }
  const o = v as Record<string, unknown>
  if (typeof o['ms'] === 'number') {
    return { ms: o['ms'] }
  }
  if (o['until'] !== undefined) {
    const until = validateAssert(o['until'], `${path}.until`)
    const out: WaitSpec = { until }
    if (typeof o['timeoutMs'] === 'number') (out as { timeoutMs?: number }).timeoutMs = o['timeoutMs']
    return out
  }
  throw new PlanError(`${path}: must have "ms" (number) or "until" (assertion)`, { path })
}

function validateAssert(v: unknown, path: string): AssertSpec {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new PlanError(`${path}: assertion must be a mapping`, { path })
  }
  const o = v as Record<string, unknown>
  if (typeof o['contains'] === 'string') return { contains: o['contains'] }
  if (typeof o['notContains'] === 'string') return { notContains: o['notContains'] }
  if (typeof o['regex'] === 'string') return { regex: o['regex'] }
  if (typeof o['equals'] === 'string') return { equals: o['equals'] }
  if (typeof o['frameCount'] === 'number') return { frameCount: o['frameCount'] }
  if (o['lastFrameMatches'] !== undefined) {
    const lf = o['lastFrameMatches']
    if (lf === null || typeof lf !== 'object' || Array.isArray(lf)) {
      throw new PlanError(`${path}.lastFrameMatches: must be a mapping`, { path: `${path}.lastFrameMatches` })
    }
    const lfo = lf as Record<string, unknown>
    if (typeof lfo['regex'] === 'string') return { lastFrameMatches: { regex: lfo['regex'] } }
    if (typeof lfo['contains'] === 'string') return { lastFrameMatches: { contains: lfo['contains'] } }
    throw new PlanError(`${path}.lastFrameMatches: needs "regex" or "contains"`, { path: `${path}.lastFrameMatches` })
  }
  throw new PlanError(
    `${path}: assertion must specify one of contains/notContains/regex/equals/frameCount/lastFrameMatches`,
    { path },
  )
}

// ---------------------------------------------------------------------------
// AST navigation — best-effort line/col for schema errors. Walks the YAML
// document by key path and returns the position of the resolved node.
// ---------------------------------------------------------------------------

function positionFor(doc: Document, path: string[], lc?: LineCounter): { line?: number; column?: number } {
  if (!lc) return {}
  let node: Node | null | undefined = doc.contents as Node | null
  for (const seg of path) {
    if (node === null || node === undefined) break
    if (isMap(node)) {
      const items = node.items as Array<{ key: unknown; value: unknown }>
      const found = items.find(it => isScalar(it.key) && String((it.key as { value: unknown }).value) === seg)
      node = (found?.value as Node | null | undefined) ?? null
    } else if (isSeq(node)) {
      const idx = Number(seg)
      if (Number.isFinite(idx)) node = (node.items[idx] as Node | undefined) ?? null
      else node = null
    } else {
      node = null
    }
  }
  if (node) {
    const range = (node as { range?: [number, number, number] }).range
    if (range) {
      const pos = lc.linePos(range[0])
      return { line: pos.line, column: pos.col }
    }
  }
  return {}
}
