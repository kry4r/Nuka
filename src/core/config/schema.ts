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
])

export const McpConfigSchema = z
  .object({ servers: z.record(z.string(), McpServerConfigSchema).default({}) })
  .optional()

export const ConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).default([]),
  active: ActiveSelectionSchema,
  theme: ThemeSchema,
  welcome: WelcomeSchema,
  compact: CompactSchema,
  search: SearchSchema,
  mcp: McpConfigSchema,
})
export type Config = z.infer<typeof ConfigSchema>
