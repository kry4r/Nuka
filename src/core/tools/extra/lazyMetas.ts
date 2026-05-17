// src/core/tools/extra/lazyMetas.ts
//
// Lazy-tool metadata table — Phase P2 #12 bundle-size optimisation.
//
// Each entry holds the metadata the agent / registry / search index
// need at boot WITHOUT loading the implementation. The real `run` is
// supplied via a dynamic-import loader passed into `makeLazyTool`
// (see `src/core/tools/lazy.ts` and `src/cli.tsx`).
//
// ## Why duplicate the metadata?
//
// `src/cli.tsx` runs synchronously at boot. `ToolRegistry.register`
// needs a `Tool` object NOW; we can't `await import('./tools-extra.js')`
// before registering because that would defeat the purpose of the
// sidecar (the dynamic-import is what keeps the heavy bytes out of
// `dist/cli.js`). So the proxy needs the metadata inlined.
//
// The duplication is the cost of a static-vs-dynamic split. To stop
// drift, `test/build/lazyToolMetas.test.ts` loads the real tool
// modules and asserts every metadata field matches the source of
// truth. If a contributor updates the impl but not this file, the
// test fails with a precise diff.
//
// ## What lives here vs. eager
//
// IN-SCOPE (heavy text-utility tools, constant `needsPermission`,
// no module-load side-effects):
//   - WhitespaceTool, TruncateTool, JsonFormatTool, ShellQuoteTool,
//     SlugTool, UrlExtractTool, FormatDurationTool, CaseConvertTool,
//     WrapTextTool, AnsiStyleTool, TextStatsTool, CodeBlocksTool,
//     GlobMatchTool.
//
// OUT-OF-SCOPE (kept eager):
//   - bash / read / write / edit / glob / grep / webFetch — touch FS
//     or network; `needsPermission` depends on input.
//   - ApplyDiffTool / FindReplaceTool — `needsPermission` switches
//     between `'none'` and `'write'` based on input.dryRun (added to
//     sidecar in a separate registration that inlines the predicate).
//   - todoWrite / lsp*  — stateful (registry / manager closures).
//   - any plugin / skill tool — managed by their own loaders.

import type { LazyToolMetadata } from '../lazy'

type Meta = LazyToolMetadata<unknown>

// ---------------------------------------------------------------------------
// WhitespaceTool — `src/core/whitespace/whitespaceTool.ts`
// ---------------------------------------------------------------------------

