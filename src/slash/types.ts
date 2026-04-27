import type { SessionManager } from '../core/session/manager'
import type { ProviderResolver } from '../core/provider/resolver'
import type { Config } from '../core/config/schema'
import type { CostTracker } from '../core/cost/tracker'
import type { McpManager } from '../core/mcp/manager'

export type DialogDescriptor =
  | { kind: 'model-picker' }
  | { kind: 'config-editor' }
  | { kind: 'session-picker' }
  | { kind: 'stats' }
  | { kind: 'doctor'; report: import('../core/doctor/run').DoctorReport }
  | { kind: 'message-selector'; messages: import('../core/message/types').AssistantMessage[] }

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
  /** Phase 8 §4.5 — optional; wired by App when an McpManager is available. */
  mcpManager?: McpManager
}

export interface SlashCommand {
  name: string            // without leading slash
  description: string
  usage?: string
  run(args: string, ctx: SlashContext): Promise<SlashResult>
}
