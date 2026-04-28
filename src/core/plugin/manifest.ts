import { z } from 'zod'
import { AgentDefSchema } from '../agents/types'

// LSP server definition schema (mirrors LspServerDef from src/core/lsp/types.ts)
const LspDocumentSelectorEntrySchema = z.object({
  language: z.string().optional(),
  pattern: z.string().optional(),
})

const LspServerDefSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  documentSelector: z.array(LspDocumentSelectorEntrySchema).min(1),
  initializationOptions: z.unknown().optional(),
  rootUri: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
})

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
  /**
   * Map of executables this plugin provides, mirroring npm's `bin` field.
   * Key is the binary name; value is the relative path to the executable
   * within the plugin directory. Schema only — install logic lands in M4.
   */
  bin: z.record(z.string(), z.string()).optional(),
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
        matchToolSource: z.enum(['plugin', 'skill', 'builtin']).optional(),
        componentPath: z.string().min(1),
      }),
    )
    .optional(),
  /**
   * LSP server declarations. Each entry is registered with LspManager on wire.
   * documentSelector determines which file types/paths this server handles.
   * Collision policy: first registration for a selector wins; duplicates are skipped.
   */
  lspServers: z.array(LspServerDefSchema).optional(),
  /**
   * Notification routing channels provided by this plugin.
   */
  channels: z
    .array(
      z.object({
        name: z.string().min(1),
        allowlist: z.array(
          z.enum([
            'tool_result',
            'turn_end',
            'error',
            'plugin_install',
            'plugin_uninstall',
            'plugin_enable',
            'plugin_disable',
          ]),
        ),
        dispatch: z.discriminatedUnion('type', [
          z.object({ type: z.literal('webhook'), url: z.string().url() }),
          z.object({ type: z.literal('command'), command: z.string().min(1) }),
        ]),
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
