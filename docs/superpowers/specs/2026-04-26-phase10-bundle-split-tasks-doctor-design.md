# Nuka Phase 10 — Bundle Split + Task System + Doctor + UI Polish Design

**Status:** active. Successor to Phase 9. Baseline: `main` HEAD `0de1e38`, 1159 tests, `dist/cli.js` 361.4 KB.

**Reference:** Phase-9 Gap Closure surfaced four sample-plan downgrades + a 0.4 % bundle-ceiling overage. Plus claude-code parity gaps: task system, `/doctor`, statusline customization. Plus Phase-8 follow-up: `/rewind` dialog wiring.

---

## 1. Goals

| ID | Goal |
|---|---|
| **10.1** | **Bundle split** — production CLI is `dist/cli.js`, testing helpers (mockProvider, harness, runner) move to `dist/test-runner.js` lazy-loaded only when `--test-plan` is invoked. Production bundle target: ≤ 320 KB. |
| **10.2** | **Harness slash routing + plan upgrades** — `mountApp` accepts an optional `slash: SlashRegistry` so sample plans can drive `/theme`, `/plan on`, `/stats` end-to-end. Upgrade `02-onboarding`, `03-theme-switch`, `04-stats-view`, `05-plan-mode-lockout` plans to assert real effects. Plus `setRawMode` shim so `Enter`/arrow keys reach `useInput` consumers. |
| **10.3** | **Task system** — `src/core/tasks/` defines a polymorphic Task type (`local_bash`, `local_agent`, `monitor_mcp`). `TaskManager` runs them in the background, persists output under `~/.nuka/tasks/<id>.log`, supports cancel/kill. `/tasks list/show/cancel` slash commands. Tasks list shows in the HUD ("3 running"). |
| **10.4** | **`/doctor` + `nuka doctor`** — environment diagnostics: node version, OS, `~/.nuka/` perms, providers (probe each), plugins (count + validation status), MCP servers (connection state), LSP servers (spawn check), config (typecheck against schema). Subcommand AND slash. Output sectioned with ✓/✗ and remediation hints. |
| **10.5** | **`/rewind` dialog wiring + statusline customization** — Mount the existing `<MessageSelector>` into `App.tsx` dialog dispatcher. Add `config.statusLine: { format?: string; command?: string; intervalMs?: number }` — `format` is a template (`{provider}/{model} · ctx {ctxPct}% · ${cost}`); `command` runs an external script every `intervalMs` and renders its stdout. |

## 2. Non-goals

- Real distributed task execution (single host).
- Plan-recording / scenario capture (deferred to Phase 11).
- Multi-tenant / shared task store.
- `/doctor` auto-fix mode (read-only diagnostics).
- Tree-shake other phases (only the testing module is split out).

## 3. Module layout

### Existing modules touched
- `package.json` — add a second build entry for `src/core/testing/index.ts` → `dist/test-runner.js`.
- `src/cli.tsx` — `--test-plan` branch dynamic-imports `./test-runner` (the bundled output) instead of `./core/testing/*`.
- `src/tui/testing/harness.ts` — `mountApp` accepts an optional `slash`; passes it to `<App slash={...}>`.
- `src/tui/App.tsx` — add a `'message-selector'` dialog kind that maps to `<MessageSelector>`. Add `<StatusLine config={...}>` consumer.
- `src/core/config/schema.ts` — `statusLine?: StatusLineConfigSchema`.
- `src/core/agent/loop.ts` — `TaskManager` integration for `local_agent` tasks.
- `src/core/mcp/manager.ts` — emit a `task_event` when a long-running MCP call returns (for `monitor_mcp`).

### New modules
- `src/core/tasks/{types,manager,run-bash,run-agent,monitor-mcp,persist}.ts`.
- `src/slash/tasks.ts` (`/tasks list/show/cancel`).
- `src/core/doctor/{run,checks/{node,providers,plugins,mcp,lsp,config,disk}.ts}`.
- `src/slash/doctor.ts`.
- `src/tui/StatusLine/{StatusLine,template}.tsx`.

## 4. Design decisions

### 4.1 Bundle split

The production CLI lazy-imports the testing module only on `--test-plan`. Build script:
```js
// scripts/build.mjs (extend existing)
await build({ entryPoints: ['src/cli.tsx'], outfile: 'dist/cli.js', external: ['./test-runner.js'] })
await build({ entryPoints: ['src/core/testing/cli-entry.ts'], outfile: 'dist/test-runner.js' })
```
`src/core/testing/cli-entry.ts` (new) re-exports `parsePlan`, `runPlan` and is the only thing `cli.tsx` dynamically imports. The `src/tui/testing/harness.ts` and `src/core/testing/*` files stay in source for vitest direct-import.

Acceptance: `dist/cli.js` ≤ 320 KB; `dist/test-runner.js` exists; `nuka --test-plan ...` still works.

### 4.2 Harness slash routing + setRawMode shim

