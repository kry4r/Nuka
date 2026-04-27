import { z } from 'zod'

export const ProviderFormatSchema = z.enum(['anthropic', 'openai'])
export type ProviderFormat = z.infer<typeof ProviderFormatSchema>

export const PricingSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
})

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  format: ProviderFormatSchema,
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  models: z.array(z.string()).default([]),
  selectedModel: z.string().optional(),
  extraHeaders: z.record(z.string(), z.string()).optional(),
  pricing: z.record(z.string(), PricingSchema).optional(),
})
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

export const ActiveSelectionSchema = z.object({
  providerId: z.string().min(1),
})

export const ThemeSchema = z
  .object({
    /** Name of the active registered theme (e.g. "default-dark"). */
    name: z.string().optional(),
    primary: z.string().optional(),
    accent: z.string().optional(),
    fg: z.string().optional(),
    muted: z.string().optional(),
    warn: z.string().optional(),
    error: z.string().optional(),
  })
  .optional()

export const WelcomeSchema = z
  .object({
    tips: z.array(z.string()).optional(),
  })
  .optional()

export const CompactSchema = z
  .object({
    keepTurns: z.number().int().positive().default(3),
    model: z.string().optional(),
    autoThreshold: z.number().min(0).max(1).default(0.8),
    contextWindow: z.number().int().positive().default(200_000),
  })
  .optional()

export const SearchSchema = z
  .object({
    endpoint: z.string().url(),
    apiKey: z.string().optional(),
    authHeader: z.string().default('Authorization'),
    authPrefix: z.string().default('Bearer '),
  })
  .optional()

export const McpServerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('http'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('sse'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
])

export const McpConfigSchema = z
  .object({
    servers: z.record(z.string(), McpServerConfigSchema).default({}),
    maxResultChars: z.number().int().positive().default(100_000),
    connectTimeoutMs: z.number().int().positive().default(30_000),
    requestTimeoutMs: z.number().int().positive().default(600_000),
    persistThresholdChars: z.number().int().positive().default(500_000),
  })
  .optional()

export const PluginsConfigSchema = z
  .object({
    enabled: z.array(z.string()).optional(),
  })
  .optional()

export const VimConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .optional()

export const StatusLineConfigSchema = z
  .object({
    /** Template string with {provider}, {model}, {ctxPct}, {cost}, {plugins}, {tasks}, {branch} */
    format: z.string().optional(),
    /** Shell command spawned every intervalMs; first stdout line appended to rendered output */
    command: z.string().optional(),
    /** Interval in ms for command re-run (default 5000) */
    intervalMs: z.number().int().positive().default(5000),
  })
  .optional()
export type StatusLineConfig = z.infer<typeof StatusLineConfigSchema>

/**
 * `/status-bar` — controls which categorised segments render in the bottom
 * StatusBar. `hidden` is a list of segment names; everything else shows.
 * Known segment names: model, cwd, git, ctx, cost, mcp, auto, queue, tasks,
 * plugins, hint. Unknown names are ignored.
 */
export const StatusBarConfigSchema = z
  .object({
    hidden: z.array(z.string()).default([]),
  })
  .optional()
export type StatusBarConfig = z.infer<typeof StatusBarConfigSchema>

export const RewindConfigSchema = z
  .object({
    /**
     * Phase 8 §4.3 — when true, the agent loop snapshots SHA1+bytes of any
     * file touched by Write/Edit per turn so `/rewind` can later restore.
     * OFF by default: restore is a no-op until git-backed path lands.
     */
    fileCheckpointing: z.boolean().default(false),
  })
  .optional()

export const ConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).default([]),
  active: ActiveSelectionSchema,
  theme: ThemeSchema,
  welcome: WelcomeSchema,
  compact: CompactSchema,
  search: SearchSchema,
  mcp: McpConfigSchema,
  plugins: PluginsConfigSchema,
  vim: VimConfigSchema,
  rewind: RewindConfigSchema,
  statusLine: StatusLineConfigSchema,
  statusBar: StatusBarConfigSchema,
  /**
   * Enterprise-only: dot-paths that cannot be overridden by lower-priority scopes.
   * Declared in the enterprise config; ignored if declared in other scopes.
   * e.g. ["providers.openai.apiKey", "mcp"]
   */
  locked: z.array(z.string()).optional(),
})
export type Config = z.infer<typeof ConfigSchema>
