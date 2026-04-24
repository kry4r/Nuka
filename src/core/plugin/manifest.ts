import { z } from 'zod'
import { McpServerConfigSchema } from '../config/schema'
import { AgentDefSchema } from '../agents/types'

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
  /**
   * Plugin dependencies — other plugins this plugin requires.
   * Resolved at install time via DFS closure.
   */
  dependencies: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .regex(/^[a-z0-9][a-z0-9-]*$/, 'dependency name must be kebab-case'),
        version: z.string().optional(),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
  /**
   * Specialist agents declared by this plugin. Each agent is registered as
   * `<plugin-name>:<agent-name>` and can be dispatched via the `dispatch_agent`
   * tool (see Phase 5 M5-agents).
   */
  agents: z.array(AgentDefSchema).optional(),
  /**
   * Custom tool-result renderers provided by this plugin.
   * Each entry maps a tool name glob + optional source to a React component path.
   */
  outputStyles: z
    .array(
      z.object({
        name: z.string().min(1),
        matchToolName: z.string().optional(),
        matchToolSource: z.enum(['mcp', 'plugin', 'skill', 'builtin']).optional(),
        componentPath: z.string().min(1),
      }),
    )
    .optional(),
  /**
   * User-configurable fields that must be supplied at first launch.
   * Persisted to ~/.nuka/plugins/<name>/.userconfig.json.
   */
  userConfig: z
    .object({
      fields: z.array(
        z.object({
          name: z.string().min(1),
          type: z.enum(['string', 'number', 'boolean']),
          description: z.string().optional(),
          default: z.unknown().optional(),
          required: z.boolean().optional(),
        }),
      ),
    })
    .optional(),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type PluginUserConfigField = NonNullable<PluginManifest['userConfig']>['fields'][number]

export type LoadedPlugin = {
  manifest: PluginManifest
  rootDir: string
  /** Whether this plugin was loaded from an installed location or a session --plugin-dir */
  source: 'installed' | 'session'
  /** For session plugins: the directory they were loaded from */
  dir?: string
  /**
   * True when the plugin declares userConfig.fields and no .userconfig.json exists yet.
   * The TUI resolves these post-mount via PluginConfigDialog before wiring the plugin.
   */
  needsUserConfig?: boolean
}
