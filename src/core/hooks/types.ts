// src/core/hooks/types.ts

export type HookEvent = 'beforeToolCall' | 'afterToolCall' | 'afterTurn' | 'beforeAutoCompact'

export type HookEntry = {
  event: HookEvent
  /** Optional tool-name filter; only applies to beforeToolCall / afterToolCall */
  tool?: string
  /** Shell command; hook payload JSON is piped to stdin */
  command: string
  /** Milliseconds before the hook process is killed; default 10_000 */
  timeoutMs?: number
}

export type HookResult =
  | { ok: true; cancel?: boolean; reason?: string; stdout: string }
  | { ok: false; error: string }
