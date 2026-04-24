import type { SessionManager } from '../core/session/manager'
import type { ProviderResolver } from '../core/provider/resolver'
import type { Config } from '../core/config/schema'

export type DialogDescriptor =
  | { kind: 'model-picker' }
  | { kind: 'config-editor' }
  | { kind: 'session-picker' }

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
}

export interface SlashCommand {
  name: string            // without leading slash
  description: string
  usage?: string
  run(args: string, ctx: SlashContext): Promise<SlashResult>
}
