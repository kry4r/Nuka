// src/core/agents/subagentLoader.ts
//
// Loose-file subagent definition loader. Reads YAML or JSON files that
// describe a subagent inline (rather than going through a full plugin
// manifest) and produces shapes that drop straight into
// `AgentRegistry.register()` via `resolveAgentDef()`.
//
// Default search paths (mirroring the hooks/skills loaders):
//   • cwd/.nuka/subagents/         — project-scoped definitions
//   • home/.nuka/subagents/        — user-scoped definitions
//
// The on-disk schema is deliberately a strict subset of Nuka-Code's
// agent JSON shape — required `name` + `description` + `systemPrompt`,
// plus optional `tools` (allowlist alias for the in-memory
// `allowedTools` field), `model`, `allowedTools`, `deniedTools`,
// `maxTurns`, `keywords`, `maxTokens`, `temperature`. Extra fields are
// rejected by the Zod schema (`strict()`) so a typo doesn't silently
// produce a malformed subagent.
//
// Per-file errors in `loadSubagentsFromDir` are isolated — one bad file
// surfaces in `errors[]` and the rest of the batch still loads. Missing
// directories return an empty result (graceful — the typical install has
// none of these dirs).

import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * Public subagent shape after parsing. Maps onto Nuka's internal
 * `AgentDef` (allowedTools/deniedTools) but exposes the more
 * user-friendly `tools` alias the task spec requires.
 *
 * Either `tools` or `allowedTools` is accepted on input — both are
 * surfaced on output (with `tools` being the canonical user-facing
 * spelling and `allowedTools` the harness-internal one).
 */
export interface SubagentDefinition {
  /** Unqualified agent name (namespace-safe). */
  name: string
  /** Short description / "when to use". */
  description: string
  /** Inline system prompt. */
  systemPrompt: string
  /** Tool allowlist. Alias of `allowedTools`. Optional → all tools. */
  tools?: string[]
  /** Tool denylist. Subtracted *after* the allowlist applies. */
  deniedTools?: string[]
  /** Optional model override (inherits parent session model otherwise). */
  model?: string
  /** Hard ceiling on agent turns. */
  maxTurns?: number
  /** Optional output-token cap forwarded to provider. */
  maxTokens?: number
  /** Optional sampling temperature forwarded to provider. */
  temperature?: number
  /** Keywords surfaced in palette / dispatch hints. */
  keywords?: string[]
  /** Absolute path to the source file (for error messages / debugging). */
  sourcePath: string
}

/**
 * Result of a batch load from a directory.
 */
export interface LoadSubagentResult {
  loaded: SubagentDefinition[]
  errors: { path: string; message: string }[]
}

const SubagentFileSchema = z
  .object({
    name: z
      .string()
      .min(1, 'name must be a non-empty string')
      .regex(
        /^[a-z][a-z0-9_-]*$/,
        "name must match /^[a-z][a-z0-9_-]*$/ (lowercase, namespace-safe)",
      ),
    description: z.string().min(1, 'description must be a non-empty string'),
    systemPrompt: z.string().min(1, 'systemPrompt must be a non-empty string'),
    tools: z.array(z.string()).optional(),
    allowedTools: z.array(z.string()).optional(),
    deniedTools: z.array(z.string()).optional(),
    model: z.string().min(1).optional(),
    maxTurns: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(1).optional(),
    keywords: z.array(z.string()).optional(),
  })
  .strict()
  .refine(
    (d) => !(d.tools !== undefined && d.allowedTools !== undefined),
    {
      message:
        "specify either 'tools' or 'allowedTools' — not both (they are aliases)",
    },
  )

type SubagentFile = z.infer<typeof SubagentFileSchema>

/**
 * Parse raw text (YAML or JSON) into validated subagent data. The
 * caller picks the parser; this function only handles schema
 * validation + the `tools`/`allowedTools` alias merge so callers can
 * stay format-agnostic.
 */
function buildDefinition(raw: unknown, filePath: string): SubagentDefinition {
  const parsed = SubagentFileSchema.parse(raw)
  return assembleDefinition(parsed, filePath)
}

function assembleDefinition(
  parsed: SubagentFile,
  filePath: string,
): SubagentDefinition {
  // Merge the alias: `tools` is the canonical user-facing field; if the
  // file uses `allowedTools` we accept that too and surface both shapes
  // on the result so downstream Nuka code that expects `allowedTools`
  // (via resolveAgentDef path) gets what it needs.
  const tools = parsed.tools ?? parsed.allowedTools
  const def: SubagentDefinition = {
    name: parsed.name,
    description: parsed.description,
    systemPrompt: parsed.systemPrompt,
    sourcePath: filePath,
  }
  if (tools !== undefined) def.tools = tools
  if (parsed.deniedTools !== undefined) def.deniedTools = parsed.deniedTools
  if (parsed.model !== undefined) def.model = parsed.model
  if (parsed.maxTurns !== undefined) def.maxTurns = parsed.maxTurns
  if (parsed.maxTokens !== undefined) def.maxTokens = parsed.maxTokens
  if (parsed.temperature !== undefined) def.temperature = parsed.temperature
  if (parsed.keywords !== undefined) def.keywords = parsed.keywords
  return def
}

