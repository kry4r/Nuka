// src/core/jsonFormat/jsonFormat.ts
//
// Pretty JSON formatter — pure logic, no React/ink, no LLM, no filesystem.
// Useful for tool output rendering, diagnostic dumps, prompt-context
// snippets, and anywhere "show me this object in human-legible form"
// would otherwise reach for `JSON.stringify(x, null, 2)`.
//
// Why a dedicated module? `JSON.stringify(x, null, 2)` is good enough
// for trivial values but loses on every realistic shape:
//
//   • short arrays/objects always expand to one-key-per-line, eating
//     vertical real estate where a single line would have been clearer
//   • cycles throw TypeError, taking the whole render down with them
//   • there is no way to cap depth — printing a deeply-nested object
//     dumps the whole tree, even if the consumer only wanted a sketch
//   • there is no way to cap array length — a 10k-element array fills
//     the entire terminal scrollback and pushes context out
//   • there is no way to cap string length — a 100KB string in some
//     leaf node makes the dump useless
//   • key order is "insertion" which is unstable for objects built
//     out of merges, and useless for diffs
//   • there is no hook for wrapping values in marker tags (e.g.,
//     "<num>42</num>") — downstream consumers that want colour have
//     no anchor to bind to
//
// This module is a hand-rolled recursive descent that addresses all
// of the above. NO ANSI is ever emitted — markers are plain string
// tags, exactly per the scope rules. Coloring is a downstream concern.
//
// Compatibility notes for primitives:
//
//   • `undefined` is rendered as `null` (matches the JSON spec — there
//     is no undefined; matches what JSON.stringify does for array
//     slots; differs only for object values, where JSON.stringify
//     drops the key entirely — we keep it as `null` so the shape of
//     the object remains visible).
//   • `NaN` / `Infinity` / `-Infinity` render as `null` by default,
//     mirroring JSON.stringify. Pass `nonFiniteAsString: true` to
//     render them as quoted strings (`"NaN"`, `"Infinity"`).
//   • `bigint` renders as a quoted decimal string by default. Pass
//     `bigintHandler: 'throw'` to get the same behaviour as JSON.stringify
//     (TypeError) or pass a function for custom handling.
//   • Functions, symbols, and class instances follow JSON.stringify
//     semantics: dropped from objects, become `null` in arrays.
//
// Cycle handling defaults to a `"[Circular]"` placeholder. Pass
// `cycleHandler: 'throw'` to fall back to TypeError, or a function
// `(path) => string` to compute a custom replacement.

/* eslint-disable @typescript-eslint/no-explicit-any -- value: unknown
   through the public surface; locally we widen to `any` for recursion
   nodes because TS can't narrow object literal indexing through
   `Record<string, unknown>` without per-call casts that hurt
   readability. The widening is contained inside this file. */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Marker tags emitted around primitive values. All markers are plain
 * strings — never ANSI bytes — so downstream code (the TUI layer, a
 * logger that adds colour, an HTML wrapper) can swap them out without
 * leaking escape codes into upstream consumers.
 *
 * When omitted, no markers are emitted. When partially supplied, only
 * the supplied pairs are emitted; missing pairs are inert.
 */
export interface JsonMarkers {
  /** Wraps numeric primitives (e.g. `"<num>"`/`"</num>"`). */
  numberOpen?: string
  numberClose?: string
  /** Wraps boolean primitives. */
  booleanOpen?: string
  booleanClose?: string
  /** Wraps the literal `null`. */
  nullOpen?: string
  nullClose?: string
  /** Wraps the literal `"..."` (the quote characters are inside the marker). */
  stringOpen?: string
  stringClose?: string
  /** Wraps object/array keys (just the `"key"` segment, no colon). */
  keyOpen?: string
  keyClose?: string
}

/**
 * Cycle policy. The default `'placeholder'` mode emits
 * `"[Circular]"` (a JSON string) where the cycle was detected so the
 * surrounding shape is preserved.
 *
 * `'throw'` matches `JSON.stringify`'s behaviour exactly.
 *
 * Pass a function for full control — it receives the path of the
 * cycle target (`['users', 0, 'self']`) and must return a JSON-safe
 * string (escaping is the caller's responsibility — return value is
 * emitted verbatim).
 */
