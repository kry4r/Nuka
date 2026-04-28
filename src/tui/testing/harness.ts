// src/tui/testing/harness.ts
//
// Phase 9 §6 — `mountApp` wrapper around ink-testing-library `render`.
//
// Provides a thin, headless mount surface for the runner:
//
//     const h = mountApp({ target: 'wizard' })
//     h.stdin.write('\r')
//     await h.waitFor({ contains: 'Pick' })
//     h.unmount()
//
// Targets:
//   'app'    — full <App {...minimalDeps}>; mocks.provider is plumbed through
//              a real ProviderResolver via the `providers` injection arg.
//   'wizard' — the standalone onboarding <Wizard>; useful for plans that
//              focus on the wizard alone without the full agent loop.
//   'custom' — pass `node` directly; the harness doesn't construct anything.
//
// IMPORTANT (ink-testing-library quirk): `useInput` in ink-testing-library
// does not always receive a real `setRawMode`, so some keys can be swallowed
// across re-renders. `waitFor` polls `frames()` (with `setImmediate` flushes
// between polls) rather than reading once after `stdin.write`.
//
// Phase 10 §4.2 — `setRawMode` shim. Some hosts (CI, vitest) provide a
// process.stdin without setRawMode; ink hooks gate keystroke delivery on
// that method's existence. We monkey-patch a no-op shim before render so
// `useInput` consumers receive characters from the test stdin.

import React from 'react'
import { render } from 'ink-testing-library'
import type { Config } from '../../core/config/schema'
import type { LLMProvider } from '../../core/provider/types'
import { ProviderResolver } from '../../core/provider/resolver'
import { SessionManager } from '../../core/session/manager'
import { ToolRegistry } from '../../core/tools/registry'
import { SlashRegistry } from '../../slash/registry'
import { CostTracker } from '../../core/cost/tracker'
import { PermissionBridge } from '../../core/permission/bridge'
import { App } from '../App'
import { Wizard } from '../Onboarding/Wizard'
import type { AssertSpec } from '../../core/testing/plan'
import type { TodoState } from '../../core/tools/todoWrite'
import type { TaskManager } from '../../core/tasks/manager'

// --- Inline mini-matcher for waitFor() ------------------------------------
// `runner.ts` (9.3) imports the canonical matcher from `assertions.ts`. We
// keep a tiny inline copy here so the harness module can stand alone (and so
// 9.2.b can land before 9.3). The behavior is intentionally identical for
// the assertion shapes we support; if assertions.ts diverges later, swap the
// import.
function harnessMatch(spec: AssertSpec, frames: string[]): { ok: boolean; message?: string } {
  const last = frames[frames.length - 1] ?? ''
  if ('contains' in spec) {
    return last.includes(spec.contains)
      ? { ok: true }
      : { ok: false, message: `expected last frame to contain ${JSON.stringify(spec.contains)}` }
  }
  if ('notContains' in spec) {
    return !last.includes(spec.notContains)
      ? { ok: true }
      : { ok: false, message: `expected last frame to NOT contain ${JSON.stringify(spec.notContains)}` }
  }
  if ('regex' in spec) {
    return new RegExp(spec.regex).test(last)
      ? { ok: true }
      : { ok: false, message: `expected last frame to match /${spec.regex}/` }
  }
  if ('equals' in spec) {
    return last === spec.equals
      ? { ok: true }
      : { ok: false, message: `expected last frame to equal exact text` }
  }
  if ('frameCount' in spec) {
    return frames.length === spec.frameCount
      ? { ok: true }
      : { ok: false, message: `expected ${spec.frameCount} frames, got ${frames.length}` }
  }
  if ('lastFrameMatches' in spec) {
    const lf = spec.lastFrameMatches
    if ('regex' in lf) {
      return new RegExp(lf.regex).test(last) ? { ok: true } : { ok: false, message: `regex mismatch` }
    }
    return last.includes(lf.contains) ? { ok: true } : { ok: false, message: `contains mismatch` }
  }
  return { ok: false, message: 'unknown assertion shape' }
}

export type Mocks = {
  /** Mock provider; will be installed under its `id` in the ProviderResolver. */
  provider?: LLMProvider
}

export type MountOpts =
  | {
      target?: 'app'
      config?: Config
      mocks?: Mocks
      cwd?: string
      slash?: SlashRegistry
      /** Phase 12 M3 — inject a pre-populated todo store for Tasks panel tests. */
      todoStore?: TodoState
      /** Phase 12 M3 — inject a task manager for Tasks panel tests. */
      taskManager?: TaskManager
    }
  | { target: 'wizard'; mocks?: Mocks }
  | { target: 'custom'; node: React.ReactNode }

