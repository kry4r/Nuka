# Auto-Compact Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the two coexisting auto-compact code paths (legacy session-aware `src/core/compact/auto.ts` and pure `src/core/agent/autoCompact.ts`) into a single pure implementation, fronted by a thin `compactSessionAware(session, deps)` wrapper that preserves session metadata. Legacy file is deleted, `NUKA_AUTOCOMPACT_MODE=pure` opt-in becomes the default, and every caller migrates with NO behavioural regression.

**Architecture:** The pure path (`maybeAutoCompactPure(messages, config, deps)`) is content-correct but ignores `Session.totalUsage` and `Session.updatedAt`. We add a sibling helper `compactSessionAware(session, deps)` next to it that (a) computes the trigger threshold from `session.totalUsage`, (b) delegates the actual fold to `maybeAutoCompactPure(session.messages, ...)`, and (c) writes the resulting messages array + `updatedAt` back onto the session. After every legacy caller migrates, `src/core/compact/auto.ts` is deleted along with its tests and the `autoCompactPure` opt-in gate (`isPureAutoCompactEnabled`) is removed — the wrapper IS the new path. `compactSession` in `src/core/compact/compact.ts` is preserved (it's the user-driven `/compact` slash command's summary generator and is orthogonal to auto-compact).

**Tech Stack:** TypeScript (strict), Vitest

---

## Exhaustive Caller Inventory

Computed via `rg "from .*compact/auto'" -n` + `rg "maybeAutoCompact\b|shouldAutoCompact\b" -n`:

