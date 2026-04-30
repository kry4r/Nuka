// src/core/testing/slashRegistry.ts
//
// Phase 10 §4.2 — name-to-command map used by the test runner to honor
// `setup.slash: ['ThemeCommand', 'PlanCommand', ...]` entries in plans.
//
// The map is populated lazily (per-name dynamic import) so importing this
// helper in the test-runner bundle does not fan out to every slash module
// on its own. Plan authors can therefore opt in to exactly the commands
// they need to drive without accidentally widening the dependency graph.

import type { SlashCommand } from '../../slash/types'
import { SlashRegistry } from '../../slash/registry'

type Loader = () => Promise<SlashCommand>

const REGISTRY: Record<string, Loader> = {
  BtwCommand:           async () => (await import('../../slash/btw')).BtwCommand,
  ClearCommand:         async () => (await import('../../slash/clear')).ClearCommand,
  CompactCommand:       async () => (await import('../../slash/compact')).CompactCommand,
  CostCommand:          async () => (await import('../../slash/cost')).CostCommand,
  ExitCommand:          async () => (await import('../../slash/exit')).ExitCommand,
  ForkCommand:          async () => (await import('../../slash/fork')).ForkCommand,
  HelpCommand:          async () => (await import('../../slash/help')).HelpCommand,
  IdeCommand:           async () => (await import('../../slash/ide')).IdeCommand,
  MemdirCommand:        async () => (await import('../../slash/memdir')).MemdirCommand,
  ModelCommand:         async () => (await import('../../slash/model')).ModelCommand,
  NewCommand:           async () => (await import('../../slash/new')).NewCommand,
  PlanCommand:          async () => (await import('../../slash/plan')).PlanCommand,
  ResumeCommand:        async () => (await import('../../slash/resume')).ResumeCommand,
  RewindCommand:        async () => (await import('../../slash/rewind')).RewindCommand,
  SettingsCommand:      async () => (await import('../../slash/settings')).SettingsCommand,
  StatsCommand:         async () => (await import('../../slash/stats')).StatsCommand,
  ThemeCommand:         async () => (await import('../../slash/theme')).ThemeCommand,
  VimCommand:           async () => (await import('../../slash/vim')).VimCommand,
  StatusBarCommand:     async () => (await import('../../slash/statusBar')).StatusBarCommand,
  SkillCommand:         async () => (await import('../../slash/skill')).SkillCommand,
  TasksCommand:         async () => (await import('../../slash/tasks')).TasksCommand,
  DoctorCommand:        async () => (await import('../../slash/doctor')).DoctorCommand,
}

/**
 * Build a SlashRegistry from a list of exported command names. Unknown
 * names throw. Used by `runPlan` for `setup.slash`.
 */
export async function buildSlashRegistryFromNames(names: readonly string[]): Promise<SlashRegistry> {
  const reg = new SlashRegistry()
  for (const n of names) {
    const loader = REGISTRY[n]
    if (!loader) {
      const known = Object.keys(REGISTRY).sort().join(', ')
      throw new Error(`unknown slash command export: ${JSON.stringify(n)}. Known: ${known}`)
    }
    reg.register(await loader())
  }
  return reg
}

/** Test-only: read access to the export-name list (for the doc test). */
export function knownSlashNames(): string[] {
  return Object.keys(REGISTRY).sort()
}