export type CycleHandler =
  | 'placeholder'
  | 'throw'
  | ((path: (string | number)[]) => string)

/**
 * BigInt policy. The default `'string'` mode renders BigInts as quoted
 * decimal strings (`"123n"` → `"123"`). `'throw'` reproduces
 * JSON.stringify's TypeError. A function returns custom JSON text
 * (escaping is the caller's job).
 */
export type BigIntHandler =
  | 'string'
  | 'throw'
  | ((value: bigint) => string)

/** Key-ordering policy used by both `formatJSON` and `formatJSONCompact`. */
export type SortKeysOption =
  | false
  | true
  | ((a: string, b: string) => number)

/** Options for {@link formatJSON} and {@link formatJSONCompact}. */
export interface FormatJSONOptions {
  /**
   * Indentation width in spaces. Defaults to 2. Set to 0 for no
   * indentation (output becomes compact regardless of `maxLineLength`).
   * Negative values are clamped to 0.
   */
  indent?: number
  /**
   * Soft column budget. Arrays and objects whose single-line form
   * fits within this many cells are emitted inline; longer ones
   * expand to one element/key per line. Defaults to 80 for
   * `formatJSON`. Set to `Infinity` to force inline everywhere
   * (this is what `formatJSONCompact` does by default).
   *
   * Note: the budget is *display width* in the .length sense — we do
   * not call into `string-width` here because we want a self-contained
   * deterministic implementation. ANSI-bearing strings should be
   * stripped upstream; markers themselves are excluded from the
   * width calculation (so a `<num>42</num>` only consumes 2 cells).
   */
  maxLineLength?: number
  /**
   * Maximum nesting depth. Nodes at depth ≥ `maxDepth` are replaced
   * with the literal string `"…"` (one Unicode ellipsis character).
   * Defaults to `Infinity` — no truncation.
   *
   * Depth counts every nesting step into an array or object; the
   * root value is at depth 0.
   */
  maxDepth?: number
  /**
   * Maximum array length. Arrays longer than this are truncated to
   * the first `maxArrayLength` elements and a final `"…, +N more"`
   * placeholder. Defaults to `Infinity`.
   */
  maxArrayLength?: number
  /**
   * Maximum string length (characters, not display width). Strings
   * longer than this are truncated to the first `maxStringLength`
   * characters and a final `"…+N"` suffix INSIDE the quotes.
   * Defaults to `Infinity`.
   */
  maxStringLength?: number
  /**
   * Key ordering for objects.
   *   • `false` (default) — insertion order
   *   • `true` — alphabetical ascending
   *   • function — custom comparator (same shape as Array.sort)
   */
  sortKeys?: SortKeysOption
  /**
   * Cycle policy. See {@link CycleHandler}.
   */
  cycleHandler?: CycleHandler
  /**
   * BigInt policy. See {@link BigIntHandler}.
   */
  bigintHandler?: BigIntHandler
  /**
   * If `true`, render `NaN` / `Infinity` / `-Infinity` as the quoted
   * strings `"NaN"` / `"Infinity"` / `"-Infinity"`. If `false`
   * (default), render them as `null` — matching JSON.stringify.
   */
  nonFiniteAsString?: boolean
  /**
   * Marker tags wrapping primitive values. See {@link JsonMarkers}.
   */
  markers?: JsonMarkers
}

// ---------------------------------------------------------------------------
// Internal context
// ---------------------------------------------------------------------------

interface ResolvedOptions {
  indent: number
  indentString: string
  maxLineLength: number
  maxDepth: number
  maxArrayLength: number
  maxStringLength: number
  sortKeys: SortKeysOption
  cycleHandler: CycleHandler
  bigintHandler: BigIntHandler
  nonFiniteAsString: boolean
  markers: JsonMarkers
}

