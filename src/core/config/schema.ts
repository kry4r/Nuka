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
  })
  .optional()

export const ConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).default([]),
  active: ActiveSelectionSchema,
  theme: ThemeSchema,
  welcome: WelcomeSchema,
  compact: CompactSchema,
})
export type Config = z.infer<typeof ConfigSchema>
