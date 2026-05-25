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
// YAML/JSON files use Nuka's explicit `systemPrompt` field, with Nuka-Code's
// `prompt` alias accepted for compatibility. Markdown files use the Nuka-Code
// shape: YAML frontmatter for metadata and the body as the system prompt.
//
// Per-file errors in `loadSubagentsFromDir` are isolated — one bad file
// surfaces in `errors[]` and the rest of the batch still loads. Missing
// directories return an empty result (graceful — the typical install has
// none of these dirs).

import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { addAgentMemoryTools, type AgentMemoryScope } from './agentMemory'
import { JsonValueSchema, type AgentDef, type JsonValue } from './types'
import type { Effort } from '../provider/types'

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
  /** Optional persistent agent memory scope, matching Nuka-Code frontmatter. */
  memory?: AgentMemoryScope
  /** Optional cwd isolation default for background execution. */
  isolation?: 'inherit' | 'worktree'
  /** If true, this agent should be launched through spawn_agent by default. */
  background?: boolean
  /** Optional permission mode override for the sub-agent session. */
  permissionMode?: 'plan'
  /** Optional prompt prepended to the first user turn, matching Nuka-Code agents. */
  initialPrompt?: string
  /** Optional reasoning effort hint for thinking-capable provider/model pairs. */
  effort?: Effort
  /** Optional skill names to preload into the sub-agent session. */
  skills?: string[]
  /** Required MCP server name patterns for this agent to be available. */
  requiredMcpServers?: string[]
  /** Declarative MCP server metadata preserved for future runtime support. */
  mcpServers?: JsonValue[]
  /** Declarative hook metadata preserved for future runtime support. */
  hooks?: JsonValue
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
    systemPrompt: z.string().min(1, 'systemPrompt must be a non-empty string').optional(),
    prompt: z.string().min(1, 'prompt must be a non-empty string').optional(),
    tools: z.array(z.string()).optional(),
    allowedTools: z.array(z.string()).optional(),
    deniedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    model: z.string().min(1).optional(),
    maxTurns: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(1).optional(),
    memory: z.enum(['user', 'project', 'local']).optional(),
    isolation: z.enum(['inherit', 'worktree']).optional(),
    background: z.boolean().optional(),
    permissionMode: z.enum(['plan']).optional(),
    initialPrompt: z.string().min(1).optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    skills: z.array(z.string().min(1)).optional(),
    requiredMcpServers: z.array(z.string().min(1)).optional(),
    mcpServers: z.array(JsonValueSchema).optional(),
    hooks: JsonValueSchema.optional(),
    keywords: z.array(z.string()).optional(),
  })
  .strict()
  .refine(
    (d) => !(d.deniedTools !== undefined && d.disallowedTools !== undefined),
    {
      message:
        "specify either 'deniedTools' or 'disallowedTools' — not both (they are aliases)",
    },
  )
  .refine(
    (d) => !(d.tools !== undefined && d.allowedTools !== undefined),
    {
      message:
        "specify either 'tools' or 'allowedTools' — not both (they are aliases)",
    },
  )
  .refine(
    (d) => (d.systemPrompt !== undefined) !== (d.prompt !== undefined),
    {
      message:
        "specify exactly one of 'systemPrompt' or 'prompt' (they are aliases)",
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
  const tools = withMemoryTools(parsed.tools ?? parsed.allowedTools, parsed.memory)
  const def: SubagentDefinition = {
    name: parsed.name,
    description: parsed.description,
    systemPrompt: parsed.systemPrompt ?? parsed.prompt!,
    sourcePath: filePath,
  }
  if (tools !== undefined) def.tools = tools
  const deniedTools = parsed.deniedTools ?? parsed.disallowedTools
  if (deniedTools !== undefined) def.deniedTools = deniedTools
  if (parsed.model !== undefined) def.model = parsed.model
  if (parsed.maxTurns !== undefined) def.maxTurns = parsed.maxTurns
  if (parsed.maxTokens !== undefined) def.maxTokens = parsed.maxTokens
  if (parsed.temperature !== undefined) def.temperature = parsed.temperature
  if (parsed.memory !== undefined) def.memory = parsed.memory
  if (parsed.isolation !== undefined) def.isolation = parsed.isolation
  if (parsed.background !== undefined) def.background = parsed.background
  if (parsed.permissionMode !== undefined) def.permissionMode = parsed.permissionMode
  if (parsed.initialPrompt !== undefined) def.initialPrompt = parsed.initialPrompt
  if (parsed.effort !== undefined) def.effort = parsed.effort
  if (parsed.skills !== undefined) def.skills = parsed.skills
  if (parsed.requiredMcpServers !== undefined) def.requiredMcpServers = parsed.requiredMcpServers
  if (parsed.mcpServers !== undefined) def.mcpServers = parsed.mcpServers
  if (parsed.hooks !== undefined) def.hooks = parsed.hooks
  if (parsed.keywords !== undefined) def.keywords = parsed.keywords
  return def
}

function withMemoryTools(
  tools: string[] | undefined,
  memory: AgentMemoryScope | undefined,
): string[] | undefined {
  if (tools === undefined || memory === undefined) return tools
  return addAgentMemoryTools(tools)
}

/**
 * File-extension dispatch. `.yaml`/`.yml` use the `yaml` package;
 * `.json` uses native JSON. Anything else throws — the loader caller
 * filters by extension first, but we double-check here so direct uses
 * of `loadSubagentFile` get a clear error.
 */
function parseByExtension(filePath: string, content: string): unknown {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.md') {
    return parseMarkdownAgent(content)
  }
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
    `unsupported file extension '${ext}' — only .md, .yaml, .yml, and .json are recognised`,
  )
}