function resolveOptions(opts: FormatJSONOptions | undefined): ResolvedOptions {
  const indentRaw = opts?.indent
  const indent =
    indentRaw === undefined
      ? 2
      : !Number.isFinite(indentRaw) || indentRaw < 0
        ? 0
        : Math.floor(indentRaw)
  return {
    indent,
    indentString: ' '.repeat(indent),
    maxLineLength: opts?.maxLineLength ?? 80,
    maxDepth: opts?.maxDepth ?? Number.POSITIVE_INFINITY,
    maxArrayLength: opts?.maxArrayLength ?? Number.POSITIVE_INFINITY,
    maxStringLength: opts?.maxStringLength ?? Number.POSITIVE_INFINITY,
    sortKeys: opts?.sortKeys ?? false,
    cycleHandler: opts?.cycleHandler ?? 'placeholder',
    bigintHandler: opts?.bigintHandler ?? 'string',
    nonFiniteAsString: opts?.nonFiniteAsString ?? false,
    markers: opts?.markers ?? {},
  }
}

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

function wrap(
  open: string | undefined,
  close: string | undefined,
  body: string,
): string {
  if (!open && !close) return body
  return `${open ?? ''}${body}${close ?? ''}`
}

/**
 * Total character-count width of a value as currently serialized
 * MINUS the marker bytes. Used for the inline-fit budget so that
 * marker emission doesn't push a value that fits-without-markers
 * onto multiple lines.
 *
 * We compute this incrementally for raw primitives (no markers in
 * play); the markers are stripped here by tracking length sans the
 * specific marker pair.
 */
function widthExcludingMarkers(
  body: string,
  open: string | undefined,
  close: string | undefined,
): number {
  // body already excludes markers; this helper is for clarity at
  // call sites — we always feed it the bare primitive text.
  void open
  void close
  return body.length
}

// ---------------------------------------------------------------------------
// Primitive emission
// ---------------------------------------------------------------------------

function emitString(value: string, ctx: ResolvedOptions): { text: string; width: number } {
  const capped =
    value.length > ctx.maxStringLength
      ? value.slice(0, ctx.maxStringLength) + `…+${value.length - ctx.maxStringLength}`
      : value
  // JSON.stringify on a single string is the cheapest correct escape;
  // it handles control bytes, surrogate pairs, and the standard set
  // of \u escapes exactly the way every other JSON consumer expects.
  const quoted = JSON.stringify(capped)
  const body = quoted ?? '""'
  const text = wrap(ctx.markers.stringOpen, ctx.markers.stringClose, body)
  return { text, width: widthExcludingMarkers(body, ctx.markers.stringOpen, ctx.markers.stringClose) }
}

function emitNumber(value: number, ctx: ResolvedOptions): { text: string; width: number } {
  let body: string
  if (Number.isNaN(value)) {
    body = ctx.nonFiniteAsString ? '"NaN"' : 'null'
  } else if (value === Number.POSITIVE_INFINITY) {
    body = ctx.nonFiniteAsString ? '"Infinity"' : 'null'
  } else if (value === Number.NEGATIVE_INFINITY) {
    body = ctx.nonFiniteAsString ? '"-Infinity"' : 'null'
  } else {
    body = String(value)
  }
  // If the value reduced to "null", emit it via the null markers
  // rather than the number markers — otherwise a downstream
  // colourer that paints `<num>null</num>` red would be lying about
  // the value's kind.
  if (body === 'null') {
    const wrapped = wrap(ctx.markers.nullOpen, ctx.markers.nullClose, body)
    return { text: wrapped, width: body.length }
  }
  const wrapped = wrap(ctx.markers.numberOpen, ctx.markers.numberClose, body)
  return { text: wrapped, width: body.length }
}

function emitBoolean(value: boolean, ctx: ResolvedOptions): { text: string; width: number } {
  const body = value ? 'true' : 'false'
  return {
    text: wrap(ctx.markers.booleanOpen, ctx.markers.booleanClose, body),
    width: body.length,
  }
}

function emitNull(ctx: ResolvedOptions): { text: string; width: number } {
  const body = 'null'
  return {
    text: wrap(ctx.markers.nullOpen, ctx.markers.nullClose, body),
    width: body.length,
  }
}