```ts
export type MountOpts = {
  config: Config
  mocks?: { provider?: LLMProvider }
  slash?: SlashRegistry           // NEW
  target?: 'app' | 'wizard'
}
```
When `slash` is provided, `mountApp` registers it on the `<App>` and the harness fires slash effects through the same `cmd.run(args, ctx)` path as production. The `ctx` has stub `sessions`, `providers`, `costTracker` (from mocks). Slash effects (`dialog`, `effect`, `exit`) propagate identically.

`setRawMode` shim: monkeypatch `process.stdin.setRawMode = () => process.stdin` before mounting so `useInput` is enabled. ink-testing-library doesn't gate on raw mode internally; only the consumer hooks do. Tested in 9.6's downgrade analysis.

### 4.3 Task system

```ts
export type TaskKind = 'local_bash' | 'local_agent' | 'monitor_mcp'
export type TaskState = 'pending' | 'running' | 'completed' | 'failed' | 'killed'
export type Task = {
  id: string                      // ulid
  kind: TaskKind
  description: string
  state: TaskState
  startedAt?: number
  finishedAt?: number
  exitCode?: number
  outputFile: string              // ~/.nuka/tasks/<id>.log
  spec: TaskSpec                  // discriminated by kind
}

export class TaskManager {
  enqueue(spec: TaskSpec): Task
  list(): Task[]
  get(id: string): Task | undefined
  cancel(id: string): Promise<void>
  drain(): Promise<void>          // waits for all pending+running to finish
  on(event: 'change', cb: (t: Task) => void): () => void
}
```

`local_bash`: spawn via `child_process.spawn`, append stdout/stderr to outputFile, transition state on exit.
`local_agent`: invoke `dispatchAgent({...})` from Phase 5 in a detached context; persists transcript chunks.
`monitor_mcp`: subscribes to a long-running MCP tool's progress events; transitions to `completed` on the final event.

`/tasks` slash:
- `/tasks` → `list()` summary.
- `/tasks show <id>` → tail of outputFile.
- `/tasks cancel <id>` → `cancel(id)`.

HUD shows `tasks N` when running > 0.

### 4.4 Doctor

`run(): Promise<DoctorReport>` runs all checks in parallel (each capped at 5 s).

```ts
type Check = { name: string; status: 'ok'|'warn'|'fail'; detail: string; remedy?: string }
type DoctorReport = { ok: boolean; checks: Check[] }
```

Checks:
- **node**: `process.version` ≥ 20.
- **providers**: for each, `probe(p)` (reuse Phase-7 `providerProbe`).
- **plugins**: each loaded plugin → `validatePlugin(dir)` (Phase 5).
- **mcp**: each connected MCP server's `client.status === 'connected'`.
- **lsp**: each spawned LSP client's `status === 'ready'`.
- **config**: `loadConfig()` returns successfully.
- **disk**: `~/.nuka/` writable.

Two surfaces:
- `nuka doctor` — top-level subcommand. Prints sectioned report + exits 0/1.
- `/doctor` — slash inside TUI; dialog that renders the same report.

### 4.5 Statusline customization

```yaml
statusLine:
  format: "{provider}/{model} · ctx {ctxPct}% · ${cost}"
  command: "echo $(git status --short | wc -l) dirty"
  intervalMs: 5000
```

`format` placeholders: `{provider}`, `{model}`, `{ctxPct}`, `{cost}`, `{plugins}`, `{tasks}`, `{branch}`. Default if unset matches today's HUD.

`command`: runs in a detached child every `intervalMs`; stdout (first line) is appended to the rendered status line. Errors show `?` placeholder.

### 4.6 `/rewind` dialog

Add `Dialog['kind'] = 'message-selector'` with `messages: AssistantMessage[]`. The slash returns `{type: 'dialog', dialog: {kind:'message-selector', ...}}`; on selection, fire `sessions.truncateAfter(messageId)` (Phase 8 API).

## 5. Failure modes

- Bundle-split miss → CI build fails on `> 320KB` ceiling.
- Harness shim doesn't deliver Enter to wizard → fall back to component-direct render in plans (existing behavior).
- Task `outputFile` write fails → mark task failed; surface in `/tasks list`.
- Doctor probe times out → check status `warn` with remedy text.
- Statusline command errors → render `?` once; log once to stderr.

## 6. Acceptance

- `npm test` ≥ 1230 (1159 + ~75 new).
- `npm run typecheck` clean.
- `npm run build` produces `dist/cli.js` **≤ 320 KB** and `dist/test-runner.js` (any size).
- `nuka --test-plan test-plans/02-onboarding.yaml` exits 0 with the upgraded plan asserting real wizard transitions.
- `/tasks` lists a running bash task seeded by a sample plan.
- `nuka doctor` exits 0 in a clean install; lists checks.
- `/rewind` opens a message selector dialog.
- Statusline format `{cost}` reflects the cost tracker live.

## 7. Out of scope (Phase 11+)

- Plan recording mode.
- Distributed task execution.
- `/doctor --fix` auto-remediation.
- Sandbox toggle.
- Voice / buddy / remote-control gateway (won't ship).