export const whitespaceToolMeta: Meta = {
  name: 'Whitespace',
  description:
    'Clean up whitespace in a text string. Pure, idempotent on its own ' +
    'output, no IO. Pick `action`: ' +
    '`dedent` strips the longest common leading indent across non-blank ' +
    'lines (tab-aware via `tabWidth`, default 8) — returns `result` and ' +
    '`indentRemoved`; ' +
    '`trimTrailing` removes trailing spaces/tabs per line — returns ' +
    '`result` and `linesChanged`; ' +
    '`trimBlank` drops blank lines from both edges (preserves a single ' +
    'final newline) — returns `result`, `leadingTrimmed`, ' +
    '`trailingTrimmed`; ' +
    '`collapseBlank` caps consecutive blank-line runs at ' +
    '`maxConsecutive` (default 1, 0 removes blanks entirely); ' +
    "`normalizeEol` converts line endings — `to`='lf' (default) or " +
    "'crlf'; " +
    '`expandTabs` converts `\\t` to spaces at the next `tabWidth` ' +
    'multiple (default 8); ' +
    '`normalize` is a combined pipeline (expandTabs -> dedent -> ' +
    'trimTrailing -> collapseBlanks -> trimEdges -> lineEndings) with ' +
    'each step independently disable-able. ' +
    'Pure — no IO, parallel-safe.',
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: [
          'dedent',
          'trimTrailing',
          'trimBlank',
          'collapseBlank',
          'normalizeEol',
          'expandTabs',
          'normalize',
        ],
        description:
          'Which whitespace transform to apply. Every action takes ' +
          '`text`; per-action options listed below.',
      },
      text: {
        type: 'string',
        description:
          'Input text. Empty string is allowed (returns empty result). ' +
          'Required for every action.',
      },
      tabWidth: {
        type: 'number',
        description:
          "Used by action='dedent' and action='expandTabs'. Spaces per " +
          'tab stop. Default 8. Must be a positive integer.',
        minimum: 1,
      },
      maxConsecutive: {
        type: 'number',
        description:
          "action='collapseBlank': maximum consecutive blank lines to " +
          'permit. Default 1 (long runs collapse to one blank). 0 removes ' +
          'blank lines entirely. Must be a non-negative integer.',
        minimum: 0,
      },
      to: {
        type: 'string',
        enum: ['lf', 'crlf'],
        description:
          "action='normalizeEol': target line-ending style. Default 'lf'.",
      },
      dedent: {
        type: 'boolean',
        description:
          "action='normalize': run dedent step. Default true.",
      },
      trimTrailing: {
        type: 'boolean',
        description:
          "action='normalize': strip trailing horizontal whitespace per " +
          'line. Default true.',
      },
      collapseBlanks: {
        oneOf: [{ type: 'boolean' }, { type: 'number', minimum: 0 }],
        description:
          "action='normalize': collapse blank-line runs. true = default " +
          'cap 1; number = explicit cap; false = disable. Default true.',
      },
      lineEndings: {
        oneOf: [
          { type: 'string', enum: ['lf', 'crlf'] },
          { type: 'boolean', enum: [false] },
        ],
        description:
          "action='normalize': normalize line endings. 'lf' (default), " +
          "'crlf', or false to skip.",
      },
      trimEdges: {
        type: 'boolean',
        description:
          "action='normalize': trim leading/trailing blank lines. " +
          'Default true.',
      },
      expandTabs: {
        oneOf: [
          { type: 'number', minimum: 1 },
          { type: 'boolean', enum: [false] },
        ],
        description:
          "action='normalize': expand tabs to spaces using this width. " +
          'number = on; false = off. Default false (tabs preserved).',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'whitespace', 'text', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'whitespace',
    'dedent',
    'trim',
    'tabs',
    'spaces',
    'blank',
    'collapse',
    'normalize',
    'eol',
    'crlf',
    'lf',
  ],
  aliases: ['whitespace', 'clean_whitespace', 'normalize_whitespace'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// TruncateTool — `src/core/truncate/truncateTool.ts`
// ---------------------------------------------------------------------------

export const truncateToolMeta: Meta = {
  name: 'Truncate',
  description:
    "Shrink long text to a bounded length without splitting graphemes or " +
    "losing the tail. Grapheme-safe (Intl.Segmenter), so emoji clusters " +
    "and surrogate pairs survive intact. " +
    "Pick `action`: " +
    "`middle` keeps a head + tail and replaces the centre with a chars- " +
    "omitted marker (good for one-line error/path summaries — options: " +
    "`maxChars`, optional `headChars` / `tailChars`, optional literal " +
    "`ellipsis`); " +
    "`lines` keeps the first N + last M lines and replaces the middle " +
    "with a one-line marker (good for log dumps — options: `maxLines`, " +
    "optional `headLines` / `tailLines`, optional literal `ellipsis`); " +
    "`budget` keeps a prefix up to `maxChars` graphemes, preferring a " +
    "line break in the last 20% of the budget; " +
    "`smart` auto-picks middle vs lines based on the shape of the input " +
    "(options: `preferLineBoundary` default true, `preserveCodeFences` " +
    "to avoid orphaning a ``` opener). " +
    "Pure — no IO, parallel-safe.",
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: ['middle', 'lines', 'budget', 'smart'],
        description:
          "Which truncation strategy to run. Required fields per action: " +
          "middle/budget/smart -> text+maxChars; lines -> text+maxLines.",
      },
      text: {
        type: 'string',
        description:
          "Input text to truncate. Empty string is allowed (returns empty " +
          "result). Required for every action.",
      },
      maxChars: {
        type: 'number',
        description:
          "Maximum total length in grapheme clusters. Required for " +
          "action='middle' | 'budget' | 'smart'. Must be a positive " +
          "integer (>= 1).",
        minimum: 1,
      },
      headChars: {
        type: 'number',
        description:
          "action='middle': number of grapheme clusters to keep from the " +
          "head. When omitted (with tailChars), head + tail split the " +
          "remaining budget evenly. Must be a non-negative integer.",
        minimum: 0,
      },
      tailChars: {
        type: 'number',
        description:
          "action='middle': number of grapheme clusters to keep from the " +
          "tail. Same default behaviour as `headChars`. Must be a " +
          "non-negative integer.",
        minimum: 0,
      },
      ellipsis: {
        type: 'string',
        description:
          "Optional literal omission marker. Applied to action='middle' " +
          "and action='lines' (replaces the default `…[N chars omitted]…` " +
          "/ `…[N lines omitted]…` markers). The literal is used as-is — " +
          "the omitted-count is not interpolated.",
      },
      maxLines: {
        type: 'number',
        description:
          "Maximum total lines to keep. Required for action='lines'. Must " +
          "be a positive integer (>= 1).",
        minimum: 1,
      },
      headLines: {
        type: 'number',
        description:
          "action='lines': number of head lines to keep. When omitted " +
          "(with tailLines), head + tail split the remaining budget " +
          "evenly. Must be a non-negative integer.",
        minimum: 0,
      },
      tailLines: {
        type: 'number',
        description:
          "action='lines': number of tail lines to keep. Same default " +
          "behaviour as `headLines`. Must be a non-negative integer.",
        minimum: 0,
      },
      preferLineBoundary: {
        type: 'boolean',
        description:
          "action='smart': when true (default), if the input is multi-line " +
          "(>= 4 lines) and crosses the budget, switch to the line-based " +
          "strategy; otherwise middle-truncate.",
      },
      preserveCodeFences: {
        type: 'boolean',
        description:
          "action='smart': when true, if the input contains balanced ``` " +
          "fences that would be split mid-fence, switch to line-truncation " +
          "outside the fence to keep opener + closer together. " +
          "Best-effort — only `` ``` `` fences (not `~~~`) are detected. " +
          "Default false.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'truncate', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'truncate',
    'shrink',
    'shorten',
    'clip',
    'ellipsis',
    'omit',
    'budget',
    'grapheme',
  ],
  aliases: ['truncate_text', 'shrink_text'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// JsonFormatTool — `src/core/jsonFormat/jsonFormatTool.ts`
// ---------------------------------------------------------------------------

export const jsonFormatToolMeta: Meta = {
  name: 'JsonFormat',
  description:
    "Pretty-print a JSON value into a human-legible formatted string. " +
    "Pass `value` for an already-parsed JS value, OR `valueText` for a JSON " +
    "string (which the tool will parse first). Exactly one of the two is required. " +
    "Options: `indent` (default 2), `maxLineLength` (inline-vs-multiline budget, " +
    "default 80), `maxDepth` (ellipsis past depth), `maxArrayLength` (truncate " +
    "long arrays), `maxStringLength` (truncate long strings), `sortKeys` " +
    "(alphabetical key order), `compact` (single-line output). " +
    "Pure — no IO, parallel-safe. Prefer this over Bash + node JSON.stringify.",
  parameters: {
    type: 'object',
    properties: {
      value: {
        description:
          "A JSON-serializable value to pretty-print. Mutually exclusive with " +
          "`valueText` — provide exactly one.",
      },
      valueText: {
        type: 'string',
        description:
          "A JSON string. The tool will `JSON.parse` it before formatting. " +
          "On parse error, returns a structured `invalid JSON` error. " +
          "Mutually exclusive with `value` — provide exactly one.",
      },
      indent: {
        type: 'number',
        description:
          "Indentation width in spaces. Default 2. 0 forces compact output " +
          "regardless of `maxLineLength`.",
        minimum: 0,
      },
      maxLineLength: {
        type: 'number',
        description:
          "Soft column budget. Arrays/objects whose single-line form fits this " +
          "width stay inline; longer ones expand to multi-line. Default 80.",
        minimum: 0,
      },
      maxDepth: {
        type: 'number',
        description:
          "Maximum nesting depth before nodes are replaced with '…'. Root is " +
          "depth 0. Default Infinity (no truncation).",
        minimum: 0,
      },
      maxArrayLength: {
        type: 'number',
        description:
          "Maximum array length. Longer arrays show their first N elements then " +
          "'…, +K more'. Default Infinity (no truncation).",
        minimum: 0,
      },
      maxStringLength: {
        type: 'number',
        description:
          "Maximum string length (characters). Longer strings are truncated inline " +
          "with a '…+K' suffix inside the quotes. Default Infinity.",
        minimum: 0,
      },
      sortKeys: {
        type: 'boolean',
        description:
          "If true, object keys are emitted in alphabetical order. Default false " +
          "(insertion order, matching JSON.stringify).",
      },
      compact: {
        type: 'boolean',
        description:
          "If true, force a single-line (compact) rendering using formatJSONCompact. " +
          "Overrides `maxLineLength`. Default false.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'jsonFormat', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'json',
    'format',
    'pretty',
    'stringify',
    'dump',
    'render',
  ],
  aliases: ['format_json', 'json_format', 'pretty_json'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// ShellQuoteTool — `src/core/jsonEscape/shellQuoteTool.ts`
// ---------------------------------------------------------------------------

export const shellQuoteToolMeta: Meta = {
  name: 'ShellQuote',
  description:
    'POSIX-quote arguments and join them with a binary name to produce a shell-safe command string. Use this when interpolating user-supplied or otherwise untrusted strings into a Bash invocation.',
  parameters: {
    type: 'object',
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        description: 'Binary or built-in to invoke. Quoted with the same rules as each arg.',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments to pass to the binary. Each is POSIX-quoted individually.',
      },
      style: {
        type: 'string',
        enum: ['auto', 'single', 'double'],
        description:
          "Quoting style. 'auto' (default) emits the cheapest correct form; 'single' forces single-quoted; 'double' forces double-quoted.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'shell'],
  annotations: { readOnly: true },
  needsPermission: () => 'none',
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// SlugTool — `src/core/slug/slugTool.ts`
// ---------------------------------------------------------------------------

export const slugToolMeta: Meta = {
  name: 'Slug',
  description:
    'Convert an arbitrary string into a constrained identifier. ' +
    'Three strictness tiers via `action`: ' +
    "`slugify` produces a URL-safe slug (default strict ASCII [a-z0-9] + " +
    "separator; pass `unicode:true` to keep accented Latin / CJK; " +
    "options: `separator`, `lower`, `strict`, `unicode`, `maxLength`); " +
    "`safeFilename` produces a cross-platform filename — strips " +
    "Windows+POSIX forbidden chars `/ \\ : * ? \" < > |` plus C0 controls, " +
    "preserves case, dots, underscores, and (by default) the trailing " +
    ".ext (options: `replacement`, `preserveExtension`, `maxLength`); " +
    "`safeBranchName` produces a git-ref-format-clean branch name — drops " +
    "`..`, `~`, `^`, `:`, `?`, `*`, `[`, `\\`, leading `-`/`.`/`/`, " +
    "trailing `.lock`, etc. (options: `replacement`, `maxLength`). " +
    'All actions are pure — no IO, parallel-safe.',
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: ['slugify', 'safeFilename', 'safeBranchName'],
        description:
          'Which strictness tier to run. `slugify` -> URL slug; ' +
          '`safeFilename` -> cross-platform filename; ' +
          '`safeBranchName` -> git ref name. All require `text`.',
      },
      text: {
        type: 'string',
        description:
          'Input text to convert. Empty input returns empty output ' +
          '(callers needing a non-empty fallback must supply one).',
      },
      separator: {
        type: 'string',
        description:
          "action='slugify': single character used to join kept words. " +
          "Default '-'. Must be exactly one character (multi-char " +
          "separators would collide with the collapse pass).",
        minLength: 1,
      },
      lower: {
        type: 'boolean',
        description:
          "action='slugify': lower-case the output. Default true. Only " +
          "meaningful when `unicode:true`; strict ASCII path always " +
          "produces lowercase.",
      },
      strict: {
        type: 'boolean',
        description:
          "action='slugify': strict ASCII slug. Default true. When false, " +
          "the looser reject set keeps `.`, `_`, etc. Ignored when " +
          "`unicode:true` is set.",
      },
      unicode: {
        type: 'boolean',
        description:
          "action='slugify': preserve Unicode letters/digits (\\p{L} / " +
          "\\p{N}). Default false. When true, 'café résumé' survives as " +
          "'café-résumé'; CJK and Cyrillic survive too.",
      },
      replacement: {
        type: 'string',
        description:
          "action='safeFilename' (default '_') / 'safeBranchName' " +
          "(default '-'): single character used to replace forbidden " +
          "bytes. For safeBranchName, must be a git-safe char [A-Za-z0-9_.-].",
        minLength: 1,
      },
      preserveExtension: {
        type: 'boolean',
        description:
          "action='safeFilename': preserve the trailing '.ext' and only " +
          "sanitize the stem. Default true.",
      },
      maxLength: {
        type: 'number',
        description:
          'Maximum total length of the result. Each action applies its ' +
          "own default if omitted (slugify -> Infinity, safeFilename -> " +
          '255, safeBranchName -> 200). Must be a positive number.',
        exclusiveMinimum: 0,
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'slug', 'text', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'slug',
    'slugify',
    'filename',
    'branch',
    'safe',
    'sanitize',
    'identifier',
    'url',
    'ref',
  ],
  aliases: ['slugify', 'safe_name', 'sanitize'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// UrlExtractTool — `src/core/urlExtract/urlExtractTool.ts`
// ---------------------------------------------------------------------------

export const urlExtractToolMeta: Meta = {
  name: 'UrlExtract',
  description:
    'Scan arbitrary text for URLs / markdown links. Pure, prose-tolerant. ' +
    'Pick `action`: ' +
    "`extract` returns every URL hit in source order with " +
    '`{ url, start, end, kind, inMarkdownLink? }` records ' +
    "(kinds: http, ftp, mailto, file, bare-domain; trailing prose " +
    "punctuation trimmed, balanced parens respected, emails detected " +
    'as `mailto`); options: `kinds` (filter), `includeBareDomain`. ' +
    "`isUrl` returns a boolean — does `text` contain at least one URL " +
    "of the default kinds? " +
    "`extractMarkdownLinks` parses `[text](url)` and `[ref]: url` " +
    'constructs into `{ text, url, start, end, type }` records. ' +
    'All actions are pure — no IO, parallel-safe.',
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: ['extract', 'isUrl', 'extractMarkdownLinks'],
        description:
          'Which scan to run. `extract` returns every URL; `isUrl` ' +
          'returns a boolean; `extractMarkdownLinks` returns parsed ' +
          'markdown link records. All require `text`.',
      },
      text: {
        type: 'string',
        description:
          'Input text to scan. Empty string is allowed (returns an ' +
          'empty list / false).',
      },
      kinds: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['http', 'ftp', 'mailto', 'file', 'bare-domain'],
        },
        description:
          "action='extract': restrict the scan to these kinds. " +
          "Defaults to ['http', 'ftp', 'mailto']. Pass " +
          "'bare-domain' to pick up schemeless hosts; pass 'file' " +
          "to pick up file:// URIs.",
      },
      includeBareDomain: {
        type: 'boolean',
        description:
          "action='extract': shorthand for adding 'bare-domain' to " +
          '`kinds` so schemeless hostnames like `example.com` also ' +
          'fire. Defaults to false.',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'urlExtract', 'url', 'text'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'url',
    'urls',
    'link',
    'links',
    'extract',
    'markdown',
    'isUrl',
    'mailto',
    'email',
    'ftp',
    'http',
    'https',
    'domain',
  ],
  aliases: ['url_extract', 'extract_urls', 'find_urls'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// FormatDurationTool — `src/core/duration/durationTool.ts`
// ---------------------------------------------------------------------------

export const formatDurationToolMeta: Meta = {
  name: 'FormatDuration',
  description:
    "Convert between human-readable durations / timestamps / byte sizes and machine numbers. " +
    "Pick `action` based on what you need: " +
    "`format` renders ms as '1m 30s' / '1h' (use `precision`, `compact`, `verbose`); " +
    "`parse` inverts that ('1h 30m' -> 5400000 ms); " +
    "`approx` renders a relative-time delta (negative=past, positive=future) as '3s ago' / 'in 2h'; " +
    "`timestamp` renders a date (ms-since-epoch or ISO string) as ISO / short / date-only / time-only; " +
    "`bytes` renders a byte count as '1.5 KB' (use `decimals`). " +
    "All actions are pure — no IO, parallel-safe.",
  parameters: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['format', 'parse', 'approx', 'timestamp', 'bytes'],
        description:
          "Which conversion to run. Required fields per action: " +
          "format/approx -> `ms`; parse -> `text`; timestamp -> `date`; bytes -> `bytes`.",
      },
      ms: {
        type: 'number',
        description:
          "Milliseconds. Required for action='format' (duration) and action='approx' (delta: negative=past, positive=future).",
      },
      text: {
        type: 'string',
        description:
          "Human duration string. Required for action='parse'. Accepts '1h 30m', '1.5h', '90 minutes', '234ms', '-1h', etc.",
      },
      bytes: {
        type: 'number',
        description: "Byte count. Required for action='bytes'.",
      },
      date: {
        oneOf: [{ type: 'number' }, { type: 'string' }],
        description:
          "Date input for action='timestamp'. Either ms-since-epoch (number) or ISO 8601 string. UTC.",
      },
      precision: {
        type: 'number',
        description:
          "action='format': number of unit segments (default 2). 1 = most significant only. Infinity = all non-zero.",
        minimum: 1,
      },
      compact: {
        type: 'boolean',
        description: "action='format': drop spaces between units ('1h30m'). Default false.",
      },
      verbose: {
        type: 'boolean',
        description: "action='format': long unit names ('1 hour 30 minutes'). Default false.",
      },
      now: {
        type: 'number',
        description:
          "action='approx': reference epoch-ms for caller documentation. The `ms` field is interpreted as a delta directly — this field is not subtracted from it.",
      },
      timestampFormat: {
        type: 'string',
        enum: ['iso', 'short', 'date', 'time'],
        description:
          "action='timestamp' style. Default 'iso'. 'short'='YYYY-MM-DD HH:MM:SS', 'date'='YYYY-MM-DD', 'time'='HH:MM:SS'. All UTC.",
      },
      decimals: {
        type: 'number',
        description: "action='bytes': decimal places (default 1). Trailing zeros dropped.",
        minimum: 0,
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'duration', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'duration',
    'format',
    'parse',
    'timestamp',
    'bytes',
    'time',
    'human',
  ],
  aliases: ['format_duration', 'duration'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// CaseConvertTool — `src/core/caseConvert/caseConvertTool.ts`
// ---------------------------------------------------------------------------

export const caseConvertToolMeta: Meta = {
  name: 'CaseConvert',
  description:
    'Convert an identifier-like string between common case conventions. ' +
    'Pure, idempotent on its own form, no IO. Pick `action`: ' +
    '`camel` -> helloWorld; `pascal` -> HelloWorld; `kebab` -> hello-world; ' +
    '`snake` -> hello_world; `constant` -> HELLO_WORLD; ' +
    "`title` -> 'Hello World'; `lower` -> 'hello world'. Each converter " +
    'returns `{ result, detectedSourceCase }` so the caller can see what ' +
    'shape the input arrived in. ' +
    '`detect` returns `{ style }` where style is one of camel/pascal/' +
    'kebab/snake/constant/title/lower/mixed/unknown. ' +
    '`split` returns `{ words }` — the constituent words of the input, ' +
    'with case preserved (downstream converters re-case as needed). ' +
    'Acronyms: with `preserveAcronyms:true` (default), a run of ' +
    'consecutive uppercase letters is treated as one word unless ' +
    'followed by ≥2 lowercase letters — `parseHTTPResponse` splits as ' +
    "['parse','HTTP','Response'] and re-emits as parse-http-response. " +
    'With `preserveAcronyms:false`, every uppercase letter starts a new ' +
    "word. Note: converting *into* camel/pascal lower-cases the rest of " +
    'each word, so `parseHTTPResponse` -> camel returns ' +
    "`parseHttpResponse` (we have no metadata in the canonicalized form " +
    'to recover which segments were acronyms). ' +
    'Pure — no IO, parallel-safe.',
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: [
          'camel',
          'pascal',
          'kebab',
          'snake',
          'constant',
          'title',
          'lower',
          'detect',
          'split',
        ],
        description:
          'Which case transform / inspection to run. The seven case ' +
          'converters return `{ result, detectedSourceCase }`; `detect` ' +
          'returns `{ style }`; `split` returns `{ words }`. All require ' +
          '`text`.',
      },
      text: {
        type: 'string',
        description:
          'Input text. Empty string is allowed — converter actions ' +
          'return `result: ""`, `detect` returns `style: "unknown"`, ' +
          '`split` returns `words: []`.',
      },
      preserveAcronyms: {
        type: 'boolean',
        description:
          'Only consulted by converter actions and `split`. When true ' +
          '(default), a run of consecutive uppercase letters is treated ' +
          'as a single word unless followed by ≥2 lowercase letters — so ' +
          "`HTTPServer` splits as ['HTTP','Server'] and `parseURLs` as " +
          "['parse','URLs']. When false, every uppercase letter starts " +
          'a new word.',
      },
      locale: {
        type: 'string',
        description:
          'Only consulted by converter actions. BCP-47 locale tag (e.g. ' +
          "`'tr-TR'`) passed to `toLocaleLowerCase` / `toLocaleUpperCase`. " +
          'Use when you need locale-sensitive case mappings (Turkish ' +
          'dotted/dotless i, etc.). Defaults to invariant case mapping.',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'caseConvert', 'text', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'case',
    'caseConvert',
    'camel',
    'pascal',
    'kebab',
    'snake',
    'constant',
    'title',
    'identifier',
    'rename',
    'splitWords',
    'detectCase',
  ],
  aliases: ['case_convert', 'rename_case', 'recase'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// WrapTextTool — `src/core/wordWrap/wrapTextTool.ts`
// ---------------------------------------------------------------------------

export const wrapTextToolMeta: Meta = {
  name: 'WrapText',
  description:
    "Wrap text to fit a terminal column budget. Display-width aware: " +
    "ANSI escapes are zero-width, CJK / fullwidth glyphs count as 2, " +
    "ZWJ emoji and combining marks land on the right column. " +
    "Pick `action`: " +
    "`wrap` flows text into `width` cells per line (options: `breakWord` " +
    "hard-splits overlong words at grapheme boundaries, `indent` indents " +
    "every line, `hangingIndent` indents continuation lines only, " +
    "`preserveNewlines` treats input `\\n` as paragraph breaks); " +
    "`wrapWithPrefix` prepends `firstPrefix` to first line and " +
    "`continuationPrefix` to continuation lines of each paragraph " +
    "(blockquotes, bulleted lists). " +
    "Pure — no IO, parallel-safe.",
  parameters: {
    type: 'object',
    required: ['action', 'text', 'width'],
    properties: {
      action: {
        type: 'string',
        enum: ['wrap', 'wrapWithPrefix'],
        description:
          "Which wrap variant to run. `wrap` -> wrapText(); " +
          "`wrapWithPrefix` -> wrapWithPrefix(). Required fields per " +
          "action: wrap -> text+width; wrapWithPrefix -> text+width+" +
          "firstPrefix+continuationPrefix.",
      },
      text: {
        type: 'string',
        description:
          "Input text to wrap. Empty string is allowed (returns empty " +
          "result). Required for both actions.",
      },
      width: {
        type: 'number',
        description:
          "Target column budget per line in terminal cells. Must be a " +
          "positive integer (>= 1). Required for both actions.",
        minimum: 1,
      },
      breakWord: {
        type: 'boolean',
        description:
          "action='wrap': hard-break words wider than the budget at a " +
          "grapheme boundary (no surrogate-pair / emoji-cluster splits). " +
          "Default false (overlong words sit on their own line and " +
          "overflow, matching the 'don't mangle a URL' contract).",
      },
      indent: {
        type: 'number',
        description:
          "action='wrap': cells of leading indentation applied to every " +
          "output line. Default 0. Must be a non-negative integer.",
        minimum: 0,
      },
      hangingIndent: {
        type: 'number',
        description:
          "action='wrap': additional cells of leading indentation on the " +
          "SECOND and subsequent lines of each paragraph (useful for " +
          "list-style output). Stacks additively with `indent`. Default " +
          "0. Must be a non-negative integer.",
        minimum: 0,
      },
      preserveNewlines: {
        type: 'boolean',
        description:
          "action='wrap': treat input `\\n` as paragraph boundaries " +
          "(default true). When false, newlines are flattened to single " +
          "spaces and the input is flowed as one paragraph.",
      },
      firstPrefix: {
        type: 'string',
        description:
          "action='wrapWithPrefix': prefix prepended to the FIRST line " +
          "of every paragraph (e.g. '> ' for blockquote, '- ' for " +
          "bullet). Required for wrapWithPrefix. The prefix's display " +
          "width is subtracted from `width` so prefix + content fits.",
      },
      continuationPrefix: {
        type: 'string',
        description:
          "action='wrapWithPrefix': prefix prepended to SECOND and " +
          "subsequent lines of every paragraph (e.g. '> ' for " +
          "blockquote, '  ' to align under a bullet). Required for " +
          "wrapWithPrefix.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'wordWrap', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'wrap',
    'wordwrap',
    'word-wrap',
    'fold',
    'reflow',
    'columns',
    'width',
    'blockquote',
    'prefix',
  ],
  aliases: ['wrap_text', 'word_wrap'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// AnsiStyleTool — `src/core/ansi/ansiStyleTool.ts`
// ---------------------------------------------------------------------------

// Re-declared inline so the metadata table doesn't pull in the heavier
// ansiStyleTool module at boot. Drift-guarded by the lazyToolMetas test.
const ANSI_STYLE_ENUM = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray',
  'grey',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
  'bgBlack',
  'bgRed',
  'bgGreen',
  'bgYellow',
  'bgBlue',
  'bgMagenta',
  'bgCyan',
  'bgWhite',
  'bgBlackBright',
  'bgRedBright',
  'bgGreenBright',
  'bgYellowBright',
  'bgBlueBright',
  'bgMagentaBright',
  'bgCyanBright',
  'bgWhiteBright',
  'bold',
  'dim',
  'italic',
  'underline',
  'inverse',
  'hidden',
  'strikethrough',
]

export const ansiStyleToolMeta: Meta = {
  name: 'AnsiStyle',
  description:
    'Strip, detect, or apply ANSI escape sequences on a text string. ' +
    'Pure, no IO. Pick `action`: ' +
    '`strip` removes every ANSI escape (SGR colors, 256-color, ' +
    'true-color, cursor moves, hyperlinks, etc.) — returns `result` ' +
    'and `stripped` (chars removed); ' +
    '`has` returns a boolean — true iff at least one ANSI escape is ' +
    'present in the input; ' +
    '`apply` wraps the text with the SGR sequence for the requested ' +
    '`style` modifier, optionally composed with additional `extra` ' +
    'modifiers (composed outer→inner) — returns `result`, ' +
    '`colorsEnabled` (whether the global toggle was on at call time, ' +
    'since `apply` returns the plain text when the host is non-TTY ' +
    'and `FORCE_COLOR` is unset), and `modifiers` (the actual chain). ' +
    'Pure — no IO, parallel-safe.',
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: ['strip', 'has', 'apply'],
        description:
          'Which ANSI operation to perform. `strip` and `has` need only ' +
          '`text`; `apply` additionally requires `style` (and optionally ' +
          '`extra`).',
      },
      text: {
        type: 'string',
        description:
          'Input text. Empty string is allowed: `strip` returns `""`, ' +
          "`has` returns `false`, `apply` returns `\"\"` (the library's " +
          'wrap() short-circuits on empty input).',
      },
      style: {
        type: 'string',
        enum: ANSI_STYLE_ENUM,
        description:
          "action='apply': primary SGR modifier to wrap the text with. " +
          'One of the documented foreground colors (black, red, green, ' +
          'yellow, blue, magenta, cyan, white, gray/grey), their bright ' +
          'variants (redBright, …), background variants (bgRed, ' +
          'bgRedBright, …), or style modifiers (bold, dim, italic, ' +
          'underline, inverse, hidden, strikethrough).',
      },
      extra: {
        type: 'array',
        items: {
          type: 'string',
          enum: ANSI_STYLE_ENUM,
        },
        description:
          "action='apply': additional modifiers composed inner-to-outer " +
          'after the primary `style`. Use for combinations like ' +
          "{style: 'red', extra: ['bold']} -> red bold text.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'ansi', 'text', 'format', 'terminal'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'ansi',
    'ansiStyle',
    'stripAnsi',
    'color',
    'colour',
    'terminal',
    'sgr',
    'escape',
    'bold',
    'underline',
  ],
  aliases: ['ansi', 'ansi_style', 'strip_ansi'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// TextStatsTool — `src/core/textStats/textStatsTool.ts`
// ---------------------------------------------------------------------------

export const textStatsToolMeta: Meta = {
  name: 'TextStats',
  description:
    'Compute statistics for a text string. Pure, allocation-light, ' +
    'linear in input length. ANSI-aware (escape sequences strip out ' +
    'by default; pass `countAnsi:true` to count them as literal text). ' +
    'Pick `action`: ' +
    '`stats` returns the full breakdown (chars, visualWidth, bytes, ' +
    'lines, words, sentences, paragraphs, avgLineLength, avgWordLength, ' +
    'avgWordsPerSentence); ' +
    '`lines` returns a visible-line count (trailing newline is a ' +
    'terminator, not a new empty line; recognizes \\n, \\r\\n, lone \\r); ' +
    '`words` returns a whitespace-collapsed token count; ' +
    '`sentences` returns a count of `[.!?]`-runs followed by whitespace ' +
    'or EOF (abbreviations like `Mr.` inflate; `3.14` does not); ' +
    '`paragraphs` returns a blank-line-separated paragraph count. ' +
    'Pure — no IO, parallel-safe.',
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: ['stats', 'lines', 'words', 'sentences', 'paragraphs'],
        description:
          'Which metric to return. `stats` returns the full TextStats ' +
          'breakdown; the others return a single scalar count.',
      },
      text: {
        type: 'string',
        description:
          'Input text to measure. Empty string is allowed (returns ' +
          'all zeros for `stats`, 0 for scalar counters).',
      },
      tabWidth: {
        type: 'number',
        description:
          "Width to charge for a `\\t` character when computing " +
          "`visualWidth`. Only consulted by action='stats'. Defaults " +
          'to 8. Must be a positive number.',
        exclusiveMinimum: 0,
      },
      countAnsi: {
        type: 'boolean',
        description:
          'When false (default), ANSI escape sequences are stripped ' +
          'before counting — they contribute zero chars, zero width, ' +
          'and are excluded from word/sentence/paragraph detection. ' +
          'Bytes still reflect the raw UTF-8 encoding. When true, ANSI ' +
          'bytes are counted as literal text.',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'textStats', 'text', 'count'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'textStats',
    'text',
    'stats',
    'count',
    'lines',
    'words',
    'sentences',
    'paragraphs',
    'chars',
    'bytes',
    'visualWidth',
    'wc',
  ],
  aliases: ['text_stats', 'count_text', 'wc'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// CodeBlocksTool — `src/core/codeBlocks/codeBlocksTool.ts`
// ---------------------------------------------------------------------------

export const codeBlocksToolMeta: Meta = {
  name: 'CodeBlocks',
  description:
    'Parse fenced code blocks (CommonMark §4.5) out of a string. ' +
    'Pick `action`: ' +
    "`extract` returns every fenced block (lang, content, line range, fence char/length, closed); " +
    "`split` returns an ordered list of prose/code segments that reconstruct the input byte-for-byte; " +
    "`findFirst` returns the first block (optionally filtered by `lang`, case-insensitive); " +
    "`unwrap` returns the inner content when the input is exactly one fenced block (optionally surrounded by whitespace), else null. " +
    'Indented (4-space) code blocks are NOT supported — fenced only. All actions are pure and parallel-safe.',
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: ['extract', 'split', 'findFirst', 'unwrap'],
        description:
          "Which operation to run. All actions require `text`. " +
          "`findFirst` additionally accepts an optional `lang` filter.",
      },
      text: {
        type: 'string',
        description:
          'The text to parse. May be empty (`extract`/`split` return empty results; ' +
          '`findFirst`/`unwrap` return null).',
      },
      lang: {
        type: ['string', 'null'],
        description:
          "action='findFirst': filter by language tag (case-insensitive). " +
          'Pass null to match blocks with no info string. Omit for "any lang".',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'text', 'markdown', 'code-blocks'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'code',
    'block',
    'fence',
    'markdown',
    'parse',
    'extract',
    'unwrap',
  ],
  aliases: ['code_blocks', 'codeblocks', 'parse_code_blocks'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// GlobMatchTool — `src/core/glob/globTool.ts`
// ---------------------------------------------------------------------------

export const globMatchToolMeta: Meta = {
  name: 'GlobMatch',
  description:
    'Test glob patterns against paths or expand brace alternatives. ' +
    'Pure picomatch-backed matcher; no filesystem access. ' +
    'Pick `action`: ' +
    "`match` returns `{matched, pattern, path}` for a single path " +
    "(supports `*`, `**`, `?`, `[abc]`, `{a,b}`, leading `!` negation; " +
    "options: `caseInsensitive`, `dot`); " +
    "`matchMany` filters an already-known list of paths against the " +
    "pattern and returns `{matches, total, matched}` — compile once, " +
    "test many; " +
    "`expandBraces` syntactically expands `a/{b,c}/d` to " +
    "`['a/b/d', 'a/c/d']` (no numeric-range expansion). " +
    "Pure — no IO, parallel-safe.",
  parameters: {
    type: 'object',
    required: ['action', 'pattern'],
    properties: {
      action: {
        type: 'string',
        enum: ['match', 'matchMany', 'expandBraces'],
        description:
          "Which operation to run. Required fields per action: " +
          "match -> pattern+path; matchMany -> pattern+paths (non-empty); " +
          "expandBraces -> pattern.",
      },
      pattern: {
        type: 'string',
        description:
          'Glob pattern. Picomatch syntax: `*` and `?` for single-segment ' +
          'wildcards, `**` for multi-segment, `[abc]` character class, ' +
          '`{a,b}` alternation, leading `!` for negation, backslash escapes. ' +
          'Leading `/` is stripped (anchor-to-root); trailing `/` becomes ' +
          '`/**` (directory contents). Required for every action.',
      },
      path: {
        type: 'string',
        description:
          "action='match': single path to test against `pattern`. " +
          'Forward-slash-separated; pre-normalised by the caller (no ' +
          'backslash → slash conversion is performed).',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          "action='matchMany': array of paths to filter. Must be " +
          "non-empty. The pattern is compiled once and applied to " +
          "every entry; only matching paths appear in the result " +
          "(original order preserved).",
      },
      caseInsensitive: {
        type: 'boolean',
        description:
          "When true, the pattern matches case-insensitively (`*.TXT` " +
          "matches `foo.txt`). Default false. Applies to action='match' " +
          "and action='matchMany'.",
      },
      dot: {
        type: 'boolean',
        description:
          "When true, `*` and `?` may match path components starting " +
          "with `.` (so `*` matches `.hidden`). Default false. Applies " +
          "to action='match' and action='matchMany'.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'glob', 'match', 'pattern'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'glob',
    'match',
    'pattern',
    'wildcard',
    'picomatch',
    'expand',
    'braces',
    'filter',
  ],
  aliases: ['glob_match', 'glob', 'pattern_match'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// ApplyDiffTool — `src/core/diff/applyDiffTool.ts`
//
// `needsPermission` depends on input (`'none'` for `dryRun:true`,
// `'write'` otherwise). The predicate is inlined here so the
// permission checker stays sync; impl lives in the sidecar.
// ---------------------------------------------------------------------------

export const applyDiffToolMeta: Meta = {
  name: 'ApplyDiff',
  description:
    'Apply a unified-diff text to files on disk. Supports multi-file diffs, file creation (`/dev/null` source) and deletion (`/dev/null` destination). ' +
    'Use `dryRun: true` to preview the result without writing. Use `expectedFiles` to fail fast if the diff touches anything outside an allow-list. ' +
    'Prefer this over Edit/Write when you have a unified-diff in hand (e.g. from `git diff` or from your own before/after formatting).',
  parameters: {
    type: 'object',
    required: ['diff'],
    properties: {
      diff: {
        type: 'string',
        description: 'Unified-diff text. May span multiple files.',
      },
      cwd: {
        type: 'string',
        description:
          'Optional base directory for resolving relative paths in the diff. Defaults to process.cwd().',
      },
      dryRun: {
        type: 'boolean',
        description:
          'If true, do not write any files; the result includes a `preview` of each would-be new content.',
      },
      expectedFiles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional allow-list. When provided, the tool refuses to touch any file outside this list and writes nothing.',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.write'],
  needsPermission: (input: unknown) =>
    (input as { dryRun?: boolean })?.dryRun ? 'none' : 'write',
  annotations: { readOnly: false, parallelSafe: false },
  searchHint: ['diff', 'patch', 'apply', 'unified', 'hunk'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// FindReplaceTool — `src/core/findReplace/findReplaceTool.ts`
//
// Permission-shape matches the impl: `dryRun !== false` -> 'none',
// explicit `dryRun:false` -> 'write'. (Slightly different polarity
// from ApplyDiff — see the test in test/build/lazyToolMetas.test.ts.)
// ---------------------------------------------------------------------------

// Inlined from findReplaceTool.ts. Drift-guarded by the meta test.
const FIND_REPLACE_DEFAULT_MAX_FILES = 100
const FIND_REPLACE_HARD_MAX_FILES = 1000

export const findReplaceToolMeta: Meta = {
  name: 'FindReplace',
  description:
    'Find-and-replace across files matched by a glob, with unified-diff previews. ' +
    'SAFE BY DEFAULT: `dryRun` is true unless explicitly set false, AND non-dryRun ' +
    'writes require an `expectedFiles` allow-list. Supports literal-string OR regex ' +
    'patterns (with `$1` backreferences), case-insensitive and multiline modes. ' +
    'Respects `.gitignore` by default; honours `excludePaths` for extra exclusions. ' +
    'Returns one preview per changed file plus, when writing, a per-file apply outcome.',
  parameters: {
    type: 'object',
    required: ['glob', 'pattern', 'replacement'],
    properties: {
      glob: {
        type: 'string',
        description:
          "File glob (e.g. 'src/**/*.ts'). Files matching this pattern are " +
          'candidates; non-matching files are skipped without being read.',
      },
      rootDir: {
        type: 'string',
        description:
          'Root directory for the walk. Defaults to the tool context cwd / process.cwd().',
      },
      pattern: {
        type: 'string',
        description:
          'String to find. Treated as a literal substring unless `isRegex: true`. ' +
          'Empty string is refused (would no-op or insert replacement at every code-unit).',
      },
      replacement: {
        type: 'string',
        description:
          "Replacement text. When `isRegex: true`, supports `$1`, `$2`, … " +
          "backreferences and `$&` (whole match) per JS RegExp.replace semantics.",
      },
      isRegex: {
        type: 'boolean',
        description: 'Treat `pattern` as a regex source. Default false (literal).',
      },
      caseInsensitive: {
        type: 'boolean',
        description: 'Case-insensitive matching. Default false.',
      },
      multiline: {
        type: 'boolean',
        description:
          'Multiline regex mode — `^` / `$` match line boundaries (not just file boundaries). Default false.',
      },
      dryRun: {
        type: 'boolean',
        description:
          'When true (DEFAULT), no files are written; only previews are returned. ' +
          'Pass `false` AND a non-empty `expectedFiles` to actually write.',
      },
      expectedFiles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'REQUIRED when `dryRun: false`. Allow-list of files (relative or absolute) ' +
          'that may be written. Any matched file outside this list is refused and ' +
          'reported in the result, never written.',
      },
      maxFiles: {
        type: 'number',
        description: `Cap on candidate files scanned. Default ${FIND_REPLACE_DEFAULT_MAX_FILES}, hard max ${FIND_REPLACE_HARD_MAX_FILES}.`,
        minimum: 1,
      },
      respectGitignore: {
        type: 'boolean',
        description: 'Skip files matched by `.gitignore`. Default true.',
      },
      excludePaths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional glob patterns to exclude. Any file matching ANY exclude ' +
          'pattern is skipped before the find-replace runs.',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.read', 'fs.write'],
  needsPermission: (input: unknown) =>
    (input as { dryRun?: boolean })?.dryRun === false ? 'write' : 'none',
  annotations: { readOnly: false, parallelSafe: false },
  searchHint: ['find', 'replace', 'rename', 'substitute', 'sed', 'regex', 'patch'],
  aliases: ['find_replace', 'sed'],
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// LSPQuery — `src/core/lsp/lspQueryTool.ts`
//
// Built by a factory (`makeLspQueryTool(manager)`). Registered via the
// FACTORY-tool table below so cli.tsx can supply the LspManager
// instance.
// ---------------------------------------------------------------------------

export const lspQueryToolMeta: Meta = {
  name: 'LSPQuery',
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
  runtime: { kind: 'in-process' },
}

// ---------------------------------------------------------------------------
// Aggregated registration table — consumed by `src/cli.tsx` boot.
// ---------------------------------------------------------------------------

import type { Tool } from '../types'

export type LazyToolEntry = {
  meta: Meta
  /** Matches an export name from `core/tools/extra/entry.ts`. */
  exportName: keyof typeof import('./entry')
}

export const LAZY_TOOL_ENTRIES: readonly LazyToolEntry[] = [
  { meta: whitespaceToolMeta, exportName: 'WhitespaceTool' },
  { meta: truncateToolMeta, exportName: 'TruncateTool' },
  { meta: jsonFormatToolMeta, exportName: 'JsonFormatTool' },
  { meta: shellQuoteToolMeta, exportName: 'ShellQuoteTool' },
  { meta: slugToolMeta, exportName: 'SlugTool' },
  { meta: urlExtractToolMeta, exportName: 'UrlExtractTool' },
  { meta: formatDurationToolMeta, exportName: 'FormatDurationTool' },
  { meta: caseConvertToolMeta, exportName: 'CaseConvertTool' },
  { meta: wrapTextToolMeta, exportName: 'WrapTextTool' },
  { meta: ansiStyleToolMeta, exportName: 'AnsiStyleTool' },
  { meta: textStatsToolMeta, exportName: 'TextStatsTool' },
  { meta: codeBlocksToolMeta, exportName: 'CodeBlocksTool' },
  { meta: globMatchToolMeta, exportName: 'GlobMatchTool' },
  { meta: applyDiffToolMeta, exportName: 'ApplyDiffTool' },
  { meta: findReplaceToolMeta, exportName: 'FindReplaceTool' },
] as const

// Re-export so callers don't have to dual-import.
export type { Tool, LazyToolMetadata }