function emitBigInt(
  value: bigint,
  ctx: ResolvedOptions,
): { text: string; width: number } {
  let body: string
  if (ctx.bigintHandler === 'throw') {
    throw new TypeError('Do not know how to serialize a BigInt')
  } else if (ctx.bigintHandler === 'string') {
    body = JSON.stringify(value.toString())
  } else {
    body = ctx.bigintHandler(value)
  }
  return {
    text: wrap(ctx.markers.numberOpen, ctx.markers.numberClose, body),
    width: body.length,
  }
}

function emitKey(key: string, ctx: ResolvedOptions): { text: string; width: number } {
  const body = JSON.stringify(key)
  return {
    text: wrap(ctx.markers.keyOpen, ctx.markers.keyClose, body),
    width: body.length,
  }
}

// ---------------------------------------------------------------------------
// Core recursive emit
// ---------------------------------------------------------------------------

/**
 * Result of serializing a single node. `width` is the display width
 * if the value were on a single line, EXCLUDING any markers — used
 * for the inline-fit budget. `multiline` flags that the text already
 * spans multiple lines and must not be re-inlined (e.g. a child that
 * had to expand bubbles the multiline flag up to its parent).
 */
interface EmitResult {
  text: string
  /** Display width if the text is on a single line. */
  width: number
  multiline: boolean
}

function emit(
  value: unknown,
  depth: number,
  ctx: ResolvedOptions,
  ancestors: Set<object>,
  path: (string | number)[],
): EmitResult {
  // null
  if (value === null) {
    const { text, width } = emitNull(ctx)
    return { text, width, multiline: false }
  }
  // undefined → null (per JSON.stringify semantics)
  if (value === undefined) {
    const { text, width } = emitNull(ctx)
    return { text, width, multiline: false }
  }
  const t = typeof value
  if (t === 'string') {
    const { text, width } = emitString(value as string, ctx)
    return { text, width, multiline: false }
  }
  if (t === 'number') {
    const { text, width } = emitNumber(value as number, ctx)
    return { text, width, multiline: false }
  }
  if (t === 'boolean') {
    const { text, width } = emitBoolean(value as boolean, ctx)
    return { text, width, multiline: false }
  }
  if (t === 'bigint') {
    const { text, width } = emitBigInt(value as bigint, ctx)
    return { text, width, multiline: false }
  }
  if (t === 'function' || t === 'symbol') {
    // JSON.stringify replaces these with null in arrays / drops in
    // objects. We're handling array vs object higher up, so here the
    // safe choice for a standalone value is null.
    const { text, width } = emitNull(ctx)
    return { text, width, multiline: false }
  }

  // Object / array path.
  if (depth >= ctx.maxDepth) {
    const placeholder = JSON.stringify('…')
    return { text: placeholder, width: placeholder.length, multiline: false }
  }

  const obj = value as object
  if (ancestors.has(obj)) {
    return handleCycle(ctx, path)
  }

  // Honor a custom toJSON, matching JSON.stringify behaviour. We use
  // the resulting value for everything downstream (markers, depth,
  // cycle tracking still apply to the toJSON return).
  const withToJSON = obj as { toJSON?: (key?: string) => unknown }
  if (typeof withToJSON.toJSON === 'function') {
    const replaced = withToJSON.toJSON()
    if (replaced !== obj) {
      // Don't recursively call toJSON on the same proxy — only one hop.
      ancestors.add(obj)
      try {
        return emit(replaced, depth, ctx, ancestors, path)
      } finally {
        ancestors.delete(obj)
      }
    }
  }

  if (Array.isArray(value)) {
    return emitArray(value, depth, ctx, ancestors, path)
  }
  if (isPlainishObject(value)) {
    return emitObject(value as Record<string, unknown>, depth, ctx, ancestors, path)
  }
  // Map / Set / Date / regexp fall back to the toJSON hook if they
  // have one (Date does), otherwise to `{}` — same as JSON.stringify.
  return emitObject(value as Record<string, unknown>, depth, ctx, ancestors, path)
}