export type Harness = {
  stdin: { write: (data: string) => void }
  frames: () => string[]
  unmount: () => void
  waitFor: (spec: AssertSpec, timeoutMs?: number) => Promise<void>
  /** The PermissionBridge wired into the App (for tests that need to drive
   *  the permission inline-submenu directly via `permissionBridge.ask(...)`). */
  permissionBridge: PermissionBridge
}

/**
 * Build the minimal set of App props for headless mounts. Real instances of
 * lightweight in-memory components (SessionManager, SlashRegistry, ToolRegistry,
 * PermissionBridge, ProviderResolver-with-injection); a no-op runAgent.
 *
 * Plan authors who need richer wiring should pass `target:'custom'` and pass
 * a fully-constructed <App/> as `node`.
 */
export function makeMinimalAppDeps(
  config: Config | undefined,
  mocks: Mocks = {},
  cwd: string = process.cwd(),
  slashOverride?: SlashRegistry,
) {
  const cfg: Config = config ?? ({
    providers: [],
    active: { providerId: '' },
  } as unknown as Config)
  const sessions = new SessionManager()
  const providerOverrides = mocks.provider ? { [mocks.provider.id]: mocks.provider } : {}
  const providers = new ProviderResolver(cfg, { providers: providerOverrides })
  const slash = slashOverride ?? new SlashRegistry()
  const tools = new ToolRegistry()
  const permissionBridge = new PermissionBridge()
  const costTracker = new CostTracker()

  // Determine an active session so the App can render. Prefer the mock
  // provider; otherwise the first configured provider; otherwise blank.
  const activeId = mocks.provider?.id
    ?? cfg.active?.providerId
    ?? cfg.providers?.[0]?.id
    ?? ''
  const activeModel = cfg.providers?.find(p => p.id === activeId)?.selectedModel
    ?? cfg.providers?.find(p => p.id === activeId)?.models?.[0]
    ?? 'mock-model'
  sessions.start({ providerId: activeId, model: activeModel })

  return {
    sessions, providers, slash, tools, permissionBridge, costTracker,
    config: cfg, cwd,
  }
}

export function mountApp(opts: MountOpts = {}): Harness {
  // Phase 10 §4.2 — setRawMode shim. Some hosts/CI runners give us a stdin
  // without setRawMode; ink's useInput hook gates keystroke delivery on it.
  // Patch a no-op once so subsequent renders pick it up.
  const stdinAny = process.stdin as { setRawMode?: (m: boolean) => unknown; isTTY?: boolean }
  if (stdinAny.setRawMode === undefined) {
    stdinAny.setRawMode = () => process.stdin
  }

  let node: React.ReactNode
  // Always retain a PermissionBridge handle so the harness can expose it on
  // every mount target — even `wizard`/`custom` callers can call
  // `h.permissionBridge.ask(...)` (which simply resolves to denied if no
  // App is mounted, since no handler will ever be set).
  let bridge: PermissionBridge
  if (opts.target === 'custom') {
    node = opts.node
    bridge = new PermissionBridge()
  } else if (opts.target === 'wizard') {
    node = React.createElement(Wizard, {
      onDone: () => {},
      onCancel: () => {},
    })
    bridge = new PermissionBridge()
  } else {
    const deps = makeMinimalAppDeps(opts.config, opts.mocks, opts.cwd, opts.slash)
    bridge = deps.permissionBridge
    node = React.createElement(App, {
      sessions: deps.sessions,
      slash: deps.slash,
      providers: deps.providers,
      config: deps.config,
      runAgent: async function* () { /* noop */ },
      permissionBridge: deps.permissionBridge,
      onExit: () => {},
      onOpenEditor: () => {},
      compactSession: async () => {},
      cwd: deps.cwd,
      gitBranch: { branch: 'main', dirty: false },
      version: '0.0.0-test',
      tools: deps.tools,
      costTracker: deps.costTracker,
      ...(opts.todoStore !== undefined ? { todoStore: opts.todoStore } : {}),
      ...(opts.taskManager !== undefined ? { taskManager: opts.taskManager } : {}),
    })
  }

  const inst = render(node as React.ReactElement)

  const frames = (): string[] => {
    // ink-testing-library exposes `frames` as a string[] property.
    return (inst as unknown as { frames: string[] }).frames.slice()
  }

  const flush = () => new Promise<void>(r => setImmediate(r))

  const waitFor = async (spec: AssertSpec, timeoutMs = 250): Promise<void> => {
    const start = Date.now()
    // Initial flush — many keystrokes require one event-loop tick to settle.
    await flush()
    while (true) {
      const fs = frames()
      const r = harnessMatch(spec, fs)
      if (r.ok) return
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`waitFor: timed out after ${timeoutMs}ms — ${r.message}`)
      }
      await flush()
      await new Promise(res => setTimeout(res, 5))
    }
  }

  return {
    stdin: inst.stdin,
    frames,
    unmount: () => inst.unmount(),
    waitFor,
    permissionBridge: bridge,
  }
}