/**
 * File-extension dispatch. `.yaml`/`.yml` use the `yaml` package;
 * `.json` uses native JSON. Anything else throws — the loader caller
 * filters by extension first, but we double-check here so direct uses
 * of `loadSubagentFile` get a clear error.
 */
function parseByExtension(filePath: string, content: string): unknown {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.json') {
    try {
      return JSON.parse(content) as unknown
    } catch (err) {
      throw new Error(
        `failed to parse JSON: ${(err as Error).message}`,
      )
    }
  }
  if (ext === '.yaml' || ext === '.yml') {
    try {
      return parseYaml(content) as unknown
    } catch (err) {
      throw new Error(`failed to parse YAML: ${(err as Error).message}`)
    }
  }
  throw new Error(
    `unsupported file extension '${ext}' — only .yaml, .yml, and .json are recognised`,
  )
}

/**
 * Load a single subagent definition file. Throws on missing file,
 * unsupported extension, parse error, or schema-validation error.
 * The thrown `Error.message` includes the source path so the caller
 * doesn't need to wrap it again.
 */
export async function loadSubagentFile(
  filePath: string,
): Promise<SubagentDefinition> {
  const abs = resolve(filePath)
  let content: string
  try {
    content = await readFile(abs, 'utf8')
  } catch (err) {
    throw new Error(
      `subagent file '${abs}' — read failed: ${(err as Error).message}`,
    )
  }
  let parsed: unknown
  try {
    parsed = parseByExtension(abs, content)
  } catch (err) {
    throw new Error(`subagent file '${abs}' — ${(err as Error).message}`)
  }
  try {
    return buildDefinition(parsed, abs)
  } catch (err) {
    if (err instanceof z.ZodError) {
      // Flatten Zod issues into a single readable line. Each issue's
      // path is included so users can trace `tools` vs nested field
      // problems without poring over a JSON dump.
      const flat = err.issues
        .map((i) => {
          const path = i.path.length > 0 ? i.path.join('.') : '(root)'
          return `${path}: ${i.message}`
        })
        .join('; ')
      throw new Error(`subagent file '${abs}' — invalid shape: ${flat}`)
    }
    throw new Error(
      `subagent file '${abs}' — ${(err as Error).message}`,
    )
  }
}

const ACCEPTED_EXTENSIONS = new Set(['.yaml', '.yml', '.json'])

async function listSubagentFiles(
  dirPath: string,
  recursive: boolean,
): Promise<string[]> {
  const results: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  for (const entry of entries) {
    const full = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (recursive) {
        const nested = await listSubagentFiles(full, recursive)
        results.push(...nested)
      }
      continue
    }
    if (!entry.isFile()) continue
    if (ACCEPTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      results.push(full)
    }
  }
  return results
}

/**
 * Load every subagent definition file under `dirPath`.
 *
 * - Recursive by default (matches plugins/skills convention).
 * - Per-file error isolation: a single bad file doesn't fail the
 *   batch; its `{path, message}` lands in `errors[]`.
 * - Missing directory → empty result (no throw).
 * - Duplicate names within the batch: last file wins, a `console.warn`
 *   is emitted with both paths so the user can disambiguate.
 */
export async function loadSubagentsFromDir(
  dirPath: string,
  opts: { recursive?: boolean } = {},
): Promise<LoadSubagentResult> {
  const recursive = opts.recursive ?? true
  let dirExists = true
  try {
    const s = await stat(dirPath)
    if (!s.isDirectory()) dirExists = false
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      dirExists = false
    } else {
      throw err
    }
  }
  if (!dirExists) return { loaded: [], errors: [] }

  const files = (await listSubagentFiles(dirPath, recursive)).sort()
  const errors: { path: string; message: string }[] = []
  // Map keyed by `name` so we can implement last-wins with warning
  // semantics without iterating the array twice.
  const byName = new Map<string, SubagentDefinition>()

  for (const filePath of files) {
    try {
      const def = await loadSubagentFile(filePath)
      const prev = byName.get(def.name)
      if (prev !== undefined) {
        console.warn(
          `[nuka:subagent] duplicate name '${def.name}' — '${filePath}' overrides '${prev.sourcePath}'`,
        )
      }
      byName.set(def.name, def)
    } catch (err) {
      errors.push({ path: filePath, message: (err as Error).message })
    }
  }
  return { loaded: [...byName.values()], errors }
}

/**
 * Default search paths: `${cwd}/.nuka/subagents/` and
 * `${home}/.nuka/subagents/`. Project-scoped first, user-scoped
 * second — callers iterate in order, and later loads silently
 * shadow earlier ones via the duplicate-name warning above.
 */
export function defaultSubagentDirs(
  cwd: string = process.cwd(),
  home: string = process.env['HOME'] ?? '',
): string[] {
  const dirs: string[] = [join(cwd, '.nuka', 'subagents')]
  if (home) dirs.push(join(home, '.nuka', 'subagents'))
  return dirs
}