function handleCycle(
  ctx: ResolvedOptions,
  path: (string | number)[],
): EmitResult {
  if (ctx.cycleHandler === 'throw') {
    throw new TypeError('Converting circular structure to JSON')
  }
  let body: string
  if (ctx.cycleHandler === 'placeholder') {
    body = JSON.stringify('[Circular]')
  } else {
    body = ctx.cycleHandler(path)
  }
  return { text: body, width: body.length, multiline: false }
}

// ---------------------------------------------------------------------------
// Array / object emission
// ---------------------------------------------------------------------------

function emitArray(
  arr: unknown[],
  depth: number,
  ctx: ResolvedOptions,
  ancestors: Set<object>,
  path: (string | number)[],
): EmitResult {
  if (arr.length === 0) {
    return { text: '[]', width: 2, multiline: false }
  }

  ancestors.add(arr)
  try {
    const visible = arr.length > ctx.maxArrayLength ? ctx.maxArrayLength : arr.length
    const truncated = arr.length - visible

    const children: EmitResult[] = []
    for (let i = 0; i < visible; i++) {
      path.push(i)
      children.push(emit(arr[i], depth + 1, ctx, ancestors, path))
      path.pop()
    }

    const inline = renderArrayInline(children, truncated)
    const inlineWidth = inline.width
    const anyMultiline = children.some(c => c.multiline)

    const indentStr = ctx.indentString
    const headIndent = indentStr.repeat(depth)
    const itemIndent = indentStr.repeat(depth + 1)
    const inlineBudget = ctx.maxLineLength - headIndent.length

    if (
      !anyMultiline &&
      ctx.indent > 0 &&
      inlineWidth <= inlineBudget &&
      Number.isFinite(ctx.maxLineLength)
    ) {
      return { text: inline.text, width: inlineWidth, multiline: false }
    }
    // ctx.indent === 0 forces compact (no newlines) — keep inline regardless.
    if (ctx.indent === 0 && !anyMultiline) {
      return { text: inline.text, width: inlineWidth, multiline: false }
    }
    // Force-inline when budget is Infinity (formatJSONCompact behaviour).
    if (!Number.isFinite(ctx.maxLineLength) && !anyMultiline) {
      return { text: inline.text, width: inlineWidth, multiline: false }
    }

    // Multi-line.
    const parts: string[] = ['[']
    for (let i = 0; i < children.length; i++) {
      const sep =
        i < children.length - 1 || truncated > 0 ? ',' : ''
      const child = children[i]
      if (!child) continue
      parts.push('\n')
      parts.push(itemIndent)
      parts.push(child.text)
      parts.push(sep)
    }
    if (truncated > 0) {
      parts.push('\n')
      parts.push(itemIndent)
      parts.push(JSON.stringify(`…, +${truncated} more`))
    }
    parts.push('\n')
    parts.push(headIndent)
    parts.push(']')
    return { text: parts.join(''), width: inlineWidth, multiline: true }
  } finally {
    ancestors.delete(arr)
  }
}

function renderArrayInline(
  children: EmitResult[],
  truncated: number,
): { text: string; width: number } {
  const pieces: string[] = []
  let width = 2 // brackets
  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    if (!c) continue
    if (i > 0) {
      pieces.push(', ')
      width += 2
    }
    pieces.push(c.text)
    width += c.width
  }
  if (truncated > 0) {
    if (children.length > 0) {
      pieces.push(', ')
      width += 2
    }
    const tail = JSON.stringify(`…, +${truncated} more`)
    pieces.push(tail)
    width += tail.length
  }
  return { text: `[${pieces.join('')}]`, width }
}

