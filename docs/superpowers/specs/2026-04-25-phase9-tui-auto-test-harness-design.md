# Nuka Phase 9 — Self-Driving TUI Auto-Test Harness Design

**Status:** active. Successor to Phase 8. Baseline: `main` HEAD `f322f71`, 1095 tests, `dist/cli.js` 319.3 KB.

**Reference:** Haiku Explore survey 2026-04-25 — `ink-testing-library` already provides the in-process render + stdin/stdout primitives; what's missing is a YAML scenario format, a runner with assertions, and a CLI subcommand to execute test plans without requiring vitest.

## 1. Why Phase 9

After Phase 8, Nuka has 5 dialog-rich UX surfaces (onboarding, stats, theme picker, rewind selector, plan-mode). Component-level tests catch unit regressions, but **end-to-end flows (open CLI → /init → fill wizard → land in main view → /theme → see HUD recolor) are unreproduced**. We want:

1. A reproducible scenario format any contributor (or AI agent) can write.
2. Headless execution under `npm test` (vitest) AND as a top-level subcommand `nuka --test-plan path/to/scenario.yaml`.
3. Snapshot capture + diffing so visual regressions are caught.
4. Mock provider injection so test plans don't need real API keys.

This is the foundation Phase 10+ will lean on for behavioral regression testing of agent flows.

## 2. Goals

| ID | Goal |
|---|---|
| **9.1** | **Plan format** — YAML schema with `name`, `description`, `setup`, `steps[]`, `cleanup`. Steps are tagged unions: `render`, `keystroke`, `wait`, `snapshot`, `assert`, `slash`. |
| **9.2** | **Runner** — `runPlan(plan, opts)` returning `{ok, frames[], failures[]}`. Pure programmatic API; uses `ink-testing-library` `render` + simulated `stdin`. |
| **9.3** | **Assertions** — `contains`, `notContains`, `regex`, `equals`, `frameCount`, `lastFrameMatches`. Failure messages include the actual frame and the expected matcher for diff-style debugging. |
| **9.4** | **Mock provider** — `MockProvider` injectable into `ProviderResolver` so `runAgent` works without network. Returns scripted `assistant` deltas + `usage` blocks based on the plan's `mockResponses[]`. |
| **9.5** | **CLI subcommand** — `nuka --test-plan <yaml> [--update-snapshots] [--reporter=tap\|json\|pretty]`. Exit 0 on pass, 1 on failure, 2 on plan-parse error. |
| **9.6** | **Vitest integration** — `runPlan` is callable from a vitest test (`it('plan: onboarding', () => expect(...).resolves.toMatchObject({ok: true}))`). |
| **9.7** | **Sample plans** — five plans covering: offline boot, onboarding wizard, `/theme` switch, `/stats` open/close, plan-mode lockout. Live under `test-plans/` (project root) so contributors discover them easily. |

## 3. Non-goals

- Real PTY (no `node-pty` dependency). The survey concluded ink-testing-library is sufficient for keystroke + frame capture.
- Visual snapshot image diffs (text-only).
- Concurrent plan execution.
- Watch mode / hot-reload.
- Recording user sessions into plans automatically (could be Phase 10).

## 4. Module layout

### New modules
- `src/core/testing/plan.ts` — YAML parser + validator. Throws on malformed plans.
- `src/core/testing/runner.ts` — `runPlan(plan, opts)`. Knows nothing about CLI; pure orchestration.
- `src/core/testing/assertions.ts` — matcher functions; pure, no I/O.
- `src/core/testing/mockProvider.ts` — implements `LLMProvider` with scripted responses.
- `src/core/testing/keystrokes.ts` — exported constants: `ENTER`, `ESC`, `UP`, `DOWN`, `LEFT`, `RIGHT`, `TAB`, `BACKSPACE`, `CTRL_C`, plus `keystroke(name)` helper.
- `src/tui/testing/harness.ts` — `mountApp({config, mocks})` returns `{stdin, frames(), waitFor(matcher, timeout?)}` for use inside `runner`.
- `src/cli.tsx` — `argv` branch for `--test-plan <path>`.
- `test-plans/` — `01-offline-boot.yaml`, `02-onboarding.yaml`, `03-theme-switch.yaml`, `04-stats-view.yaml`, `05-plan-mode-lockout.yaml`.