| File | Line(s) | Symbol(s) imported | Migration action |
|------|---------|--------------------|------------------|
| `src/core/agent/loop.ts` | 18, 19, 502 | `AutoCompactOpts` type, `maybeAutoCompact` fn | Replace `maybeAutoCompact(session, deps.autoCompact)` with `compactSessionAware(session, deps)`. Delete the `isPureAutoCompactEnabled` block (lines ~508-541) — the wrapper IS the pure path. |
| `src/core/agent/loop.ts` | 20, 21, 524 | `AutoCompactPureConfig`, `maybeAutoCompactPure` | Keep the pure import (now sourced from the wrapper's neighbour). Remove the duplicate fire site once the wrapper subsumes it. |
| `src/cli.tsx` | 101 | `AutoCompactOpts` (type) | Replace with `AutoCompactSessionAwareOpts` (new exported type from the wrapper module). |
| `test/core/agent/loop.test.ts` | 9 | `AutoCompactOpts` (type) | Replace with new type alias. |
| `test/core/compact/auto.test.ts` | 3, 6 | `shouldAutoCompact`, `maybeAutoCompact`, `AutoCompactOpts` | DELETE — covered by new `compactSessionAware.test.ts`. |
| `test/core/agent/loopAutoCompactWiring.test.ts` | 77, 80, 84, 85, 114-141, 304-… | env var `NUKA_AUTOCOMPACT_MODE`, gating tests | DELETE the env-var gating cases. Keep the integration test of "compaction happens on threshold". |
| `README.md` | 72, 268 | docs for `NUKA_AUTOCOMPACT_MODE=pure` | Update: remove env-var row from feature table and env-var section. |
| `docs/plans/2026-05-17-nuka-feature-port-status.md` | 61, 196, 252 | references to dual path | Annotate as "unified 2026-05-18 — see autocompact-unification plan". |

NOTE — `compactSession` in `src/core/compact/compact.ts` is NOT a caller of the legacy auto path; it's the orthogonal user-driven summarizer. It stays.

---

## File Structure

```
src/core/agent/autoCompact.ts                  # MODIFY — add compactSessionAware + types
src/core/agent/loop.ts                         # MODIFY — replace legacy call with wrapper, drop pure-gate
src/cli.tsx                                    # MODIFY — swap AutoCompactOpts type
src/core/compact/auto.ts                       # DELETE
test/core/agent/autoCompact.test.ts            # MODIFY — add compactSessionAware cases
test/core/compact/auto.test.ts                 # DELETE
test/core/agent/loopAutoCompactWiring.test.ts  # MODIFY — drop env-gate cases, keep integration
test/core/agent/loop.test.ts                   # MODIFY — swap type import
README.md                                      # MODIFY — drop NUKA_AUTOCOMPACT_MODE row
docs/plans/2026-05-17-nuka-feature-port-status.md  # MODIFY — annotate
```

---

## Task 1 — write failing test for `compactSessionAware`

- [ ] **Files:**
  - Modify: `test/core/agent/autoCompact.test.ts` (append new describe block)

- [ ] Append:

```typescript
import { describe, it, expect } from 'vitest'
import { compactSessionAware } from '../../../src/core/agent/autoCompact'
import type { Session } from '../../../src/core/session/types'
import { PermissionCache } from '../../../src/core/permission/cache'
import { MessageQueue } from '../../../src/core/session/queue'
import type { Message } from '../../../src/core/message/types'

function makeSession(messages: Message[]): Session {
  return {
    id: 'sess-1',
    providerId: 'p',
    model: 'm',
    messages,
    totalUsage: { inputTokens: 100_000, outputTokens: 50_000 },
    permissionCache: new PermissionCache(),
    queue: new MessageQueue(),
    mode: 'normal',
    createdAt: 1,
    updatedAt: 1,
    unDeferredToolNames: new Set(),
  }
}

describe('compactSessionAware', () => {
  it('returns compacted=false below threshold and leaves session untouched', async () => {
    const s = makeSession([
      { role: 'user', content: [{ type: 'text', text: 'short' }], id: 'm1' } as Message,
    ])
    s.totalUsage = { inputTokens: 10, outputTokens: 5 }
    const before = s.messages
    const out = await compactSessionAware(s, {
      triggerTokens: 1_000_000,
      targetTokens: 500_000,
      contextWindow: 200_000,
      autoThreshold: 0.8,
    })
    expect(out.compacted).toBe(false)
    expect(s.messages).toBe(before)
    expect(s.updatedAt).toBe(1)  // unchanged
  })

  it('compacts and writes new messages + updatedAt when over threshold', async () => {
    const bigText = 'x'.repeat(20_000)
    const msgs: Message[] = []
    for (let i = 0; i < 30; i++) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: bigText }], id: `u${i}` } as Message)
      msgs.push({ role: 'assistant', content: [{ type: 'text', text: bigText }], id: `a${i}` } as Message)
    }
    const s = makeSession(msgs)
    s.totalUsage = { inputTokens: 200_000, outputTokens: 100_000 }
    const before = s.messages
    const beforeUpdatedAt = s.updatedAt
    const out = await compactSessionAware(s, {
      triggerTokens: 50_000,
      targetTokens: 20_000,
      contextWindow: 200_000,
      autoThreshold: 0.5,
    })
    expect(out.compacted).toBe(true)
    expect(s.messages).not.toBe(before)
    expect(s.messages.length).toBeLessThan(before.length)
    expect(s.updatedAt).toBeGreaterThan(beforeUpdatedAt)
    // totalUsage is intentionally NOT zeroed — the next provider call's
    // inputTokens reflects the shorter prompt, mirroring legacy behaviour.
    expect(s.totalUsage.inputTokens).toBe(200_000)
  })

  it('preserves session metadata (id, providerId, mode, queue, permissionCache)', async () => {
    const msgs: Message[] = []
    const big = 'y'.repeat(10_000)
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: big }], id: `u${i}` } as Message)
    }
    const s = makeSession(msgs)
    s.totalUsage = { inputTokens: 150_000, outputTokens: 60_000 }
    const origQueue = s.queue
    const origCache = s.permissionCache
    await compactSessionAware(s, {
      triggerTokens: 30_000,
      targetTokens: 10_000,
      contextWindow: 200_000,
      autoThreshold: 0.5,
    })
    expect(s.id).toBe('sess-1')
    expect(s.providerId).toBe('p')
    expect(s.mode).toBe('normal')
    expect(s.queue).toBe(origQueue)
    expect(s.permissionCache).toBe(origCache)
  })
})
```

- [ ] Run: `npx vitest run test/core/agent/autoCompact.test.ts` — expect FAIL (`compactSessionAware` not exported).

- [ ] Commit: `test(autocompact): failing spec for compactSessionAware wrapper`

---

## Task 2 — implement `compactSessionAware` in `autoCompact.ts`

- [ ] **Files:**
  - Modify: `src/core/agent/autoCompact.ts`

- [ ] Append to the file:

```typescript
import type { Session } from '../session/types'

/**
 * Session-aware options that mirror the legacy `AutoCompactOpts` shape so
 * call sites can migrate with a one-line type swap. Internally this is
 * folded down to the pure `AutoCompactConfig`.
 *
 * - `autoThreshold` * `contextWindow` defines the trigger boundary
 *   measured against `session.totalUsage.inputTokens + outputTokens`.
 *   Below the boundary, no compaction happens.
 * - `targetTokens` is the pure-orchestrator's iterative-prune target
 *   AFTER the fold. Defaults to `contextWindow * (autoThreshold * 0.5)`
 *   when omitted — half of the trigger, matching the legacy "keepTurns"
 *   intuition of "shrink well below threshold so we don't immediately
 *   re-compact on the next turn".
 */
export interface AutoCompactSessionAwareOpts {
  autoThreshold: number
  contextWindow: number
  targetTokens?: number
  preserveRecent?: number
  summarize?: (messages: Message[]) => Promise<string>
}

/** Result of a session-aware compaction pass. */
export interface CompactSessionAwareResult {
  compacted: boolean
  before: number
  after: number
  reason?: 'below-threshold' | 'vetoed-by-hook' | 'nothing-to-compact'
}

/**
 * Session-aware wrapper around {@link maybeAutoCompact}. The single
 * production entry point for auto-compaction after the 2026-05-18
 * unification. Reads the trigger from `session.totalUsage`, delegates
 * the structural fold to the pure orchestrator, and writes the
 * resulting `messages` + `updatedAt` back onto the session in place.
 *
 * Mutates `session.messages` and `session.updatedAt` only when the
 * orchestrator returns `compacted: true`. `session.totalUsage` is left
 * unchanged on purpose: the StatusBar / CostBar reads cumulative usage
 * from it, and the next provider call's `inputTokens` will reflect the
 * shorter prompt automatically (this matches the legacy
 * `compact/auto.ts` semantics, which were correct).
 */
export async function compactSessionAware(
  session: Session,
  opts: AutoCompactSessionAwareOpts,
  deps: { hookRegistry?: HookRegistry; signal?: AbortSignal } = {},
): Promise<CompactSessionAwareResult> {
  const usageTokens = session.totalUsage.inputTokens + session.totalUsage.outputTokens
  const trigger = Math.floor(opts.contextWindow * opts.autoThreshold)
  if (usageTokens <= trigger) {
    return {
      compacted: false,
      reason: 'below-threshold',
      before: usageTokens,
      after: usageTokens,
    }
  }

  const target = opts.targetTokens ?? Math.floor(opts.contextWindow * opts.autoThreshold * 0.5)
  const config: AutoCompactConfig = {
    triggerTokens: trigger,
    targetTokens: target,
    sessionId: session.id,
  }
  if (opts.preserveRecent !== undefined) config.preserveRecent = opts.preserveRecent
  if (opts.summarize) config.summarize = opts.summarize

  const result = await maybeAutoCompact(session.messages, config, deps)
  if (!result.compacted) {
    return {
      compacted: false,
      reason: result.reason,
      before: usageTokens,
      after: usageTokens,
    }
  }

  // Swap the transcript in place. `appendMessage` replaces the array
  // reference on every append, so assigning here keeps React/Ink
  // consumers consistent with the rest of the loop.
  session.messages = result.messages
  session.updatedAt = Date.now()

  return {
    compacted: true,
    before: result.before.estimatedTokens,
    after: result.after.estimatedTokens,
  }
}
```

- [ ] Run: `npx vitest run test/core/agent/autoCompact.test.ts` — expect PASS for the new describe block.

- [ ] Run: `npx tsc --noEmit` — expect no errors.

- [ ] Commit: `feat(autocompact): add compactSessionAware wrapper over pure orchestrator`

---

## Task 3 — migrate `src/core/agent/loop.ts` to the wrapper

- [ ] **Files:**
  - Modify: `src/core/agent/loop.ts`

- [ ] Replace the imports (lines 18-21):

```typescript
// REMOVE:
import type { AutoCompactOpts } from '../compact/auto'
import { maybeAutoCompact } from '../compact/auto'
import type { AutoCompactConfig as AutoCompactPureConfig } from './autoCompact'
import { maybeAutoCompact as maybeAutoCompactPure } from './autoCompact'

// REPLACE WITH:
import type { AutoCompactSessionAwareOpts } from './autoCompact'
import { compactSessionAware } from './autoCompact'
```

- [ ] Delete the `isPureAutoCompactEnabled` function (lines ~78-83) entirely.

- [ ] In `RunAgentDeps` (lines 85-182), replace the `autoCompact` + `autoCompactPure` fields with a single field:

```typescript
  /**
   * 2026-05-18 unification — single auto-compact entry point. When
   * provided, the agent loop calls `compactSessionAware(session, opts)`
   * after each turn-end. The pure orchestrator handles its own
   * threshold gate, hook veto, and structural fold.
   */
  autoCompact?: AutoCompactSessionAwareOpts
```

- [ ] Replace the two compaction blocks (lines ~479-541) with a single block:

```typescript
      if (deps.autoCompact) {
        const result = await compactSessionAware(
          session,
          deps.autoCompact,
          { hookRegistry: deps.hookRegistry, signal },
        )
        if (result.compacted) {
          yield { type: 'auto_compacted', before: result.before, after: result.after }
        }
      }
```

The legacy `runHooks(deps.hooks, 'beforeAutoCompact', ...)` shell-hook fire is preserved by the pure orchestrator's `fireBeforeAutoCompact` call inside `maybeAutoCompact` — BUT the legacy block was firing BOTH the shell `runHooks` AND the in-process `fireBeforeAutoCompact`. The pure orchestrator only fires the in-process one. To preserve shell-hook parity, prepend the shell-hook fire before the wrapper call:

```typescript
      if (deps.autoCompact) {
        let skipCompact = false
        if (deps.hooks && deps.hooks.length > 0) {
          const beforeTokens = session.totalUsage.inputTokens + session.totalUsage.outputTokens
          const veto = await runHooks(
            deps.hooks,
            'beforeAutoCompact',
            { event: 'beforeAutoCompact', tokensBefore: beforeTokens },
            { registry: deps.hookRegistry },
          )
          if (veto.cancel) skipCompact = true
        }
        if (!skipCompact) {
          const result = await compactSessionAware(
            session,
            deps.autoCompact,
            { hookRegistry: deps.hookRegistry, signal },
          )
          if (result.compacted) {
            yield { type: 'auto_compacted', before: result.before, after: result.after }
          }
        }
      }
```

- [ ] Run: `npx tsc --noEmit` — expect no errors.

- [ ] Run: `npx vitest run test/core/agent/loop.test.ts` — expect the test file FAILS on the import line (next task fixes it).

- [ ] Commit: `refactor(loop): consume compactSessionAware in place of dual auto-compact paths`

---

## Task 4 — migrate `cli.tsx`, `test/core/agent/loop.test.ts`

- [ ] **Files:**
  - Modify: `src/cli.tsx`
  - Modify: `test/core/agent/loop.test.ts`

- [ ] In `src/cli.tsx`, find the line `import type { AutoCompactOpts } from './core/compact/auto'` (line 101) and replace:

```typescript
import type { AutoCompactSessionAwareOpts } from './core/agent/autoCompact'
```

- [ ] Grep the file for any local variable typed `AutoCompactOpts` and rename to `AutoCompactSessionAwareOpts`. The field set is identical (`autoThreshold`, `contextWindow`, optional `targetTokens` / `preserveRecent` / `summarize`); `keepTurns` and `model` from the legacy `AutoCompactOpts` were only consumed by the legacy `compactSession` provider-summarizer path and are dropped by the unification — confirm with grep that nothing else in `cli.tsx` references them.

- [ ] In `test/core/agent/loop.test.ts`, the line:

```typescript
import type { AutoCompactOpts } from '../../../src/core/compact/auto'
```

becomes:

```typescript
import type { AutoCompactSessionAwareOpts as AutoCompactOpts } from '../../../src/core/agent/autoCompact'
```

(The `as` keeps any local references compiling without renaming each usage.)

- [ ] Run: `npx tsc --noEmit` — expect no errors.
- [ ] Run: `npx vitest run test/core/agent/loop.test.ts` — expect PASS.

- [ ] Commit: `refactor(autocompact): swap AutoCompactOpts type at all call sites`

---

## Task 5 — clean up `loopAutoCompactWiring.test.ts`

- [ ] **Files:**
  - Modify: `test/core/agent/loopAutoCompactWiring.test.ts`

- [ ] Open the file and locate every block that:
  - Reads/writes `process.env['NUKA_AUTOCOMPACT_MODE']` (lines 77-141, 304-…)
  - References `isPureAutoCompactEnabled`

- [ ] Delete:
  - The standalone `describe('isPureAutoCompactEnabled', ...)` block (lines ~110-130).
  - The env-var save/restore boilerplate at lines 77-85, 133-141.
  - The test `'compacts when env var NUKA_AUTOCOMPACT_MODE=pure is set even with mode=session'` at line 304.

- [ ] Keep:
  - Tests that exercise `compactSessionAware` end-to-end via the loop (rename them if needed to drop the "pure" suffix; they now describe the only path).
  - Any veto-hook test (the in-process `beforeAutoCompact` veto path is preserved).

- [ ] Run: `npx vitest run test/core/agent/loopAutoCompactWiring.test.ts` — expect PASS.

- [ ] Commit: `test(autocompact): drop NUKA_AUTOCOMPACT_MODE env-gate cases (unified path)`

---

## Task 6 — delete `src/core/compact/auto.ts` and its tests

- [ ] **Files:**
  - Delete: `src/core/compact/auto.ts`
  - Delete: `test/core/compact/auto.test.ts`

- [ ] Sanity grep BEFORE deletion: `rg "from .*compact/auto'" -n` — must return ZERO matches (everything migrated in Tasks 3-5).

- [ ] Delete both files:

```bash
git rm src/core/compact/auto.ts
git rm test/core/compact/auto.test.ts
```

- [ ] Run: `npx tsc --noEmit` — expect no errors.
- [ ] Run: `npx vitest run` — expect green (modulo the four pre-existing skipped baseline tests).

- [ ] Commit: `refactor(autocompact): delete legacy compact/auto.ts after migration`

---

## Task 7 — update README + status doc

- [ ] **Files:**
  - Modify: `README.md`
  - Modify: `docs/plans/2026-05-17-nuka-feature-port-status.md`

- [ ] In `README.md`:
  - Line 72 (`| **AutoCompact** | Pure orchestrator (\`NUKA_AUTOCOMPACT_MODE=pure\`) with \`{skip:true}\` veto hook |`): change to:

    ```
    | **AutoCompact** | Pure orchestrator + session-aware wrapper, `{skip:true}` veto hook |
    ```

  - Line 268 (env-var table row for `NUKA_AUTOCOMPACT_MODE=pure`): delete the row entirely.

- [ ] In `docs/plans/2026-05-17-nuka-feature-port-status.md`:
  - Lines 61, 196, 252: prepend a `**[Resolved 2026-05-18]** ` marker pointing at `docs/plans/2026-05-18-autocompact-unification.md`.

- [ ] Commit: `docs(autocompact): drop NUKA_AUTOCOMPACT_MODE references; mark unification resolved`

---

## Task 8 — final verification

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx vitest run` — clean (modulo pre-existing skipped baselines).
- [ ] `rg "from .*compact/auto'" -n` — ZERO matches.
- [ ] `rg "NUKA_AUTOCOMPACT_MODE" -n` — ZERO matches in `src/`, only acceptable matches are the historical-record annotations in `docs/plans/2026-05-17-*`.
- [ ] `rg "isPureAutoCompactEnabled" -n` — ZERO matches.

If all four greps return zero (or only the annotated historical references), the unification is complete.

---

## Self-review

- Spec coverage: every legacy caller migrated, legacy file deleted, wrapper preserves session metadata (id, providerId, queue, permissionCache, mode, totalUsage), pure path unchanged.
- Caller migration list is **exhaustive** — based on `rg "from .*compact/auto'"` + `rg "NUKA_AUTOCOMPACT_MODE"`, every match has a corresponding row in the inventory table at the top.
- No placeholders: every code block is a complete drop-in.
- Replace-not-additive: `compact/auto.ts` ends up `git rm`'d; `NUKA_AUTOCOMPACT_MODE` env var ends up undocumented and untouched (any user who still sets it sees no effect because the gate is gone — graceful degradation).
- Strict TS, no new deps. Vitest framework throughout.
- Commit messages: no `Co-Authored-By:` lines.
