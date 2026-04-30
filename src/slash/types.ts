import type { SessionManager } from '../core/session/manager'
import type { ProviderResolver } from '../core/provider/resolver'
import type { Config } from '../core/config/schema'
import type { CostTracker } from '../core/cost/tracker'
import type { TaskManager } from '../core/tasks/manager'

export type DialogDescriptor =
  | { kind: 'model-picker' }
  | { kind: 'config' }
  | { kind: 'session-picker' }
  | { kind: 'stats' }
  | { kind: 'doctor'; report: import('../core/doctor/run').DoctorReport }
  | { kind: 'message-selector'; messages: import('../core/message/types').AssistantMessage[] }
  // Phase 14b — monitor dashboard
  | { kind: 'monitor' }

export type SessionEffect =
  | { kind: 'new-session' }
  | { kind: 'branch-session' }
  | { kind: 'clear-screen' }
  | { kind: 'compact' }

export type SlashResult =
  | { type: 'text'; text: string }
  | { type: 'dialog'; dialog: DialogDescriptor }
  | { type: 'effect'; effect: SessionEffect }
  | { type: 'exit' }

export type SlashContext = {
  sessions: SessionManager
  providers: ProviderResolver
  config: Config
  /** Phase 7 §5.2 — optional; absent in legacy tests / programmatic embeds. */
  costTracker?: CostTracker
  /** Phase 10 §4.3 — optional; wired by cli.tsx when the task system is enabled. */
  taskManager?: TaskManager
}

export interface SlashCommand {
  name: string            // without leading slash
  description: string
  usage?: string
  /** Where this command originated. Defaults to 'builtin'. */
  source?: 'builtin' | 'plugin' | 'skill'
  /** Optional keyboard shortcut label (display-only). */
  shortcut?: string
  /** Positional / named arguments this command accepts. */
  args?: { name: string; choices?: string[]; description?: string }[]
  /** Example invocations shown in arg-hint card. */
  examples?: string[]
  run(args: string, ctx: SlashContext): Promise<SlashResult>
}
