// src/core/hooks/index.ts
//
// Public surface of the hooks core area. This module re-exports two
// orthogonal subsystems that share a directory:
//
//   1. Shell-command hooks (the original Nuka system) — config-driven,
//      loaded from `hooks.json`, executed via `sh -c`. Surface: HookEntry,
//      HookEvent, HookResult, runHooks, loadHooks.
//
//   2. In-process function-based hooks (this iter) — TypeScript handlers
//      registered at runtime via `HookRegistry`. Surface: InProcessHookEvent,
//      HookHandler, HookContext, InvocationResult, HookRegistry,
//      createHookRegistry.
//
// They are intentionally distinct namespaces so each can evolve without
// destabilising the other. Wiring `HookRegistry` into the actual tool
// execution / prompt-submit code paths is a separate iter.

// Shell-command hooks (existing).
export { runHooks, type RunHooksOptions } from './runner'
export { loadHooks } from './loader'
export type { HookEntry, HookEvent, HookResult } from './types'

// Iter OOOO — shell ↔ in-process bridge. Side-channel that fires
// `shellHookExecuted` on the in-process registry after every shell hook
// execution. See shellBridge.ts for the design rationale.
export {
  fireShellHookExecuted,
  hookEntryToHookId,
  truncatePreview,
  type ShellHookExecutedPayload,
} from './shellBridge'

// In-process function-based hooks (new).
export {
  IN_PROCESS_HOOK_EVENTS,
  isInProcessHookEvent,
  type InProcessHookEvent,
  type HookContext,
  type HookHandler,
  type HookResult as InProcessHookResult,
  type RegisterOptions,
  type RegisteredHook,
  type InvocationResult,
  type InvokeOptions,
} from './events'

export { HookRegistry, createHookRegistry } from './registry'
export { compareRegisteredHooks, firstSkip, runPipeline, runOneHandler } from './pipeline'
export { wrapWithHooks } from './wrapTool'
export {
  applyHookConfig,
  defaultHookConfigPaths,
  loadHookConfigFile,
  type ApplyHookConfigResult,
  type HookConfigEntry,
  type HookConfigModule,
} from './configLoader'

// Agent-facing introspection tool over the in-process HookRegistry.
// Constructor pattern; see hookListTool.ts header for the security
// rationale (no register surface, no clear-all).
export {
  HOOK_LIST_TOOL_NAME,
  makeHookListTool,
  type HookListAction,
  type HookListClearResult,
  type HookListCountResult,
  type HookListInput,
  type HookListItem,
  type HookListListResult,
  type HookListResult,
} from './hookListTool'

// Lifecycle hook fire helpers — used by cli.tsx (sessionStart/sessionEnd)
// and the agent loop (promptSubmit/afterTurn/beforeAutoCompact). See
// lifecycle.ts for the rationale behind the dedicated module.
export {
  fireSessionStart,
  fireSessionEnd,
  firePromptSubmit,
  fireAfterTurn,
  fireAfterAssistantMessage,
  fireBeforeAutoCompact,
  type SessionStartPayload,
  type SessionEndPayload,
  type PromptSubmitPayload,
  type AfterTurnPayload,
  type AfterAssistantMessagePayload,
  type BeforeAutoCompactPayload,
} from './lifecycle'
