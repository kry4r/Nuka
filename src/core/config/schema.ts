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
  providerId: z.string(),
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
 * Phase 12 §4.5 — controls which segments render in the unified Status
 * panel. `hidden` is a list of segment ids; everything else shows.
 *
 * Segment ids (Phase 13): mode, model, cwd, context, cost, counts.
 * Plus `status-line` for the optional legacy custom row.
 * (Phase 12 had `cost-time`; migrated to `cost` in Phase 13 §5.1.)
 *
 * Old ids (model, cwd, git, ctx, cost, auto, queue, tasks, plugins,
 * hint) are migrated to the new set in `loadConfig` / `loadScopedConfig`
 * — see `migrateStatusBarHidden` in `src/core/config/load.ts`.
 *
 * `layout` selects density: dense (two columns), compact (two rows),
 * oneline (single line). Narrow terminals auto-degrade in the
 * renderer; this field reflects the user's preferred density.
 *
 * `iconMode` selects whether segments render with icon glyphs or
 * plain text labels. 'icon' (default) uses ⬢/⚙/▰▱ etc.; 'text'
 * uses bracketed labels: [idle], plugins:N, etc.
 */
export const StatusBarConfigSchema = z
  .object({
    hidden: z.array(z.string()).default([]),
    layout: z.enum(['dense', 'compact', 'oneline']).default('dense'),
    iconMode: z.enum(['icon', 'text']).default('icon'),
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

export const HarnessConfigSchema = z
  .object({
    /** deep (default): full stage walk; fast: skip Brainstorm+Spec; off: disable harness */
    mode: z.enum(['deep', 'fast', 'off']).default('deep'),
    /** max scratchpad size in KB before oldest-section truncation */
    scratchpadKB: z.number().default(50),
    /** profiles that require TDD in the implement stage (legacy fallback; the
     *  primary gate is now `Triage.testStrategy` — see harness/skills.ts) */
    forceTddProfiles: z.array(z.string()).default(['feature', 'debug-fix', 'refactor']),
  })
  .optional()
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>

/** Phase 14c — /recap and autoDream configuration. */
export const RecapConfigSchema = z
  .object({
    /** Show the away-summary card after idle return (default: true). */
    awayCard: z.boolean().default(true),
    /** Idle threshold in minutes before showing the away-summary card. */
    awayThresholdMinutes: z.number().min(1).default(5),
    /** autoDream memory consolidation settings. */
    autoDream: z
      .object({
        enabled: z.boolean().default(true),
        /** Minimum hours since last consolidation before triggering. */
        minHours: z.number().default(6),
        /** Minimum new sessions since last consolidation before triggering. */
        minSessions: z.number().default(3),
      })
      .default({ enabled: true, minHours: 6, minSessions: 3 }),
  })
  .optional()
export type RecapConfig = z.infer<typeof RecapConfigSchema>

export const EffortSchema = z.enum(['low', 'medium', 'high']).optional()
export type Effort = z.infer<typeof EffortSchema>

/**
 * Phase D2 — notice slots driven by config.  `emergency.tip` populates the
 * one-line message under the welcome box; `color` selects palette (defaults
 * to dim).  Unset → no tip.  A future remote-fetch source can layer onto
 * this without touching the EmergencyTip component.
 */
export const NoticesConfigSchema = z
  .object({
    emergency: z
      .object({
        tip: z.string().min(1),
        color: z.enum(['dim', 'warning', 'error']).optional(),
      })
      .optional(),
  })
  .optional()
export type NoticesConfig = z.infer<typeof NoticesConfigSchema>

export const ConfigSchema = z.object({
  /**
   * Schema version. Defaults to 1 when absent so unversioned (pre-migrations)
   * configs continue to parse. Bumped by migrations under
   * `src/core/config/migrations/`.
   */
  version: z.number().int().positive().default(1),
  providers: z.array(ProviderConfigSchema).default([]),
  active: ActiveSelectionSchema.default({ providerId: '' }),
  theme: ThemeSchema,
  compact: CompactSchema,
  search: SearchSchema,
  plugins: PluginsConfigSchema,
  vim: VimConfigSchema,
  rewind: RewindConfigSchema,
  statusLine: StatusLineConfigSchema,
  statusBar: StatusBarConfigSchema,
  harness: HarnessConfigSchema,
  /** Phase 14c — /recap and autoDream settings. */
  recap: RecapConfigSchema,
  /** Phase D2 — notice slots (emergency tip etc.) driven by config. */
  notices: NoticesConfigSchema,
  /** Reasoning effort for thinking-capable models (low/medium/high). */
  effort: EffortSchema,
  /**
   * Enterprise-only: dot-paths that cannot be overridden by lower-priority scopes.
   * Declared in the enterprise config; ignored if declared in other scopes.
   * e.g. ["providers.openai.apiKey"]
   */
  locked: z.array(z.string()).optional(),
  /**
   * 2026-05-18 — team-memory scope. When set, the agent loads team
   * memory entries from `~/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md`
   * in addition to the per-cwd project memory. Plain string by design:
   * the value is treated as an opaque identifier and only ever
   * interpolated into a filesystem path via the `teamMemoryPath`
   * helper (which sanitizes / containment-checks the result).
   */
  teamId: z.string().min(1).optional(),
})
export type Config = z.infer<typeof ConfigSchema>
