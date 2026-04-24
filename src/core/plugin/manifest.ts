import { z } from 'zod'
import { McpServerConfigSchema } from '../config/schema'

export const PluginManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'kebab-case letters/numbers/hyphen only; must start with letter or digit',
    ),
  version: z.string().optional(),
  description: z.string().optional(),
  tools: z.array(z.string()).default([]),
  slashCommands: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  mcpServers: z.record(z.string(), McpServerConfigSchema).default({}),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>

export type LoadedPlugin = {
  manifest: PluginManifest
  rootDir: string
}