function emitObject(
  obj: Record<string, unknown>,
  depth: number,
  ctx: ResolvedOptions,
  ancestors: Set<object>,
  path: (string | number)[],
): EmitResult {
  const allKeys = Object.keys(obj)
  // Strip keys whose values are functions or symbols — match
  // JSON.stringify (object form): they get dropped, not nulled.
  const keys = allKeys.filter(k => {
    const v = obj[k]
    const tv = typeof v
    return tv !== 'function' && tv !== 'symbol'
  })
  if (keys.length === 0) {
    return { text: '{}', width: 2, multiline: false }
  }

  if (ctx.sortKeys === true) {
    keys.sort()
  } else if (typeof ctx.sortKeys === 'function') {
    keys.sort(ctx.sortKeys)
  }

  ancestors.add(obj)
  try {
    const indentStr = ctx.indentString
    const headIndent = indentStr.repeat(depth)
    const childIndent = indentStr.repeat(depth + 1)
    const inlineBudget = ctx.maxLineLength - headIndent.length

    const entries: { key: EmitResult; value: EmitResult; rawKey: string }[] = []
    for (const k of keys) {
      path.push(k)
      const valueResult = emit(obj[k], depth + 1, ctx, ancestors, path)
      path.pop()
      const keyText = emitKey(k, ctx)
      entries.push({
        key: { text: keyText.text, width: keyText.width, multiline: false },
        value: valueResult,
        rawKey: k,
      })
    }

    const inline = renderObjectInline(entries)
    const anyMultiline = entries.some(e => e.value.multiline)

    if (
      !anyMultiline &&
      ctx.indent > 0 &&
      inline.width <= inlineBudget &&
      Number.isFinite(ctx.maxLineLength)
    ) {
      return { text: inline.text, width: inline.width, multiline: false }
    }
    if (ctx.indent === 0 && !anyMultiline) {
      return { text: inline.text, width: inline.width, multiline: false }
    }
    if (!Number.isFinite(ctx.maxLineLength) && !anyMultiline) {
      return { text: inline.text, width: inline.width, multiline: false }
    }

    // Multi-line.
    const parts: string[] = ['{']
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry) continue
      parts.push('\n')
      parts.push(childIndent)
      parts.push(entry.key.text)
      parts.push(': ')
      parts.push(entry.value.text)
      if (i < entries.length - 1) parts.push(',')
    }
    parts.push('\n')
    parts.push(headIndent)
    parts.push('}')
    return { text: parts.join(''), width: inline.width, multiline: true }
  } finally {
    ancestors.delete(obj)
  }
}

function renderObjectInline(
  entries: { key: EmitResult; value: EmitResult }[],
): { text: string; width: number } {
  const pieces: string[] = []
  let width = 2 // braces
  if (entries.length > 0) {
    width += 2 // inner padding "{ ... }"
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    if (i > 0) {
      pieces.push(', ')
      width += 2
    }
    pieces.push(entry.key.text)
    pieces.push(': ')
    pieces.push(entry.value.text)
    width += entry.key.width + 2 + entry.value.width
  }
  if (entries.length === 0) {
    return { text: '{}', width: 2 }
  }
  return { text: `{ ${pieces.join('')} }`, width }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainishObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  // Don't treat Date / Map / Set / RegExp etc. as plain — they'd
  // serialize as `{}` either way (no enumerable own keys for the
  // useful ones), and toJSON handling above already covers Date.
  const proto = Object.getPrototypeOf(value)
  if (proto === null || proto === Object.prototype) return true
  // Allow class instances — they enumerate own keys like records.
  return true
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format a value as pretty-printed JSON.
 *
 * Short structures stay inline; longer ones expand onto multiple
 * lines. See {@link FormatJSONOptions} for the available knobs.
 *
 * @example
 *   formatJSON({ a: 1, b: [1, 2, 3] })
 *   // → '{ "a": 1, "b": [1, 2, 3] }'   (fits within maxLineLength)
 *
 *   formatJSON({ a: 1, b: [1, 2, 3] }, { maxLineLength: 10 })
 *   // → multi-line because the inline form is 26 cells
 */
export function formatJSON(
  value: unknown,
  opts?: FormatJSONOptions,
): string {
  const ctx = resolveOptions(opts)
  const result = emit(value, 0, ctx, new Set(), [])
  return result.text
}

/**
 * Format a value as compact JSON — inline-when-possible. Equivalent
 * to `formatJSON(value, { ...opts, maxLineLength: Infinity })`.
 */
export function formatJSONCompact(
  value: unknown,
  opts?: FormatJSONOptions,
): string {
  const ctx = resolveOptions({ ...opts, maxLineLength: Number.POSITIVE_INFINITY })
  const result = emit(value, 0, ctx, new Set(), [])
  return result.text
}