function parseMarkdownAgent(content: string): unknown {
  const parsed = parseMarkdownFrontmatter(content)
  if (!parsed) {
    throw new Error('missing markdown frontmatter')
  }
  if (!parsed.body.trim()) {
    throw new Error('markdown body must contain the system prompt')
  }
  return {
    ...parsed.frontmatter,
    description: normalizeMarkdownDescription(parsed.frontmatter['description']),
    systemPrompt: parsed.body.trim(),
    tools: normalizeToolList(parsed.frontmatter['tools']),
    allowedTools: normalizeToolList(parsed.frontmatter['allowedTools']),
    deniedTools: normalizeToolList(parsed.frontmatter['deniedTools']),
    disallowedTools: normalizeToolList(parsed.frontmatter['disallowedTools']),
    memory: parsed.frontmatter['memory'],
    isolation: parsed.frontmatter['isolation'],
    background: normalizeFrontmatterBoolean(parsed.frontmatter['background']),
    permissionMode: parsed.frontmatter['permissionMode'],
    initialPrompt: parsed.frontmatter['initialPrompt'],
    effort: parsed.frontmatter['effort'],
    skills: normalizeStringList(parsed.frontmatter['skills']),
    requiredMcpServers: normalizeStringList(parsed.frontmatter['requiredMcpServers']),
    mcpServers: normalizeUnknownList(parsed.frontmatter['mcpServers']),
    hooks: parsed.frontmatter['hooks'],
  }
}

function normalizeMarkdownDescription(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\\n/g, '\n') : value
}

export function subagentToAgentDef(sub: SubagentDefinition): AgentDef {
  return {
    name: sub.name,
    description: sub.description,
    systemPrompt: sub.systemPrompt,
    maxTurns: sub.maxTurns ?? 20,
    ...(sub.tools !== undefined ? { allowedTools: sub.tools } : {}),
    ...(sub.deniedTools !== undefined ? { deniedTools: sub.deniedTools } : {}),
    ...(sub.model !== undefined ? { model: sub.model } : {}),
    ...(sub.maxTokens !== undefined ? { maxTokens: sub.maxTokens } : {}),
    ...(sub.temperature !== undefined ? { temperature: sub.temperature } : {}),
    ...(sub.memory !== undefined ? { memory: sub.memory } : {}),
    ...(sub.isolation !== undefined ? { isolation: sub.isolation } : {}),
    ...(sub.background !== undefined ? { background: sub.background } : {}),
    ...(sub.permissionMode !== undefined ? { permissionMode: sub.permissionMode } : {}),
    ...(sub.initialPrompt !== undefined ? { initialPrompt: sub.initialPrompt } : {}),
    ...(sub.effort !== undefined ? { effort: sub.effort } : {}),
    ...(sub.skills !== undefined ? { skills: sub.skills } : {}),
    ...(sub.requiredMcpServers !== undefined ? { requiredMcpServers: sub.requiredMcpServers } : {}),
    ...(sub.mcpServers !== undefined ? { mcpServers: sub.mcpServers } : {}),
    ...(sub.hooks !== undefined ? { hooks: sub.hooks } : {}),
    ...(sub.keywords !== undefined ? { keywords: sub.keywords } : {}),
  }
}

function parseMarkdownFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const normalized = content.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) return null
  const closeMatch = /\r?\n---\r?\n/.exec(normalized.slice(3))
  if (!closeMatch) return null
  const closeStart = 3 + closeMatch.index
  const bodyStart = closeStart + closeMatch[0].length
  const yamlText = normalized.slice(3, closeStart).replace(/^\r?\n/, '')
  let raw: unknown
  try {
    raw = parseYaml(yamlText) as unknown
  } catch (err) {
    throw new Error(`failed to parse markdown frontmatter: ${(err as Error).message}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('markdown frontmatter must be an object')
  }
  return {
    frontmatter: raw as Record<string, unknown>,
    body: normalized.slice(bodyStart),
  }
}

function normalizeToolList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return []
  const items = Array.isArray(value) ? value : [value]
  const out: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    for (const part of item.split(',')) {
      const trimmed = part.trim()
      if (trimmed.length === 0) continue
      if (trimmed === '*') return undefined
      out.push(trimmed)
    }
  }
  return out
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return []
  const items = Array.isArray(value) ? value : [value]
  const out: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    for (const part of item.split(',')) {
      const trimmed = part.trim()
      if (trimmed.length > 0) out.push(trimmed)
    }
  }
  return out
}

function normalizeUnknownList(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

function normalizeFrontmatterBoolean(value: unknown): unknown {
  if (value === undefined) return undefined
  if (value === true || value === false) return value
  if (value === 'true') return true
  if (value === 'false') return false
  return value
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

const ACCEPTED_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.json'])

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
      if (extname(filePath).toLowerCase() === '.md') {
        const content = await readFile(filePath, 'utf8')
        const parsedMarkdown = parseMarkdownFrontmatter(content)
        if (!parsedMarkdown || typeof parsedMarkdown.frontmatter['name'] !== 'string') continue
      }
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