### Existing modules touched
- `src/cli.tsx` — handler for `--test-plan` arg before the normal interactive path.
- `src/core/provider/resolver.ts` — accept `Map<id, LLMProvider>` injection (already mostly there; small refactor to make `MockProvider` swap clean).
- `src/tui/App.tsx` — accept an optional `clock` prop (deterministic timestamps for snapshots).

## 5. Plan YAML schema

```yaml
name: 03-theme-switch
description: Switching to default-light updates the HUD accent color.

# Optional setup before mounting:
setup:
  config:                          # writes a temp config used for this plan
    providers:
      - id: mock
        type: mock
        apiKey: "test"
        model: claude-sonnet-4-6
    defaultProvider: mock

mockResponses:                     # one response per agent turn
  - delta:
      - { type: text_delta, text: "ok" }
    usage: { input_tokens: 10, output_tokens: 2 }

steps:
  - render: app                    # or "wizard" / "onboarding"
  - assert:
      contains: "Welcome"          # default matcher: lastFrame
  - keystroke: "/theme default-light\n"
  - wait: { ms: 50 }
  - assert:
      lastFrameMatches: { regex: "theme: default-light" }
  - snapshot: theme-light          # writes test-plans/__snapshots__/theme-light.txt

cleanup:
  unmount: true
```

### Step grammar (TypeScript discriminated union):

```ts
type Step =
  | { render: 'app' | 'wizard' | string }              // string = component path
  | { keystroke: string }                              // raw chars; ANSI codes via \u001B
  | { wait: { ms: number } | { until: AssertSpec; timeoutMs?: number } }
  | { snapshot: string }                               // name; writes if --update-snapshots, else compares
  | { assert: AssertSpec }
  | { slash: string }                                  // shortcut: types "/foo args\n"
  | { mock: { provider: { append: ProviderResponse } } } // dynamic mock manipulation

type AssertSpec =
  | { contains: string }
  | { notContains: string }
  | { regex: string }
  | { equals: string }
  | { frameCount: number }
  | { lastFrameMatches: { regex: string } | { contains: string } }
```

## 6. Runner contract

```ts
export type RunOpts = {
  cwd?: string                          // default: process.cwd
  home?: string                         // default: tmp dir
  updateSnapshots?: boolean             // default: false
  reporter?: 'tap' | 'json' | 'pretty'  // CLI only
  clock?: () => number                  // injected for deterministic ts
}

export async function runPlan(plan: Plan, opts: RunOpts = {}): Promise<RunResult>

export type RunResult = {
  ok: boolean
  steps: Array<{ index: number; ok: boolean; message?: string; frame?: string }>
  frames: string[]
  durationMs: number
}
```

CLI side serializes `RunResult` per the `--reporter`. `pretty` uses ANSI; `tap` for vitest output piping; `json` for CI machine-reading.

## 7. Mock provider

```ts
export class MockProvider implements LLMProvider {
  constructor(private responses: ProviderResponse[]) {}
  async *streamMessage(req): AsyncIterable<ProviderEvent> {
    const r = this.responses.shift()
    if (!r) throw new Error('mock: no scripted response left')
    for (const d of r.delta) yield d
    if (r.usage) yield { type: 'usage', ...r.usage }
    yield { type: 'message_stop' }
  }
}
```

Plan can append responses mid-run via the `mock` step (for multi-turn flows).

## 8. Failure modes & semantics

- `assert` fails → step records the failure but execution continues to allow capturing follow-on frames; runner returns `ok: false`.
- `wait { until }` times out → assertion fails with `"timed out waiting for ..."`.
- `snapshot` mismatch → diff is rendered (line-by-line); `--update-snapshots` re-writes the file silently.
- Plan parse error → exit 2 with the YAML error including line/column.
- Mock runs out of scripted responses → throws; runner catches and reports the step.

## 9. Acceptance

- `npm test` ≥ 1140 (1095 + ~45 new).
- `npm run typecheck` clean.
- `npm run build` ≤ 360 KB.
- `nuka --test-plan test-plans/01-offline-boot.yaml` exits 0 with `pretty` reporter showing 5+ green steps.
- All 5 sample plans pass.
- A failing assertion produces a clear actual-vs-expected output.

## 10. Out of scope (Phase 10+)

- Recording user sessions into plans.
- True PTY testing (mouse, cursor positioning).
- Network/MCP server fixtures (mock at the LLMProvider boundary only).
- Concurrency / sharded test runs.
- Snapshot image diffs.
