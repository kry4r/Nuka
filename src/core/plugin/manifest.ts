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
  /** Author of the plugin, e.g. "Jane Doe <jane@example.com>" */
  author: z.string().optional(),
  /** URL to the plugin's homepage or documentation */
  homepage: z.string().optional(),
  /** URL to the plugin's source repository */
  repository: z.string().optional(),
  /** SPDX license identifier, e.g. "MIT" */
  license: z.string().optional(),
  /** Searchable keywords for the plugin */
  keywords: z.array(z.string()).optional(),
  tools: z.array(z.string()).default([]),
  slashCommands: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  mcpServers: z.record(z.string(), McpServerConfigSchema).default({}),
  /** Relative path to a hooks.json file within the plugin directory */
  hooks: z.string().optional(),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>

export type LoadedPlugin = {
  manifest: PluginManifest
  rootDir: string
  /** Whether this plugin was loaded from an installed location or a session --plugin-dir */
  source: 'installed' | 'session'
  /** For session plugins: the directory they were loaded from */
  dir?: string
}
